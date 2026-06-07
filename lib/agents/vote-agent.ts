import { complete, type ChatMessage } from "@/lib/anthropic";
import { buildCharacterSystemPrompt } from "@/lib/agents/prompts/character";
import { prisma } from "@/lib/db/prisma";
import type { LoadedSession } from "@/lib/game/session";
import { getCurrentPhase, getAiCharacters } from "@/lib/game/session";
import type { ScriptType, PlayerMode } from "@/lib/constants";
import type { Character } from "@prisma/client";

interface AiVote {
  characterId: string;
  characterName: string;
  targetId: string;
  targetName: string;
  reason: string;
}

/** 让某个 AI 角色基于已知信息选择投票对象 */
async function getCharacterVote(
  loaded: LoadedSession,
  voter: Character,
  candidates: Character[]
): Promise<AiVote> {
  const phase = getCurrentPhase(loaded);
  const system = buildCharacterSystemPrompt({
    publicStory: loaded.script.publicStory,
    character: voter,
    currentPhase: loaded.currentPhase,
    phaseDescription: `${phase.name}：${phase.description}`,
    scriptType: loaded.script.scriptType as ScriptType,
    playerMode: loaded.playerMode as PlayerMode,
  });

  // 提供最近对话作为参考
  const recent = await prisma.message.findMany({
    where: { sessionId: loaded.session.id, isVisible: true, channelType: { in: ["PUBLIC", "DM_BROADCAST"] } },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  const transcript = recent.map((m) => `[${m.senderName}]：${m.content}`).join("\n");

  const candidateList = candidates.map((c) => `- ${c.name}（id=${c.id}）`).join("\n");
  const directive = `现在是投票指凶阶段。基于你掌握的信息和全场讨论，你要投出你认为最可疑的人。
可选对象：
${candidateList}

参考全场讨论：
${transcript}

请严格按以下格式输出一行，不要多余内容：
TARGET=<被投对象的name>|REASON=<一句话理由，符合你的角色立场>`;

  const messages: ChatMessage[] = [{ role: "user", content: directive }];

  const raw = await complete(
    { system, messages, maxTokens: 200, temperature: 0.7 },
    () => mockVote(voter, candidates)
  );

  return parseVote(raw, voter, candidates);
}

function parseVote(raw: string, voter: Character, candidates: Character[]): AiVote {
  const targetMatch = raw.match(/TARGET=([^|\n]+)/);
  const reasonMatch = raw.match(/REASON=([^\n]+)/);
  const targetName = targetMatch?.[1]?.trim() ?? "";
  const reason = reasonMatch?.[1]?.trim() ?? "直觉如此。";

  let target =
    candidates.find((c) => c.name === targetName) ??
    candidates.find((c) => targetName.includes(c.name)) ??
    candidates.find((c) => raw.includes(c.name));

  if (!target) target = candidates[0];

  return {
    characterId: voter.id,
    characterName: voter.name,
    targetId: target.id,
    targetName: target.name,
    reason,
  };
}

/** mock：非凶手倾向投凶手；凶手投一个无辜者制造混乱 */
function mockVote(voter: Character, candidates: Character[]): string {
  const murderer = candidates.find((c) => c.isMurderer);
  if (voter.isMurderer) {
    const scapegoat = candidates.find((c) => !c.isMurderer && c.id !== voter.id) ?? candidates[0];
    return `TARGET=${scapegoat.name}|REASON=他那晚的行踪最说不清楚，疑点最多。`;
  }
  if (murderer) {
    return `TARGET=${murderer.name}|REASON=他的说法前后矛盾，对死者的动机也最强。`;
  }
  const other = candidates.find((c) => c.id !== voter.id) ?? candidates[0];
  return `TARGET=${other.name}|REASON=综合各方说法，他的嫌疑最大。`;
}

/**
 * 触发所有 AI 角色投票并落库。
 * 投票候选 = 所有非死者角色（含玩家在 ROLE_PLAY 下的角色）。
 */
export async function runAiVotes(loaded: LoadedSession): Promise<AiVote[]> {
  const ai = getAiCharacters(loaded).map((sc) => sc.character);
  // 候选包含所有进入会话的角色（AI + 玩家角色）
  const candidates = loaded.sessionCharacters.map((sc) => sc.character);

  const votes: AiVote[] = [];
  for (const voter of ai) {
    const candidatesForVoter = candidates.filter((c) => c.id !== voter.id);
    let v: AiVote;
    try {
      v = await getCharacterVote(loaded, voter, candidatesForVoter);
    } catch {
      // 单个角色投票失败（API 抖动/超时）不应中断整场汇总，降级为兜底投票
      v = parseVote(mockVote(voter, candidatesForVoter), voter, candidatesForVoter);
    }
    votes.push(v);
    // upsert 而非 create：靠 (sessionId, voterId) 唯一约束保证每个 AI 一局只有一票，
    // 即便极端情况下被重复调用也不会撞 P2002。
    await prisma.vote.upsert({
      where: { sessionId_voterId: { sessionId: loaded.session.id, voterId: v.characterId } },
      update: {},
      create: {
        sessionId: loaded.session.id,
        voterId: v.characterId,
        voterName: v.characterName,
        voterType: "AI_CHARACTER",
        targetId: v.targetId,
        targetName: v.targetName,
        reason: v.reason,
      },
    });
  }
  return votes;
}
