import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LOCAL_USER } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** 查询当前可认领的游客数据量（登录后用于决定是否提示认领）。 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.id === LOCAL_USER.id) {
    return NextResponse.json({ scripts: 0, sessions: 0 });
  }
  const [scripts, sessions] = await prisma.$transaction([
    prisma.script.count({ where: { userId: LOCAL_USER.id } }),
    prisma.gameSession.count({ where: { userId: LOCAL_USER.id } }),
  ]);
  return NextResponse.json({ scripts, sessions });
}

/**
 * 游客数据认领：把游客账号 local-user 名下的剧本与游戏会话归属到当前登录用户。
 * 仅已登录用户可调用；把 Script.userId / GameSession.userId 从 local-user 改为当前用户。
 *
 * 注意：local-user 是本机所有游客共享的账号，认领是「把本机游客积累的数据搬到我的账号」的显式操作。
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  if (user.id === LOCAL_USER.id) {
    return NextResponse.json({ error: "游客账号无需认领" }, { status: 400 });
  }

  // 把 local-user 名下的剧本与会话改归当前用户
  const [scripts, sessions] = await prisma.$transaction([
    prisma.script.updateMany({
      where: { userId: LOCAL_USER.id },
      data: { userId: user.id },
    }),
    prisma.gameSession.updateMany({
      where: { userId: LOCAL_USER.id },
      data: { userId: user.id },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    claimedScripts: scripts.count,
    claimedSessions: sessions.count,
  });
}
