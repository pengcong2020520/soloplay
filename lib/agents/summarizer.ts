import { complete } from "@/lib/anthropic";
import { prisma } from "@/lib/db/prisma";
import { fetchVisibleMessages } from "@/lib/agents/character-agent";
import { getAiCharacters } from "@/lib/game/session";
import { PUBLIC_CHANNEL_KEY } from "@/lib/constants";
import type { LoadedSession } from "@/lib/game/session";

// 历史原始消息超过此条数才值得压缩（低于此值直接走原始消息，省一次 LLM 调用）
const SUMMARY_TRIGGER_MESSAGES = 28;
// 摘要本身的 token 上限，控制成本
const SUMMARY_MAX_TOKENS = 500;

/**
 * 为单个角色生成/更新滚动摘要，写入 SessionCharacter.agentContext。
 *
 * 信息隔离：只读取该角色 fetchVisibleMessages 能看到的消息（公共 + 广播 + 自己的私聊），
 * 绝不把全局 transcript 喂进来——否则角色会"记住"它本不该知道的私聊内容。
 *
 * 失败静默：任何异常都降级为"不更新摘要"，发言器会自动回退到截取最近原始消息，绝不影响主流程。
 */
async function summarizeForCharacter(
  loaded: LoadedSession,
  sc: LoadedSession["sessionCharacters"][number]
): Promise<void> {
  const messages = await fetchVisibleMessages(loaded.session.id, PUBLIC_CHANNEL_KEY);
  if (messages.length < SUMMARY_TRIGGER_MESSAGES) return;

  const character = sc.character;
  const transcript = messages
    .map((m) => (m.senderId === character.id ? `[我]：${m.content}` : `[${m.senderName}]：${m.content}`))
    .join("\n");

  const prior = sc.agentContext?.trim();

  const system = `你是剧本杀对话的记忆压缩助手。你要为角色「${character.name}」维护一份第一人称的记忆摘要，
供该角色后续发言时保持前后一致。摘要必须：
1. 只基于「${character.name}」视角实际听到/说过的内容，不要编造，不要加入未出现的信息。
2. 重点保留：我已对外公开承诺或声称的事实、我的立场、与他人的关键互动、尚未澄清的疑点。
3. 用紧凑的要点式中文，控制在 200 字以内。
4. 不要泄露"我"的私密秘密本身（那不在对话里），只记录"我对外说过什么"。`;

  const directive = `${prior ? `已有摘要：\n${prior}\n\n` : ""}以下是${prior ? "新增的" : "全部的"}对话记录：\n${transcript}\n\n请输出更新后的记忆摘要（纯文本，不要任何前后缀说明）。`;

  const summary = await complete(
    {
      system,
      messages: [{ role: "user", content: directive }],
      maxTokens: SUMMARY_MAX_TOKENS,
      temperature: 0.3,
    },
    // mock 兜底：无密钥时给一句占位摘要（不触发真实压缩，但保持字段被填充以验证链路）
    () => prior ?? `（${character.name}的对话尚在累积中。）`
  );

  if (summary && summary.trim()) {
    await prisma.sessionCharacter.update({
      where: { id: sc.id },
      data: { agentContext: summary.trim() },
    });
  }
}

/**
 * 在阶段边界为所有 AI 角色刷新摘要。低频（每阶段一次）、并发执行、整体失败静默。
 * 由 next-phase 在推进后调用。
 */
export async function refreshPhaseSummaries(loaded: LoadedSession): Promise<void> {
  const ai = getAiCharacters(loaded);
  await Promise.allSettled(ai.map((sc) => summarizeForCharacter(loaded, sc)));
}
