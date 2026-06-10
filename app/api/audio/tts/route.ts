import { NextRequest, NextResponse } from "next/server";
import { buildRoleSpeechOptions, synthesizeSpeech } from "@/lib/step-audio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = typeof body.text === "string" ? body.text : "";
    const options = buildRoleSpeechOptions({
      text,
      senderType: typeof body.senderType === "string" ? body.senderType : undefined,
      senderName: typeof body.senderName === "string" ? body.senderName : undefined,
      gender: typeof body.gender === "string" ? body.gender : undefined,
      occupation: typeof body.occupation === "string" ? body.occupation : undefined,
      publicProfile: typeof body.publicProfile === "string" ? body.publicProfile : undefined,
      voice: typeof body.voice === "string" ? body.voice : undefined,
    });
    const audio = await synthesizeSpeech(options);

    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Step-TTS-Voice": options.voice,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "TTS 生成失败" },
      { status: 500 }
    );
  }
}
