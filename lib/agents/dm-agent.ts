import { complete, streamComplete, type ChatMessage } from "@/lib/anthropic";
import { buildDMSystemPrompt } from "@/lib/agents/prompts/dm";
import { prisma } from "@/lib/db/prisma";
import type { LoadedSession } from "@/lib/game/session";
import { getCurrentPhase } from "@/lib/game/session";

/** 构造 DM 看到的对话历史（DM 监听所有公开频道，私聊只看摘要——此处简化为公共+广播） */
async function buildDMHistory(sessionId: string): Promise<ChatMessage[]> {
  const messages = await prisma.message.findMany({
    where: {
      sessionId,
      isVisible: true,
      channelType: { in: ["PUBLIC", "DM_BROADCAST", "DM_HINT"] },
    },
    orderBy: { createdAt: "asc" },
    take: 60,
  });

  return messages.map((m) => ({
    role: (m.senderType === "DM" ? "assistant" : "user") as "assistant" | "user",
    content: m.senderType === "DM" ? m.content : `[${m.senderName}]：${m.content}`,
  }));
}

function buildDMSystem(loaded: LoadedSession): string {
  return buildDMSystemPrompt({
    scriptType: loaded.script.scriptType,
    publicStory: loaded.script.publicStory,
    murderSummary: loaded.script.murderSummary,
    allCharacters: loaded.sessionCharacters.map((sc) => ({
      name: sc.character.name,
      privateStory: sc.character.privateStory,
      secrets: sc.character.secrets,
      hiddenGoal: sc.character.hiddenGoal,
      victoryCondition: sc.character.victoryCondition,
      isMurderer: sc.character.isMurderer,
      isVictim: sc.character.isVictim,
    })),
    phaseConfig: loaded.phases.map((p) => ({ name: p.name, description: p.description })),
    currentPhase: loaded.currentPhase,
    gameState: loaded.state,
  });
}

export type DMActionType =
  | "PHASE_ANNOUNCE"
  | "HINT"
  | "RECAP"
  | "GUIDE"
  | "CLUE_DESCRIPTION"
  | "VOTE_SUMMARY"
  | "REVEAL";

/** 流式生成 DM 发言 */
export async function* streamDMReply(
  loaded: LoadedSession,
  directive: string,
  action: DMActionType
): AsyncGenerator<string, void, unknown> {
  const system = buildDMSystem(loaded);
  const history = await buildDMHistory(loaded.session.id);
  const messages: ChatMessage[] = [...history, { role: "user", content: directive }];

  yield* streamComplete(
    { system, messages, maxTokens: 700, temperature: 0.7 },
    () => mockDMReply(loaded, action, directive)
  );
}

/** 非流式 DM 发言（用于内部判定类调用） */
export async function dmComplete(
  loaded: LoadedSession,
  directive: string,
  action: DMActionType
): Promise<string> {
  const system = buildDMSystem(loaded);
  const history = await buildDMHistory(loaded.session.id);
  const messages: ChatMessage[] = [...history, { role: "user", content: directive }];
  return complete(
    { system, messages, maxTokens: 700, temperature: 0.7 },
    () => mockDMReply(loaded, action, directive)
  );
}

function mockDMReply(loaded: LoadedSession, action: DMActionType, directive = ""): string {
  const phase = getCurrentPhase(loaded);
  switch (action) {
    case "PHASE_ANNOUNCE":
      return `【DM】现在进入「${phase.name}」。${phase.description}。请各位做好准备。`;
    case "HINT":
      return `【DM】不妨换个角度想想：那杯安神茶为什么没有毒？凶手让死者保持清醒，意味着什么样的动机？`;
    case "RECAP":
      return `【DM】回顾一下：雾港庄园的盐商沈鸿庄在六十大寿当夜遇害，书房自内反锁，唯一钥匙在死者身上。当晚共六人留宿，每个人都有自己的盘算。目前我们正处于「${phase.name}」。`;
    case "GUIDE":
      if (/自我介绍|介绍完毕/.test(directive)) {
        return `【DM】所有人的自我介绍已经完成，人物关系和立场已经摆上桌面。接下来进入下一环节，请留意每个人刚才没有说出口的部分。`;
      }
      if (/最终陈词|投票阶段|进入投票/.test(directive)) {
        return `【DM】最终陈词到此结束，每个人的态度都已经明确。接下来进入投票，请根据证据、动机与时间线做出你的判断。`;
      }
      if (/太难|降低难度|加快线索/.test(directive)) {
        return `【DM】我会加快线索释放。先别急着锁定凶手，回到时间线：谁的行动路径最需要被遮掩？`;
      }
      return `【DM】讨论似乎陷入了僵局。各位不妨重新梳理一下：案发当晚，每个人究竟身在何处？`;
    case "CLUE_DESCRIPTION":
      return `【DM】（一阵阴风掠过回廊）新的线索浮出水面，请各位仔细查验。`;
    case "VOTE_SUMMARY":
      return `【DM】投票已经汇总完毕，得票最多者，将成为众矢之的。`;
    case "REVEAL":
      return `【DM】现在，揭开真相的时刻到了。`;
    default:
      return `【DM】请继续。`;
  }
}
