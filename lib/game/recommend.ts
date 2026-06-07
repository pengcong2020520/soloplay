import { prisma } from "@/lib/db/prisma";
import { parseJson } from "@/lib/utils";
import { ScriptTypeLabel } from "@/lib/constants";

const ADJACENT: Record<string, string> = {
  DEDUCTION: "HARDCORE",
  HARDCORE: "RESTORATION",
  EMOTIONAL: "HORROR",
  COMEDY: "DEDUCTION",
  HORROR: "EMOTIONAL",
  RESTORATION: "DEDUCTION",
};

export interface Recommendation {
  recommendedType: string;
  recommendedTypeLabel: string;
  recommendedDifficulty: string | null;
  defaultPlayerMode: string | null;
  reason: string;
  exploreSuggestion: { type: string; label: string } | null;
  experienceSummary: string | null;
}

/**
 * 基于偏好档案 + 历史给出下次推荐（PRD 9.3）。
 * 若玩家多次选同类，提示"你可能也会喜欢 [相关类型]"扩展边界。
 */
export async function getRecommendation(userId: string): Promise<Recommendation> {
  const prefs = await prisma.userPreferences.findUnique({ where: { userId } });
  const recentSessions = await prisma.gameSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { script: { select: { scriptType: true } } },
  });

  const preferredTypes = parseJson<string[]>(prefs?.preferredScriptTypes, []);
  const topType = preferredTypes[0] ?? recentSessions[0]?.script.scriptType ?? "DEDUCTION";

  // 检测是否连续玩同类（>=3 局同类型 → 建议扩展）
  const recentTypes = recentSessions.map((s) => s.script.scriptType);
  const sameTypeStreak = recentTypes.filter((t) => t === topType).length;
  const exploreSuggestion =
    sameTypeStreak >= 3
      ? { type: ADJACENT[topType] ?? "EMOTIONAL", label: ScriptTypeLabel[(ADJACENT[topType] ?? "EMOTIONAL") as keyof typeof ScriptTypeLabel] }
      : null;

  const reason = prefs?.experienceSummary
    ? prefs.experienceSummary
    : recentSessions.length === 0
    ? "这是你的第一局——推荐从经典推理本开始。"
    : `根据你最近的游戏，为你推荐${ScriptTypeLabel[topType as keyof typeof ScriptTypeLabel]}。`;

  return {
    recommendedType: topType,
    recommendedTypeLabel: ScriptTypeLabel[topType as keyof typeof ScriptTypeLabel] ?? topType,
    recommendedDifficulty: prefs?.preferredDifficulty ?? null,
    defaultPlayerMode: prefs?.defaultPlayerMode ?? null,
    reason,
    exploreSuggestion,
    experienceSummary: prefs?.experienceSummary ?? null,
  };
}
