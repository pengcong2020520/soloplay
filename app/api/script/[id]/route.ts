import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { parseJson } from "@/lib/utils";
import { resolveUserId } from "@/lib/auth/current-user";
import { ScriptSource } from "@/lib/constants";
import { getCharacterAvatarUrl } from "@/lib/avatars";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await resolveUserId();
  const script = await prisma.script.findUnique({
    where: { id: params.id },
    include: { characters: true, clueCards: true },
  });
  if (!script) return NextResponse.json({ error: "未找到剧本" }, { status: 404 });
  // 数据隔离：只能预览自己的或内置共享剧本
  if (script.userId !== userId && script.source !== ScriptSource.BUILTIN) {
    return NextResponse.json({ error: "无权访问该剧本" }, { status: 403 });
  }

  // 仅返回公开信息预览（不含私密剧本/真相）
  return NextResponse.json({
    id: script.id,
    title: script.title,
    scriptType: script.scriptType,
    difficulty: script.difficulty,
    characterCount: script.characterCount,
    estimatedDuration: script.estimatedDuration,
    publicStory: script.publicStory,
    setting: parseJson(script.setting, {}),
    characters: script.characters
      .filter((c) => !c.isVictim)
      .map((c) => ({
        id: c.id,
        name: c.name,
        gender: c.gender,
        occupation: c.occupation,
        publicProfile: c.publicProfile,
        isPlayerSlot: c.isPlayerSlot,
        avatarUrl: getCharacterAvatarUrl(`${script.title}-${c.name}`),
      })),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await resolveUserId();
  // 用 deleteMany 带 userId 条件，确保只能删除自己的剧本（越权防护）
  const res = await prisma.script.deleteMany({
    where: { id: params.id, userId },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "未找到剧本或无权删除" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
