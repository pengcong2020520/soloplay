import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PUBLIC_CHANNEL_KEY } from "@/lib/constants";
import { assertSessionOwner } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await assertSessionOwner(params.id);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const channelKey = searchParams.get("channelKey") ?? PUBLIC_CHANNEL_KEY;

  // 公共视图：公共频道 + DM 广播 + DM 给玩家的提示
  const where =
    channelKey === PUBLIC_CHANNEL_KEY
      ? {
          sessionId: params.id,
          isVisible: true,
          channelType: { in: ["PUBLIC", "DM_BROADCAST", "DM_HINT"] },
        }
      : {
          sessionId: params.id,
          isVisible: true,
          channelType: "PRIVATE",
          channelKey,
        };

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      channelType: m.channelType,
      channelKey: m.channelKey,
      senderType: m.senderType,
      senderId: m.senderId,
      senderName: m.senderName,
      content: m.content,
      phase: m.phase,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
