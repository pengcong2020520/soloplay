import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  loadSession,
  getCurrentPhase,
  getPlayerCharacter,
  getPhaseTimeLimitSec,
} from "@/lib/game/session";
import { resolveUserId } from "@/lib/auth/current-user";
import { HAS_API_KEY } from "@/lib/anthropic";
import { PlayerMode } from "@/lib/constants";
import { getCharacterAvatarUrl } from "@/lib/avatars";
import { parseJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await resolveUserId();
  const loaded = await loadSession(params.id, userId);
  if (!loaded) return NextResponse.json({ error: "未找到会话" }, { status: 404 });

  const phase = getCurrentPhase(loaded);
  const playerSc = getPlayerCharacter(loaded);

  // 已发布的线索卡
  const releases = await prisma.clueRelease.findMany({
    where: { sessionId: params.id },
    orderBy: { releasedAt: "asc" },
  });
  const clueIds = releases.map((r) => r.clueCardId);
  const clues =
    clueIds.length > 0
      ? await prisma.clueCard.findMany({ where: { id: { in: clueIds } } })
      : [];

  return NextResponse.json({
    sessionId: loaded.session.id,
    status: loaded.session.status,
    playerMode: loaded.playerMode,
    scriptTitle: loaded.script.title,
    scriptType: loaded.script.scriptType,
    publicStory: loaded.script.publicStory,
    setting: parseJson<Record<string, unknown>>(loaded.script.setting, {}),
    difficulty: loaded.script.difficulty,
    estimatedDuration: loaded.script.estimatedDuration,
    currentPhase: loaded.currentPhase,
    totalPhases: loaded.phases.length,
    phase: {
      id: phase.id,
      name: phase.name,
      description: phase.description,
      permissions: phase.permissions,
      playerPaceControl: phase.playerPaceControl ?? null,
    },
    phases: loaded.phases.map((p) => ({ id: p.id, name: p.name })),
    hintsUsed: loaded.session.hintsUsed,
    usingMockData: !HAS_API_KEY,
    // 阶段超时自动推进：当前阶段进入时间 + TIME 秒数（无 TIME 条件则为 null，前端不计时）
    phaseStartedAt: loaded.state.phaseStartedAt,
    phaseTimeLimitSec: getPhaseTimeLimitSec(phase),
    // 角色公开列表
    characters: loaded.sessionCharacters.map((sc) => ({
      id: sc.character.id,
      name: sc.character.name,
      gender: sc.character.gender,
      occupation: sc.character.occupation,
      publicProfile: sc.character.publicProfile,
      assignedTo: sc.assignedTo,
      avatarUrl: getCharacterAvatarUrl(`${loaded.script.title}-${sc.character.name}`),
    })),
    // 玩家自己的私密剧本（仅 ROLE_PLAY）
    playerCharacter:
      loaded.playerMode === PlayerMode.ROLE_PLAY && playerSc
        ? {
            id: playerSc.character.id,
            name: playerSc.character.name,
            gender: playerSc.character.gender,
            occupation: playerSc.character.occupation,
            publicProfile: playerSc.character.publicProfile,
            privateStory: playerSc.character.privateStory,
            secrets: playerSc.character.secrets,
            hiddenGoal: playerSc.character.hiddenGoal,
            victoryCondition: playerSc.character.victoryCondition,
            avatarUrl: getCharacterAvatarUrl(`${loaded.script.title}-${playerSc.character.name}`),
          }
        : null,
    releasedClues: clues.map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      clueType: c.clueType,
    })),
  });
}
