import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";
import { createSupabaseAuthClient, isSupabaseAuthConfigured } from "@/lib/supabase/auth";

/** 登录：邮箱 + 密码。身份校验使用 Supabase Auth，成功后设置游戏业务 cookie。 */
export async function POST(req: NextRequest) {
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json({ error: "Supabase Auth 未配置，暂时无法登录" }, { status: 503 });
  }

  const { email, password } = await req.json();
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail || !password) {
    return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });
  }

  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error || !data.user) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  const displayName =
    typeof data.user.user_metadata?.name === "string" && data.user.user_metadata.name.trim()
      ? data.user.user_metadata.name.trim()
      : normalizedEmail.split("@")[0];

  const user = await prisma.user.upsert({
    where: { id: data.user.id },
    update: {
      email: normalizedEmail,
      name: displayName,
      passwordHash: null,
    },
    create: {
      id: data.user.id,
      email: normalizedEmail,
      name: displayName,
      passwordHash: null,
    },
  });

  const res = NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    provider: "supabase",
  });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(user.id, user.tokenVersion),
    sessionCookieOptions()
  );
  return res;
}
