import { prisma } from "@/lib/db/prisma";
import { parseJson } from "@/lib/utils";
import type { ScriptType } from "@/lib/constants";

export interface FeedbackInput {
  rating?: number; // 1~5
  favoriteElements?: string[]; // PLOT_TWIST / CHARACTER_DEPTH / ATMOSPHERE / DEDUCTION
  difficultyFeel?: "TOO_EASY" | "JUST_RIGHT" | "BIT_HARD" | "TOO_HARD";
  wantMore?: boolean;
  comment?: string;
}

/** 根据本局生成体验标签 */
export function generateExperienceTags(args: {
  scriptType: string;
  playerWon: boolean | null;
  twistType?: string;
}): string[] {
  const tags: string[] = [];
  if (args.scriptType === "EMOTIONAL") tags.push("TEARFUL_ENDING");
  if (args.scriptType === "HORROR") tags.push("SPINE_CHILLING");
  if (args.scriptType === "COMEDY") tags.push("LAUGH_OUT_LOUD");
  if (args.twistType && args.twistType.includes("翻转")) tags.push("CLASSIC_TWIST");
  if (args.playerWon === true) tags.push("SOLVED_THE_CASE");
  if (args.playerWon === false) tags.push("FELL_FOR_IT");
  return tags;
}

/**
 * 提交反馈：落库到 session.experienceFeedback / experienceTags，
 * 并据此更新用户偏好档案（PRD 9.3 / 10.1）。
 */
export async function submitFeedback(sessionId: string, feedback: FeedbackInput) {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: { script: true },
  });
  if (!session) throw new Error("未找到会话");

  // 取玩家胜负
  const playerSc = await prisma.sessionCharacter.findFirst({
    where: { sessionId, assignedTo: "PLAYER" },
  });
  const generationParams = parseJson<any>(session.script.generationParams, {});
  const tags = generateExperienceTags({
    scriptType: session.script.scriptType,
    playerWon: playerSc?.victoryAchieved ?? null,
    twistType: generationParams?.twistType,
  });

  await prisma.gameSession.update({
    where: { id: sessionId },
    data: {
      experienceFeedback: JSON.stringify(feedback),
      experienceTags: JSON.stringify(tags),
    },
  });

  await updatePreferences(session.userId, session.script.scriptType as ScriptType, feedback);

  return { tags };
}

/** 自动构建/更新偏好档案 */
async function updatePreferences(
  userId: string,
  scriptType: ScriptType,
  feedback: FeedbackInput
) {
  const existing = await prisma.userPreferences.findUnique({ where: { userId } });

  // 统计所有有评分的局，计算平均
  const ratedSessions = await prisma.gameSession.findMany({
    where: { userId, experienceFeedback: { not: null } },
    select: { experienceFeedback: true, script: { select: { scriptType: true } } },
  });
  const ratings: number[] = [];
  const typeCount: Record<string, number> = {};
  for (const s of ratedSessions) {
    const fb = parseJson<FeedbackInput>(s.experienceFeedback, {});
    if (typeof fb.rating === "number") ratings.push(fb.rating);
    const t = s.script.scriptType;
    typeCount[t] = (typeCount[t] ?? 0) + 1;
  }
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : feedback.rating ?? null;

  // 偏好类型排序（按出现次数）
  const preferredTypes = Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  // 难度舒适区推断
  let preferredDifficulty: string | null = existing?.preferredDifficulty ?? null;
  if (feedback.difficultyFeel === "TOO_EASY") preferredDifficulty = "HARDCORE";
  else if (feedback.difficultyFeel === "TOO_HARD") preferredDifficulty = "BEGINNER";
  else if (feedback.difficultyFeel === "JUST_RIGHT" && !preferredDifficulty) preferredDifficulty = "INTERMEDIATE";

  // 喜爱元素聚合
  const prevFav = parseJson<string[]>(existing?.favoriteElements, []);
  const favSet = new Set([...prevFav, ...(feedback.favoriteElements ?? [])]);

  const totalGames = await prisma.gameSession.count({ where: { userId } });
  const topType = preferredTypes[0] ?? scriptType;
  const summary = `偏爱${labelOf(topType)}，共完成 ${ratedSessions.length} 次评价${
    avgRating ? `，平均体验 ${avgRating.toFixed(1)} 星` : ""
  }${feedback.difficultyFeel === "TOO_EASY" ? "，偏好更高难度" : ""}。`;

  await prisma.userPreferences.upsert({
    where: { userId },
    update: {
      preferredScriptTypes: JSON.stringify(preferredTypes),
      preferredDifficulty,
      favoriteElements: JSON.stringify([...favSet]),
      totalGamesPlayed: totalGames,
      avgRating,
      experienceSummary: summary,
    },
    create: {
      userId,
      preferredScriptTypes: JSON.stringify(preferredTypes),
      preferredDifficulty,
      favoriteElements: JSON.stringify([...favSet]),
      totalGamesPlayed: totalGames,
      avgRating,
      experienceSummary: summary,
    },
  });
}

function labelOf(t: string): string {
  const map: Record<string, string> = {
    DEDUCTION: "推理本", HARDCORE: "硬核本", EMOTIONAL: "情感本",
    COMEDY: "欢乐本", HORROR: "恐怖本", RESTORATION: "还原本",
  };
  return map[t] ?? t;
}
