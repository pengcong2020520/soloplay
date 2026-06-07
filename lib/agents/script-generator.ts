import { completeJson } from "@/lib/anthropic";
import { buildScriptGenerationPrompt } from "@/lib/agents/prompts/generation";
import { MOCK_DEDUCTION_SCRIPT } from "@/lib/agents/mock-data";
import { prisma } from "@/lib/db/prisma";
import { ScriptSource } from "@/lib/constants";
import type { GenerationParams, GeneratedScript } from "@/types/game";

/** 调用 Claude（或 mock）生成完整剧本 JSON */
export async function generateScript(params: GenerationParams): Promise<GeneratedScript> {
  const prompt = buildScriptGenerationPrompt(params);
  return completeJson<GeneratedScript>(
    {
      system: "你是一位资深剧本杀编剧，只输出 JSON。",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 8000,
      temperature: 0.95,
    },
    () => MOCK_DEDUCTION_SCRIPT
  );
}

/** 把生成的剧本持久化到数据库，返回 scriptId */
export async function persistScript(
  userId: string,
  generated: GeneratedScript,
  params: GenerationParams,
  source: string = ScriptSource.AI_GENERATED
): Promise<string> {
  const durationMin =
    generated.phaseConfig?.reduce((s, p) => s + (p.estimatedMinutes || 0), 0) || 90;

  const script = await prisma.script.create({
    data: {
      userId,
      title: generated.title,
      scriptType: params.scriptType,
      source,
      publicStory: generated.publicStory,
      setting: JSON.stringify(generated.setting ?? {}),
      characterCount: generated.characters.length,
      estimatedDuration: durationMin,
      difficulty: params.difficulty,
      phaseConfig: JSON.stringify(generated.phaseConfig ?? []),
      murderSummary: generated.murderSummary,
      generationParams: JSON.stringify(params),
      characters: {
        create: generated.characters.map((c, idx) => ({
          name: c.name,
          gender: c.gender,
          occupation: c.occupation,
          publicProfile: c.publicProfile,
          privateStory: c.privateStory,
          secrets: c.secrets,
          hiddenGoal: c.hiddenGoal,
          victoryCondition: c.victoryCondition,
          unknownFacts: c.unknownFacts,
          relationships: JSON.stringify(c.relationships ?? {}),
          isMurderer: c.isMurderer,
          isVictim: c.isVictim,
          isPlayerSlot: idx === 0, // 角色1 = 玩家角色槽
        })),
      },
      clueCards: {
        create: generated.clueCards.map((cl) => ({
          title: cl.title,
          content: cl.content,
          clueType: cl.clueType,
          releasePhase: cl.releasePhase,
          isSecret: cl.isSecret,
        })),
      },
    },
  });

  return script.id;
}
