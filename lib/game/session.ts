import { prisma } from "@/lib/db/prisma";
import { parseJson } from "@/lib/utils";
import { resolvePhaseConfig } from "@/lib/game/phase-configs";
import type { PhaseConfig, GameStateSnapshot, GeneratedPhase } from "@/types/game";
import type { ScriptType, PlayerMode } from "@/lib/constants";
import type {
  GameSession,
  Script,
  Character,
  SessionCharacter,
} from "@prisma/client";

export interface LoadedSession {
  session: GameSession;
  script: Script;
  sessionCharacters: (SessionCharacter & { character: Character })[];
  phases: PhaseConfig[];
  playerMode: PlayerMode;
  currentPhase: number;
  state: GameStateSnapshot;
}

/**
 * 加载一局游戏的全部运行时数据。
 * @param expectedUserId 传入时做归属校验：会话不属于该用户则返回 null（数据隔离的核心收口点，覆盖 9+ 路由）。
 *                       不传则不校验（用于内部、复盘等已自行鉴权的场景）。
 */
export async function loadSession(
  sessionId: string,
  expectedUserId?: string
): Promise<LoadedSession | null> {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return null;
  if (expectedUserId && session.userId !== expectedUserId) return null;

  const script = await prisma.script.findUnique({ where: { id: session.scriptId } });
  if (!script) return null;

  const sessionCharacters = await prisma.sessionCharacter.findMany({
    where: { sessionId },
    include: { character: true },
  });

  const generatedPhases = parseJson<GeneratedPhase[]>(script.phaseConfig, []);
  const phases = resolvePhaseConfig(script.scriptType as ScriptType, generatedPhases);

  const releasedClueIds = (
    await prisma.clueRelease.findMany({
      where: { sessionId },
      select: { clueCardId: true },
    })
  ).map((r) => r.clueCardId);

  const state: GameStateSnapshot = {
    playerMode: session.playerMode as PlayerMode,
    currentPhase: session.currentPhase,
    engagementSignals: parseJson(session.engagementSignals, {}),
    hintsUsed: session.hintsUsed,
    difficultyAdjusted: session.difficultyAdjusted,
    releasedClueIds,
    phaseStartedAt: session.phaseStartedAt ? session.phaseStartedAt.toISOString() : null,
  };

  return {
    session,
    script,
    sessionCharacters,
    phases,
    playerMode: session.playerMode as PlayerMode,
    currentPhase: session.currentPhase,
    state,
  };
}

export function getCurrentPhase(loaded: LoadedSession): PhaseConfig {
  return loaded.phases[loaded.currentPhase] ?? loaded.phases[loaded.phases.length - 1];
}

/**
 * 取某阶段的超时秒数（advanceConditions 里 type==="TIME" 的 value）。
 * 没有 TIME 条件（如复盘/投票阶段）返回 null —— 这类阶段不应自动推进。
 */
export function getPhaseTimeLimitSec(phase: PhaseConfig): number | null {
  const time = phase.advanceConditions.find((c) => c.type === "TIME");
  const v = time?.value;
  return typeof v === "number" && v > 0 ? v : null;
}

/** 取 AI 角色（排除玩家槽与死者） */
export function getAiCharacters(loaded: LoadedSession) {
  return loaded.sessionCharacters.filter(
    (sc) => sc.assignedTo === "AI" && !sc.character.isVictim
  );
}

export function getPlayerCharacter(loaded: LoadedSession) {
  return loaded.sessionCharacters.find((sc) => sc.assignedTo === "PLAYER");
}
