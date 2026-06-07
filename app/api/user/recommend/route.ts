import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/current-user";
import { getRecommendation } from "@/lib/game/recommend";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await resolveUserId();
  const rec = await getRecommendation(userId);
  return NextResponse.json(rec);
}
