import { prisma } from "@/lib/db/prisma";
import { PUBLIC_CHANNEL_KEY, ChannelType, SenderType } from "@/lib/constants";
import type { GameEvent, SenderInfo } from "@/types/game";
import type { LoadedSession } from "@/lib/game/session";
import { getAiCharacters, getCurrentPhase } from "@/lib/game/session";
import { streamCharacterReply } from "@/lib/agents/character-agent";
import { streamDMReply, type DMActionType } from "@/lib/agents/dm-agent";
import { recordConsistencyCheck } from "@/lib/agents/consistency-agent";
import type { Character } from "@prisma/client";

/** 持久化一条消息 */
export async function saveMessage(args: {
  sessionId: string;
  channelType: string;
  channelKey: string;
  senderType: string;
  senderId: string;
  senderName: string;
  content: string;
  phase: number;
  metadata?: Record<string, any>;
}) {
  return prisma.message.create({
    data: {
      sessionId: args.sessionId,
      channelType: args.channelType,
      channelKey: args.channelKey,
      senderType: args.senderType,
      senderId: args.senderId,
      senderName: args.senderName,
      content: args.content,
      phase: args.phase,
      metadata: args.metadata ? JSON.stringify(args.metadata) : null,
    },
  });
}

/**
 * 流式生成单个角色的回复，边产出 chunk 边累计，结束时落库。
 * 通过 send 回调推送 SSE 事件。
 */
export async function streamCharacterTurn(
  loaded: LoadedSession,
  character: Character,
  channelKey: string,
  channelType: string,
  send: (e: GameEvent) => void,
  directive?: string
): Promise<string> {
  const sender: SenderInfo = {
    type: "AI_CHARACTER",
    id: character.id,
    name: character.name,
  };
  const messageId = `stream-${character.id}-${loaded.session.id}-${loaded.currentPhase}-${channelKey}`;

  let full = "";
  let streamError: unknown;
  try {
    for await (const chunk of streamCharacterReply({ loaded, character, channelKey, directive })) {
      full += chunk;
      send({ type: "MESSAGE_STREAM", chunk, messageId, sender });
    }
  } catch (err) {
    // 真实 API 流中途报错：保留已产出的 chunk，下面照常落库；
    // 若一个字都没出来，给一句兜底，避免空消息且不中断整条 SSE 流。
    streamError = err;
    if (!full.trim()) {
      full = `（${character.name}欲言又止，似乎一时语塞……）`;
    }
  }

  const saved = await saveMessage({
    sessionId: loaded.session.id,
    channelType,
    channelKey,
    senderType: "AI_CHARACTER",
    senderId: character.id,
    senderName: character.name,
    content: full,
    phase: loaded.currentPhase,
    metadata: streamError ? { streamError: String((streamError as Error)?.message ?? streamError) } : undefined,
  });

  send({
    type: "MESSAGE_COMPLETE",
    messageId: saved.id,
    fullContent: full,
    sender,
    phase: loaded.currentPhase,
    channelKey,
  });

  // 穿帮检测：仅对公共发言、非空、非流式报错时做。玩家已看到完整发言，这里在其后异步校验，
  // 结果写回消息 metadata 供复盘展示。fail-silent，不影响主流程。
  if (!streamError && channelKey === PUBLIC_CHANNEL_KEY && full.trim()) {
    await recordConsistencyCheck(loaded, character, saved.id, full);
  }

  return full;
}

/**
 * 公共频道里，玩家发言后挑选若干 AI 角色依次回应。
 * V1 简化策略：自由交流/质询阶段，随机挑 1~2 个 AI 角色回应；
 * 自我介绍/陈词阶段由专门流程顺序点名（见 advancePhase / promptAll）。
 */
export function pickRespondersForPublic(
  loaded: LoadedSession,
  playerContent: string
): Character[] {
  const ai = getAiCharacters(loaded).map((sc) => sc.character);
  if (ai.length === 0) return [];

  // 若玩家点名某角色（消息包含其名字），优先让该角色回应
  const named = ai.filter((c) => playerContent.includes(c.name));
  if (named.length > 0) return named.slice(0, 2);

  // 否则用内容长度做稳定选择。自由交流/质询等开放阶段多挑一位，让讨论不止于一问一答。
  const phase = getCurrentPhase(loaded);
  const freeChat = phase.permissions.publicChat && phase.id >= 2;
  const count = freeChat ? Math.min(2, ai.length) : 1;
  const start = playerContent.length % ai.length;
  const result: Character[] = [];
  for (let i = 0; i < count; i++) {
    result.push(ai[(start + i) % ai.length]);
  }
  return result;
}

/**
 * 公共频道里的「AI 之间自由群聊」一轮：无需玩家发话，挑选若干 AI 角色依次在公共频道接话，
 * 让自由交流阶段呈现多人你来我往的氛围，而非一直等玩家提问。
 * 每个角色发言时都会重新读取最新对话（含本轮前面同伴刚说的话），从而自然地互相回应。
 */
export async function runPublicGroupDiscussion(
  loaded: LoadedSession,
  send: (e: GameEvent) => void,
  opts: { turns?: number; topic?: string } = {}
): Promise<void> {
  const ai = getAiCharacters(loaded).map((sc) => sc.character);
  if (ai.length === 0) return;

  const turns = Math.max(1, Math.min(opts.turns ?? 3, ai.length));
  // 用已有公共消息数派生起点，使每次点击轮换不同的人先开口（稳定、可复现，不依赖随机源）
  const msgCount = await prisma.message.count({
    where: { sessionId: loaded.session.id, channelType: ChannelType.PUBLIC },
  });
  const start = ai.length > 0 ? msgCount % ai.length : 0;

  for (let i = 0; i < turns; i++) {
    const speaker = ai[(start + i) % ai.length];
    const directive =
      i === 0
        ? `现在是自由交流时间，没有人点名你，但请你主动开口推进讨论：就案情抛出你的疑问、说出你对某个人的怀疑，或为自己辩白。${
            opts.topic ? `不妨围绕"${opts.topic}"展开。` : ""
          }直接以角色身份发言（2~4句），点名一两位在场者会让讨论更热烈。`
        : `公共场合的讨论你都看到了，请你自然地接话：针对前面某位的说法表示赞同、反驳、追问或补充，把话头递给别人，让讨论继续下去（2~4句）。不要重复已经说过的话，也不要等玩家发问。`;
    await streamCharacterTurn(
      loaded,
      speaker,
      PUBLIC_CHANNEL_KEY,
      ChannelType.PUBLIC,
      send,
      directive
    );
  }
}

/**
 * 流式生成 DM 发言并落库（阶段宣告 / 提示 / 回顾等）。
 * 与角色发言一样做 try/finally 保护：真实 API 流中途报错时，已产出内容不丢、不中断整条 SSE。
 * next-phase 与 player-command 共用本函数，避免两处重复且都缺保护。
 */
export async function streamDMTurn(
  loaded: LoadedSession,
  directive: string,
  action: DMActionType,
  send: (e: GameEvent) => void,
  opts: { channelType?: string; phase?: number } = {}
): Promise<string> {
  const channelType = opts.channelType ?? ChannelType.DM_BROADCAST;
  const phase = opts.phase ?? loaded.currentPhase;
  const sender: SenderInfo = { type: "DM", id: "dm", name: "DM" };
  const messageId = `dm-stream-${loaded.session.id}-${phase}-${action}`;

  let full = "";
  let streamError: unknown;
  try {
    for await (const chunk of streamDMReply(loaded, directive, action)) {
      full += chunk;
      send({ type: "MESSAGE_STREAM", chunk, messageId, sender });
    }
  } catch (err) {
    streamError = err;
    if (!full.trim()) {
      full = `【DM】（信号似乎中断了片刻，请稍候……）`;
    }
  }

  const saved = await saveMessage({
    sessionId: loaded.session.id,
    channelType,
    channelKey: PUBLIC_CHANNEL_KEY,
    senderType: SenderType.DM,
    senderId: "dm",
    senderName: "DM",
    content: full,
    phase,
    metadata: streamError ? { streamError: String((streamError as Error)?.message ?? streamError) } : undefined,
  });

  send({
    type: "MESSAGE_COMPLETE",
    messageId: saved.id,
    fullContent: full,
    sender,
    phase,
    channelKey: PUBLIC_CHANNEL_KEY,
  });

  return full;
}

export { PUBLIC_CHANNEL_KEY };
