import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * 登出所有设备：bump 当前用户的 tokenVersion，使其所有已签发的签名 cookie 立即失效，
 * 并清除本设备 cookie。用于"怀疑账号被盗"或"踢掉其他设备"。
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
