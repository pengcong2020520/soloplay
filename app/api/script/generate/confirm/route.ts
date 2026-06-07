import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/current-user";
import { generateScript, persistScript } from "@/lib/agents/script-generator";
import type { GenerationParams } from "@/types/game";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const params = (await req.json()) as GenerationParams;

    if (!params?.scriptType) {
      return NextResponse.json({ error: "缺少剧本类型" }, { status: 400 });
    }

    const userId = await resolveUserId();
    const generated = await generateScript(params);
    const scriptId = await persistScript(userId, generated, params);

    return NextResponse.json({
      scriptId,
      title: generated.title,
      publicStory: generated.publicStory,
      characterCount: generated.characters.length,
      // 仅返回公开预览（角色公开档案，不含私密）
      characters: generated.characters.map((c) => ({
        name: c.name,
        gender: c.gender,
        occupation: c.occupation,
        publicProfile: c.publicProfile,
      })),
    });
  } catch (err) {
    console.error("[generate/confirm]", err);
    return NextResponse.json(
      { error: "剧本生成失败，请重试。" + (err as Error)?.message },
      { status: 500 }
    );
  }
}
