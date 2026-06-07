import { NextRequest, NextResponse } from "next/server";
import { transcribePcm16 } from "@/lib/step-audio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    const sampleRate =
      typeof body.sampleRate === "number" && body.sampleRate > 0
        ? Math.round(body.sampleRate)
        : 16000;
    const language = typeof body.language === "string" ? body.language : "zh";

    const text = await transcribePcm16({ audioBase64, sampleRate, language });
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "ASR 识别失败" },
      { status: 500 }
    );
  }
}
