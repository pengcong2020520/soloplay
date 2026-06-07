import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/current-user";
import { extractText } from "@/lib/parsers/extract-text";
import { extractScriptFromText, validateParsedScript } from "@/lib/parsers/script-extractor";
import { persistScript } from "@/lib/agents/script-generator";
import { ScriptSource } from "@/lib/constants";
import type { GenerationParams } from "@/types/game";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const scriptType = (formData.get("scriptType") as string) || "DEDUCTION";

    if (!file) {
      return NextResponse.json({ error: "未提供文件" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rawText = await extractText(buffer, file.name, file.type);

    if (!rawText.trim()) {
      return NextResponse.json({ error: "文件内容为空或无法读取" }, { status: 400 });
    }

    const parsed = await extractScriptFromText(rawText);
    const warnings = validateParsedScript(parsed, scriptType);

    const userId = await resolveUserId();
    const params: GenerationParams = {
      scriptType: scriptType as any,
      era: parsed.setting?.era ?? "未知",
      location: parsed.setting?.location ?? "未知",
      characterCount: parsed.characters.length,
      duration: "中",
      difficulty: "INTERMEDIATE" as any,
      clueDensity: "适中",
      narrativeStructure: "线性单线",
      writingStyle: "现代白话",
      emotionalTone: "严肃烧脑",
      theme: "未知",
      specialElements: [],
      twistType: "未知",
      endingType: "唯一真相",
      playerRoleType: "随机分配",
      specialMechanics: [],
      contentRestrictions: [],
    };

    const scriptId = await persistScript(userId, parsed, params, ScriptSource.UPLOAD);

    return NextResponse.json({
      scriptId,
      title: parsed.title,
      publicStory: parsed.publicStory,
      characterCount: parsed.characters.length,
      characters: parsed.characters.map((c) => ({
        name: c.name,
        occupation: c.occupation,
        publicProfile: c.publicProfile,
        isMurderer: c.isMurderer,
        isVictim: c.isVictim,
      })),
      warnings,
    });
  } catch (err) {
    console.error("[script/upload]", err);
    return NextResponse.json(
      { error: (err as Error)?.message ?? "解析失败" },
      { status: 500 }
    );
  }
}
