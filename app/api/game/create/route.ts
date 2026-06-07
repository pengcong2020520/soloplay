import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveUserId } from "@/lib/auth/current-user";
import { PlayerMode, GameStatus, ScriptSource } from "@/lib/constants";

export async function POST(req: NextRequest) {
  const { scriptId, playerMode, playerCharacterId } = await req.json();

  if (!scriptId || !playerMode) {
    return NextResponse.json({ error: "缺少 scriptId 或 playerMode" }, { status: 400 });
  }
  if (playerMode !== PlayerMode.ROLE_PLAY && playerMode !== PlayerMode.DETECTIVE) {
    return NextResponse.json({ error: "playerMode 非法" }, { status: 400 });
  }

  const userId = await resolveUserId();
  const script = await prisma.script.findUnique({ where: { id: scriptId } });
  if (!script) return NextResponse.json({ error: "未找到剧本" }, { status: 404 });
  // 数据隔离：只能用自己的剧本或内置共享剧本开局，防止借用他人剧本
  if (script.userId !== userId && script.source !== ScriptSource.BUILTIN) {
    return NextResponse.json({ error: "无权使用该剧本" }, { status: 403 });
  }

  let engagementSignals: Record<string, unknown> = {};
  if (playerMode === PlayerMode.ROLE_PLAY && playerCharacterId) {
    const selectedCharacter = await prisma.character.findFirst({
      where: {
        id: playerCharacterId,
        scriptId,
        isVictim: false,
      },
      select: { id: true },
    });
    if (!selectedCharacter) {
      return NextResponse.json({ error: "选择的角色不可用于开局" }, { status: 400 });
    }
    engagementSignals = { selectedPlayerCharacterId: selectedCharacter.id };
  }

  const session = await prisma.gameSession.create({
    data: {
      userId,
      scriptId,
      playerMode,
      status: GameStatus.SETUP,
      currentPhase: 0,
      engagementSignals: JSON.stringify(engagementSignals),
    },
  });

  return NextResponse.json({ sessionId: session.id });
}
