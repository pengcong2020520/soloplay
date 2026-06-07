import { NextResponse } from "next/server";
import { listBuiltinScripts } from "@/lib/game/builtin-library";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 内置剧本库列表（首次访问时惰性 seed）。所有用户共享，可直接开局。 */
export async function GET() {
  const scripts = await listBuiltinScripts();
  return NextResponse.json({ scripts });
}
