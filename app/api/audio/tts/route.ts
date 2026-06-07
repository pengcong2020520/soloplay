import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/step-audio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = typeof body.text === "string" ? body.text : "";
    const voice = typeof body.voice === "string" ? body.voice : undefined;
    const audio = await synthesizeSpeech({ text, voice });

    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "TTS 生成失败" },
      { status: 500 }
    );
  }
}
