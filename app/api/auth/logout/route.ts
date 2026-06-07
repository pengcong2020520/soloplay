import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/** 登出：清除会话 cookie（之后回退为游客 local-user）。 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
