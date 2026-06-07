import { streamComplete, type ChatMessage } from "@/lib/anthropic";
import { buildCharacterSystemPrompt } from "@/lib/agents/prompts/character";
import { prisma } from "@/lib/db/prisma";
import { parseJson } from "@/lib/utils";
import { PUBLIC_CHANNEL_KEY } from "@/lib/constants";
import type { ScriptType, PlayerMode } from "@/lib/constants";
import type { LoadedSession } from "@/lib/game/session";
import { getCurrentPhase } from "@/lib/game/session";
import type { Character, Message } from "@prisma/client";

// 拼进 prompt 的最近原始消息条数。早于此窗口的历史由 agentContext 摘要承载（见 summarizer.ts）。
const RECENT_RAW_MESSAGES = 24;

/**
 * 查询某个角色 Agent 能看到的全部对话原始消息（信息隔离：只含公共频道 + 与该角色相关的私聊）。
 * 摘要器与发言器共用此查询，确保压缩输入与角色实际视野完全一致，绝不泄露它本不该知道的内容。
 */
export async function fetchVisibleMessages(
  sessionId: string,
  channelKey: string,
  take = 400
): Promise<Message[]> {
  return prisma.message.findMany({
    where: {
      sessionId,
      isVisible: true,
      OR: [
        { channelType: "PUBLIC" },
        { channelType: "DM_BROADCAST" },
        { channelType: "PRIVATE", channelKey },
      ],
    },
    orderBy: { createdAt: "asc" },
    take,
  });
}

/**
 * 构造某个角色 Agent 看到的对话历史。
 * 压缩策略：若该 SessionCharacter 已有 agentContext 摘要，则
 *   [摘要(user) ] + [最近 RECENT_RAW_MESSAGES 条原始消息]
 * 否则退化为「取最近 N 条原始消息」（无摘要时与旧行为一致）。
 */
async function buildCharacterHistory(
  sessionId: string,
  characterId: string,
  channelKey: string,
  summary?: string | null
): Promise<ChatMessage[]> {
  const messages = await fetchVisibleMessages(sessionId, channelKey);
  const trimmed = messages.slice(-RECENT_RAW_MESSAGES);

  // 自己说的话作为 assistant，其余作为 user（带发言人标注）。
  // 私聊消息额外标注「私聊」前缀，让角色能区分「公开场合的话」与「私下对你说的话」，
  // 避免把私下追问当成公开发言、自说自话。
  const recent: ChatMessage[] = trimmed.map((m) => {
    if (m.senderId === characterId) {
      return { role: "assistant" as const, content: m.content };
    }
    const prefix = m.channelType === "PRIVATE" ? `[私聊·${m.senderName}]` : `[${m.senderName}]`;
    return {
      role: "user" as const,
      content: `${prefix}：${m.content}`,
    };
  });

  if (summary && summary.trim()) {
    return [
      {
        role: "user",
        content: `【此前对话与你已表明立场的摘要（供你保持前后一致，请勿复述）】\n${summary.trim()}`,
      },
      ...recent,
    ];
  }
  return recent;
}

export interface CharacterSpeakInput {
  loaded: LoadedSession;
  character: Character;
  channelKey: string; // public 或私聊 key
  /** DM/玩家给该角色的即时指令（如"请做自我介绍"） */
  directive?: string;
}

/** 流式生成某个角色的发言 */
export async function* streamCharacterReply(
  input: CharacterSpeakInput
): AsyncGenerator<string, void, unknown> {
  const { loaded, character, channelKey } = input;
  const phase = getCurrentPhase(loaded);

  const system = buildCharacterSystemPrompt({
    publicStory: loaded.script.publicStory,
    character,
    currentPhase: loaded.currentPhase,
    phaseDescription: `${phase.name}：${phase.description}`,
    scriptType: loaded.script.scriptType as ScriptType,
    playerMode: loaded.playerMode as PlayerMode,
  });

  const sc = loaded.sessionCharacters.find((s) => s.characterId === character.id);
  const history = await buildCharacterHistory(
    loaded.session.id,
    character.id,
    channelKey,
    sc?.agentContext
  );
  const messages: ChatMessage[] = [...history];

  if (input.directive) {
    messages.push({ role: "user", content: input.directive });
  } else if (messages.length === 0) {
    messages.push({ role: "user", content: "现在轮到你发言，请根据当前阶段开口。" });
  }
  // 确保最后一条是 user（Anthropic 要求）
  if (messages[messages.length - 1]?.role !== "user") {
    messages.push({ role: "user", content: "请你回应一下。" });
  }

  yield* streamComplete(
    { system, messages, maxTokens: 600, temperature: 0.85 },
    () => mockCharacterReply(character, input.directive, channelKey === PUBLIC_CHANNEL_KEY)
  );
}

/** 无密钥时的角色发言兜底 */
function mockCharacterReply(
  character: Character,
  directive: string | undefined,
  isPublic: boolean
): string {
  const secrets = parseJson<string>(character.secrets, character.secrets as any);
  const firstSecretHint = String(character.secrets).split(/[；;\n]/)[0]?.slice(0, 0); // 不泄露秘密
  void secrets;
  void firstSecretHint;

  if (directive?.includes("自我介绍") || directive?.includes("介绍")) {
    return `（${character.name}起身，微微颔首）在下${character.name}，${character.occupation ?? "一介过客"}。${character.publicProfile.slice(0, 40)}…那一夜的事，我也是一头雾水，但我问心无愧。`;
  }
  if (directive?.includes("陈词")) {
    return `（${character.name}神色凝重）我把该说的都说了。真相只有一个，我相信诸位会看清——反正不会是我。`;
  }
  // 私下密谈：直接回应对方，口吻比公开场合更直接
  if (directive?.includes("私下") || directive?.includes("密谈")) {
    const privateLines = [
      `（${character.name}压低声音）你单独问我这个……我可以告诉你一点，但你得先说说你知道多少。`,
      `（${character.name}迟疑了一下）这话我只对你说：那晚的事，恐怕没有表面看上去那么简单。`,
      `（${character.name}盯着你）你到底想从我这儿套什么？有些事，知道得越多越危险。`,
      `（${character.name}凑近）行，看在是私下的份上——你怀疑的方向，未必是错的。`,
    ];
    return privateLines[(character.name.length + (directive?.length ?? 0)) % privateLines.length];
  }
  // AI 之间自由群聊/接话：主动抛话题或回应同伴，而非干等玩家
  if (directive?.includes("自由交流") || directive?.includes("接话") || directive?.includes("讨论")) {
    const groupLines = [
      `（${character.name}环视众人）我倒想问问，案发那会儿，各位都能说清自己在哪儿吗？反正我可以。`,
      `（${character.name}冷笑）刚才那番话我可不敢苟同——你解释得越多，破绽反而越多。`,
      `（${character.name}接过话头）这一点我赞同，不过还有个细节大家好像都没提……`,
      `（${character.name}皱眉）与其互相猜忌，不如把各自看到的摊开来说。我先起个头。`,
    ];
    return groupLines[(character.name.length + (directive?.length ?? 0)) % groupLines.length];
  }
  const lines = [
    `这件事我确实不太清楚，你为什么要这么问我？`,
    `（${character.name}皱了皱眉）你这话是什么意思？我那晚一直待在自己房里。`,
    `我看，与其盯着我，不如想想谁最有理由对老爷下手。`,
    `有些事…我现在还不方便说。等时机到了，自然会水落石出。`,
  ];
  // 用角色名长度做个稳定的"伪随机"选择，避免每次相同又不依赖 Math.random
  const idx = (character.name.length + (directive?.length ?? 0)) % lines.length;
  return lines[idx];
}
