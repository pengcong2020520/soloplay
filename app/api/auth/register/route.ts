import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";

/** 注册：邮箱 + 密码 + 昵称。成功后直接登录（设置签名 cookie）。 */
export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json();

  if (!email || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "请输入有效的邮箱" }, { status: 400 });
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, name: name || email.split("@")[0], passwordHash },
  });

  const res = NextResponse.json({ id: user.id, email: user.email, name: user.name });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(user.id, user.tokenVersion),
    sessionCookieOptions()
  );
  return res;
}
