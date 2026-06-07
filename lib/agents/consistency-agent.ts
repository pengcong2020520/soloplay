import { PROVIDER, completeJson } from "@/lib/anthropic";
import { prisma } from "@/lib/db/prisma";
import type { LoadedSession } from "@/lib/game/session";
import type { Character } from "@prisma/client";

export interface ConsistencyVerdict {
  /** 是否与角色私密剧本设定或此前公开发言「穿帮」式矛盾 */
  contradicts: boolean;
  /** 矛盾点简述（无矛盾则空串） */
  detail: string;
  /** 与什么矛盾："SCRIPT"=私密剧本设定 / "PRIOR"=之前自己的公开发言 / ""=无 */
  against: "SCRIPT" | "PRIOR" | "";
  /** 严重度 1~3（仅 contradicts 时有意义） */
  severity: number;
}

const NO_CONTRADICTION: ConsistencyVerdict = {
  contradicts: false,
  detail: "",
  against: "",
  severity: 0,
};

/**
 * 校验某角色的一条新发言是否与「私密剧本设定」或「自己此前的公开发言」穿帮式矛盾。
 *
 * 关键区分：角色**策略性说谎**（如凶手掩饰、隐瞒秘密）是设计内的，不算矛盾；
 * 只有「与剧本既定客观事实冲突」或「同一事实前后说法自相矛盾」才算穿帮。
 *
 * 被动记录型：结果写入该消息的 metadata.consistency，复盘时展示，不重生成、不阻塞。
 * 失败静默：任何异常都视为「无矛盾」，绝不影响游戏主流程。
 */
export async function checkConsistency(
  loaded: LoadedSession,
  character: Character,
  newUtterance: string,
  priorOwnStatements: string[]
): Promise<ConsistencyVerdict> {
  if (!newUtterance.trim()) return NO_CONTRADICTION;
  if (PROVIDER === "step" && process.env.ENABLE_STEP_CONSISTENCY_CHECKS !== "1") {
    return NO_CONTRADICTION;
  }

  const priorBlock =
    priorOwnStatements.length > 0
      ? priorOwnStatements.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "（暂无）";

  const system = `你是剧本杀的"穿帮检测员"。给定一个角色的私密剧本设定、TA 此前的公开发言、以及 TA 最新的一句发言，
判断最新发言是否构成**穿帮式矛盾**。

判定准则（务必严格区分）：
- ✅ 不算矛盾：角色策略性说谎、隐瞒秘密、含糊其辞、改变态度/情绪、对主观看法的修正——这些都是剧本杀的正常博弈。
- ❌ 算矛盾(contradicts=true)：
  - against="SCRIPT"：发言与私密剧本里的**客观既定事实**直接冲突（例如剧本设定 TA 当晚在书房，却说自己整晚在花园，且并非有意撒谎的设定）。
  - against="PRIOR"：就**同一客观事实**，最新发言与 TA 自己之前的公开说法自相矛盾（不是策略调整，而是忘了自己说过什么）。

只输出 JSON：{"contradicts": bool, "against": "SCRIPT"|"PRIOR"|"", "detail": "一句话说明", "severity": 1-3}
无矛盾时 against="" detail="" severity=0。`;

  const directive = `【角色私密剧本设定】
姓名：${character.name}
私密背景：${character.privateStory}
秘密：${character.secrets}
（注：秘密本身可以隐瞒，隐瞒不算矛盾）

【TA 此前的公开发言】
${priorBlock}

【TA 最新的一句发言】
${newUtterance}

请判断最新发言是否穿帮，输出 JSON。`;

  try {
    const verdict = await completeJson<ConsistencyVerdict>(
      {
        system,
        messages: [{ role: "user", content: directive }],
        maxTokens: 300,
        temperature: 0.2,
      },
      () => NO_CONTRADICTION
    );
    // 规整字段，防止模型给出非法值
    return {
      contradicts: Boolean(verdict?.contradicts),
      detail: typeof verdict?.detail === "string" ? verdict.detail : "",
      against: verdict?.against === "SCRIPT" || verdict?.against === "PRIOR" ? verdict.against : "",
      severity: typeof verdict?.severity === "number" ? verdict.severity : 0,
    };
  } catch {
    return NO_CONTRADICTION;
  }
}

/**
 * 取某角色此前在本局的公开发言（用于"与自己前言"比对）。只取公共频道，限量。
 */
export async function fetchPriorOwnStatements(
  sessionId: string,
  characterId: string,
  excludeContent: string,
  limit = 12
): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: {
      sessionId,
      senderId: characterId,
      channelType: "PUBLIC",
      isVisible: true,
    },
    orderBy: { createdAt: "asc" },
    take: 60,
  });
  return rows
    .map((r) => r.content)
    .filter((c) => c && c !== excludeContent)
    .slice(-limit);
}

/**
 * 对一条刚落库的角色发言做穿帮检测，并把结果写回该消息的 metadata.consistency。
 * 设计为「fire-and-forget 后台任务」：失败静默、不阻塞 SSE、不影响发言展示。
 */
export async function recordConsistencyCheck(
  loaded: LoadedSession,
  character: Character,
  messageId: string,
  utterance: string
): Promise<void> {
  try {
    const prior = await fetchPriorOwnStatements(loaded.session.id, character.id, utterance);
    const verdict = await checkConsistency(loaded, character, utterance, prior);
    if (!verdict.contradicts) return;

    // 合并进既有 metadata，不覆盖（如 streamError）
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) return;
    let meta: Record<string, any> = {};
    if (msg.metadata) {
      try {
        meta = JSON.parse(msg.metadata);
      } catch {
        meta = {};
      }
    }
    meta.consistency = verdict;
    await prisma.message.update({
      where: { id: messageId },
      data: { metadata: JSON.stringify(meta) },
    });
  } catch {
    // 静默：穿帮检测是质量监控的辅助功能，绝不拖垮主流程
  }
}
