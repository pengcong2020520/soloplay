import { NextRequest, NextResponse } from "next/server";
import { getRecommendation } from "@/lib/game/recommend";
import { assertSessionOwner } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await assertSessionOwner(params.id);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });
  // 用当前登录用户 id（不再信任 session.userId）
  const rec = await getRecommendation(auth.userId);
  return NextResponse.json(rec);
}
