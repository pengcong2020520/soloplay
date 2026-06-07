import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveUserId } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await resolveUserId();
  const scripts = await prisma.script.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      scriptType: true,
      difficulty: true,
      characterCount: true,
      estimatedDuration: true,
      publicStory: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ scripts });
}
