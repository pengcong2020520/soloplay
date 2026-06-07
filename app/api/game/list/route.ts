import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveUserId } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await resolveUserId();
  const sessions = await prisma.gameSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { script: { select: { title: true, scriptType: true } } },
  });

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.script.title,
      scriptType: s.script.scriptType,
      playerMode: s.playerMode,
      status: s.status,
      currentPhase: s.currentPhase,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}
