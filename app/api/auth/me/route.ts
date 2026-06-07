import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/** 返回当前登录用户（未登录则 user=null，前端据此显示登录入口/游客态）。 */
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}
