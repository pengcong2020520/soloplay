import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";
import { createSupabaseAuthClient, isSupabaseAuthConfigured } from "@/lib/supabase/auth";

/** 注册：邮箱 + 密码 + 昵称。身份源使用 Supabase Auth，业务资料同步到 public.User。 */
export async function POST(req: NextRequest) {
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json({ error: "Supabase Auth 未配置，暂时无法注册" }, { status: 503 });
  }

  const { email, password, name } = await req.json();
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const displayName =
    typeof name === "string" && name.trim() ? name.trim() : normalizedEmail.split("@")[0];

  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    return NextResponse.json({ error: "请输入有效的邮箱" }, { status: 400 });
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 });
  }

  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: { name: displayName },
    },
  });

  if (error) {
    const status = error.message.toLowerCase().includes("already") ? 409 : 400;
    return NextResponse.json({ error: error.message || "注册失败" }, { status });
  }

  if (!data.user) {
    return NextResponse.json({ error: "注册失败：Supabase 未返回用户信息" }, { status: 502 });
  }

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

  if (!data.session) {
    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      needsEmailConfirmation: true,
      message: "注册成功，请先完成邮箱验证后再登录。",
    });
  }

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
