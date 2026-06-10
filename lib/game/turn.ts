import { prisma } from "@/lib/db/prisma";
import { PUBLIC_CHANNEL_KEY, ChannelType, SenderType } from "@/lib/constants";
import type { GameEvent, SenderInfo } from "@/types/game";
import type { LoadedSession } from "@/lib/game/session";
import { getAiCharacters, getCurrentPhase } from "@/lib/game/session";
import { isSequentialCharacterPhase } from "@/lib/game/phase-flow";
import { completeCharacterReply, streamCharacterReply } from "@/lib/agents/character-agent";
import { dmComplete, streamDMReply, type DMActionType } from "@/lib/agents/dm-agent";
import { recordConsistencyCheck } from "@/lib/agents/consistency-agent";
import { MODEL, PROVIDER } from "@/lib/anthropic";
import {
  analyzeDialogueTargets,
  buildGroupDiscussionDirective,
  pickNextGroupSpeaker,
  planPublicResponders,
} from "@/lib/game/conversation-director";
import {
  assessTurnIntegrity,
  buildContinuationDirective,
  buildTurnIntegrityMetadata,
  mergeContinuation,
  normalizeTurnText,
} from "@/lib/game/turn-integrity";
import type { Character } from "@prisma/client";

let streamMessageCounter = 0;

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
  const messageId = createStreamMessageId(character.id, loaded.session.id);

  let full = "";
  let streamError: unknown;
  send({
    type: "AGENT_STATUS_CHANGED",
    agentId: character.id,
    agentName: character.name,
    status: "THINKING",
    reason: directive ? "准备回应当前话题" : "准备发言",
  });
  try {
    for await (const chunk of streamCharacterReply({ loaded, character, channelKey, directive })) {
      full += chunk;
      send({ type: "MESSAGE_STREAM", chunk, messageId, sender });
    }
  } catch (err) {
    streamError = err;
  }

  let integrity = assessTurnIntegrity(full, { streamError });
  let continuationCount = 0;
  if (!integrity.complete) {
    const continuationDirective = buildContinuationDirective({
      speakerName: character.name,
      partialText: full,
      originalDirective: directive,
    });
    try {
      const continuation = await completeCharacterReply({
        loaded,
        character,
        channelKey,
        directive: continuationDirective,
      });
      if (continuation.trim()) {
        full = mergeContinuation(full, continuation);
        continuationCount += 1;
        send({ type: "MESSAGE_STREAM", chunk: continuation, messageId, sender });
      }
    } catch (err) {
      streamError = streamError ?? err;
    }
    integrity = {
      ...assessTurnIntegrity(full, { streamError: undefined }),
      repaired: continuationCount > 0,
      continuationCount,
      streamError: streamError ? String((streamError as Error)?.message ?? streamError) : undefined,
      reason: continuationCount > 0 ? "continued_after_interruption" : integrity.reason,
    };
  }

  full = normalizeTurnText(full);
  if (!full.trim()) {
    full = `（${character.name}沉默片刻，似乎仍在斟酌该如何开口。）`;
  }
  const dialogue = analyzeDialogueTargets(loaded, full, { speakerId: character.id, includePlayer: true });
  const saved = await saveMessage({
    sessionId: loaded.session.id,
    channelType,
    channelKey,
    senderType: "AI_CHARACTER",
    senderId: character.id,
    senderName: character.name,
    content: full,
    phase: loaded.currentPhase,
    metadata: {
      turnIntegrity: buildTurnIntegrityMetadata(integrity),
      dialogue,
      llm: buildLlmMetadata(streamError, continuationCount),
    },
  });

  send({
    type: "MESSAGE_COMPLETE",
    messageId: saved.id,
    fullContent: full,
    sender,
    phase: loaded.currentPhase,
    channelKey,
    metadata: saved.metadata ? safeObj(saved.metadata) : undefined,
  });
  send({
    type: "AGENT_STATUS_CHANGED",
    agentId: character.id,
    agentName: character.name,
    status: "RESPONDED",
    reason: "发言已生成，等待语音展示",
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
  const phase = getCurrentPhase(loaded);
  if (isSequentialCharacterPhase(phase)) return [];
  return planPublicResponders(loaded, playerContent, { fallbackSalt: "player-message" }).responders;
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
  const [msgCount, recentAiMessages] = await Promise.all([
    prisma.message.count({
      where: { sessionId: loaded.session.id, channelType: ChannelType.PUBLIC },
    }),
    prisma.message.findMany({
      where: {
        sessionId: loaded.session.id,
        phase: loaded.currentPhase,
        channelType: ChannelType.PUBLIC,
        senderType: SenderType.AI_CHARACTER,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  const latestAiMessage = recentAiMessages[0];
  let recentContents = recentAiMessages.map((message) => message.content);
  const start = ai.length > 0 ? msgCount % ai.length : 0;
  const spokenIds = new Set<string>();
  let previousContent = opts.topic ?? latestAiMessage?.content ?? "";
  let previousSpeakerId: string | undefined = opts.topic ? undefined : latestAiMessage?.senderId;

  for (let i = 0; i < turns; i++) {
    let planned =
      previousContent
        ? pickNextGroupSpeaker(loaded, previousContent, {
            lastSpeakerId: previousSpeakerId,
            spokenIds,
            fallbackSalt: `group-${msgCount}-${i}`,
          })
        : { speaker: ai[start], signal: undefined, reason: "phase rotation" };
    if (i === 0 && planned.speaker?.id === previousSpeakerId) {
      planned = pickNextGroupSpeaker(loaded, previousContent, {
        lastSpeakerId: previousSpeakerId,
        spokenIds,
        fallbackSalt: `group-avoid-repeat-${msgCount}`,
      });
    }
    const speaker = planned.speaker;
    if (!speaker) break;
    spokenIds.add(speaker.id);
    const directive = buildGroupDiscussionDirective({
      speakerName: speaker.name,
      isFirst: i === 0,
      topic: opts.topic,
      previousContent,
      signal: planned.signal,
      recentContents,
    });
    previousContent = await streamCharacterTurn(
      loaded,
      speaker,
      PUBLIC_CHANNEL_KEY,
      ChannelType.PUBLIC,
      send,
      directive
    );
    recentContents = [previousContent, ...recentContents].slice(0, 5);
    previousSpeakerId = speaker.id;
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
  const messageId = createStreamMessageId(`dm-${action}`, loaded.session.id);

  let full = "";
  let streamError: unknown;
  send({
    type: "AGENT_STATUS_CHANGED",
    agentId: "dm",
    agentName: "DM",
    status: "THINKING",
    reason: action === "PHASE_ANNOUNCE" ? "正在组织阶段宣告" : "正在判断局势",
  });
  try {
    for await (const chunk of streamDMReply(loaded, directive, action)) {
      full += chunk;
      send({ type: "MESSAGE_STREAM", chunk, messageId, sender });
    }
  } catch (err) {
    streamError = err;
  }

  let integrity = assessTurnIntegrity(full, { streamError });
  let continuationCount = 0;
  if (!integrity.complete) {
    try {
      const continuation = await dmComplete(
        loaded,
        buildContinuationDirective({
          speakerName: "DM",
          partialText: full,
          originalDirective: directive,
          isDM: true,
        }),
        action
      );
      if (continuation.trim()) {
        full = mergeContinuation(full, continuation);
        continuationCount += 1;
        send({ type: "MESSAGE_STREAM", chunk: continuation, messageId, sender });
      }
    } catch (err) {
      streamError = streamError ?? err;
    }
    integrity = {
      ...assessTurnIntegrity(full, { streamError: undefined }),
      repaired: continuationCount > 0,
      continuationCount,
      streamError: streamError ? String((streamError as Error)?.message ?? streamError) : undefined,
      reason: continuationCount > 0 ? "continued_after_interruption" : integrity.reason,
    };
  }

  full = normalizeTurnText(full);
  if (!full.trim()) {
    full = `【DM】（信号似乎中断了片刻，请稍候……）`;
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
    metadata: {
      turnIntegrity: buildTurnIntegrityMetadata(integrity),
      dmAction: action,
      llm: buildLlmMetadata(streamError, continuationCount),
    },
  });

  send({
    type: "MESSAGE_COMPLETE",
    messageId: saved.id,
    fullContent: full,
    sender,
    phase,
    channelKey: PUBLIC_CHANNEL_KEY,
    metadata: saved.metadata ? safeObj(saved.metadata) : undefined,
  });
  send({
    type: "AGENT_STATUS_CHANGED",
    agentId: "dm",
    agentName: "DM",
    status: "LISTENING",
    reason: "持续监听公共讨论",
  });

  return full;
}

export { PUBLIC_CHANNEL_KEY };

function createStreamMessageId(senderId: string, sessionId: string) {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${streamMessageCounter++}`;
  return `stream-${senderId}-${sessionId}-${suffix}`;
}

function safeObj(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : undefined;
  } catch {
    return undefined;
  }
}

function buildLlmMetadata(streamError: unknown, continuationCount: number) {
  return {
    provider: PROVIDER,
    model: MODEL,
    fallback: PROVIDER === "mock",
    continuationCount,
    error: streamError ? String((streamError as Error)?.message ?? streamError) : undefined,
  };
}
