import { NextRequest, NextResponse } from "next/server";
import { submitFeedback, type FeedbackInput } from "@/lib/game/feedback";
import { assertSessionOwner } from "@/lib/auth/current-user";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await assertSessionOwner(params.id);
    if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });
    const feedback = (await req.json()) as FeedbackInput;
    const result = await submitFeedback(params.id, feedback);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
