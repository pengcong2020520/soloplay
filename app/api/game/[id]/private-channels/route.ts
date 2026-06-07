import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadSession, getAiCharacters } from "@/lib/game/session";
import { resolveUserId } from "@/lib/auth/current-user";
import { getPrivateChannelKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * 列出玩家可发起的私聊对象（所有 AI 角色），
 * 以及每个私聊频道已有的消息条数（用于 UI 红点/排序）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await resolveUserId();
  const loaded = await loadSession(params.id, userId);
  if (!loaded) return NextResponse.json({ error: "未找到会话" }, { status: 404 });

  const ai = getAiCharacters(loaded).map((sc) => sc.character);

  const channels = await Promise.all(
    ai.map(async (c) => {
      const channelKey = getPrivateChannelKey("player", c.id);
      const count = await prisma.message.count({
        where: { sessionId: params.id, channelType: "PRIVATE", channelKey },
      });
      const last = await prisma.message.findFirst({
        where: { sessionId: params.id, channelType: "PRIVATE", channelKey },
        orderBy: { createdAt: "desc" },
      });
      return {
        characterId: c.id,
        characterName: c.name,
        occupation: c.occupation,
        channelKey,
        messageCount: count,
        lastMessage: last?.content?.slice(0, 30) ?? null,
      };
    })
  );

  return NextResponse.json({ channels });
}
