import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";

/** 登录：邮箱 + 密码。成功后设置签名 cookie。 */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // 统一返回模糊错误，避免泄露"邮箱是否存在"
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  const res = NextResponse.json({ id: user.id, email: user.email, name: user.name });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(user.id, user.tokenVersion),
    sessionCookieOptions()
  );
  return res;
}
