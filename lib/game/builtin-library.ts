import { prisma } from "@/lib/db/prisma";
import { persistScript } from "@/lib/agents/script-generator";
import { BUILTIN_USER, ScriptSource, ScriptType, Difficulty } from "@/lib/constants";
import { MOCK_DEDUCTION_SCRIPT } from "@/lib/agents/mock-data";
import { getCharacterAvatarUrl } from "@/lib/avatars";
import { buildScriptVisualStyle, decorateGeneratedClue } from "@/lib/game/clue-visuals";
import {
  BUILTIN_EMOTIONAL_SCRIPT,
  BUILTIN_COMEDY_SCRIPT,
  BUILTIN_HARDCORE_SCRIPT,
  BUILTIN_HORROR_SCRIPT,
  BUILTIN_RESTORATION_SCRIPT,
} from "@/lib/agents/builtin-scripts";
import type { GeneratedScript, GenerationParams } from "@/types/game";

/** 内置剧本库的条目定义（内容 + 元数据） */
interface BuiltinEntry {
  /** 稳定 key，用于幂等 seed（避免重复插入） */
  key: string;
  script: GeneratedScript;
  scriptType: string;
  difficulty: string;
}

/**
 * 内置剧本清单。新增内置剧本：在 lib/agents/builtin-scripts.ts 写好对象，再在此登记一条。
 * 「雾港庄园」复用 mock 样例（也是无密钥时的兜底剧本），一鱼两吃。
 */
export const BUILTIN_LIBRARY: BuiltinEntry[] = [
  {
    key: "deduction-misty-harbor",
    script: MOCK_DEDUCTION_SCRIPT,
    scriptType: ScriptType.DEDUCTION,
    difficulty: Difficulty.INTERMEDIATE,
  },
  {
    key: "emotional-builtin",
    script: BUILTIN_EMOTIONAL_SCRIPT,
    scriptType: ScriptType.EMOTIONAL,
    difficulty: Difficulty.BEGINNER,
  },
  {
    key: "comedy-builtin",
    script: BUILTIN_COMEDY_SCRIPT,
    scriptType: ScriptType.COMEDY,
    difficulty: Difficulty.BEGINNER,
  },
  {
    key: "hardcore-zero-cabin",
    script: BUILTIN_HARDCORE_SCRIPT,
    scriptType: ScriptType.HARDCORE,
    difficulty: Difficulty.HARDCORE,
  },
  {
    key: "horror-huai-village",
    script: BUILTIN_HORROR_SCRIPT,
    scriptType: ScriptType.HORROR,
    difficulty: Difficulty.INTERMEDIATE,
  },
  {
    key: "restoration-abyss-train",
    script: BUILTIN_RESTORATION_SCRIPT,
    scriptType: ScriptType.RESTORATION,
    difficulty: Difficulty.INTERMEDIATE,
  },
];

/** 构造一个最小可用的 GenerationParams（persistScript 需要它取 scriptType/difficulty） */
function paramsFor(entry: BuiltinEntry): GenerationParams {
  return {
    scriptType: entry.scriptType as GenerationParams["scriptType"],
    era: entry.script.setting?.era ?? "未知",
    location: entry.script.setting?.location ?? "未知",
    characterCount: entry.script.characters.length,
    duration: "MEDIUM",
    difficulty: entry.difficulty as GenerationParams["difficulty"],
    clueDensity: "MEDIUM",
    narrativeStructure: "LINEAR",
    writingStyle: "IMMERSIVE",
    emotionalTone: "NEUTRAL",
    theme: entry.script.title,
    specialElements: [],
    twistType: "NONE",
    endingType: "OPEN",
    playerRoleType: "PARTICIPANT",
    specialMechanics: [],
    contentRestrictions: [],
  };
}

/** 确保内置库用户存在 */
async function ensureBuiltinUser(): Promise<string> {
  await prisma.user.upsert({
    where: { id: BUILTIN_USER.id },
    update: {},
    create: { id: BUILTIN_USER.id, email: BUILTIN_USER.email, name: BUILTIN_USER.name },
  });
  return BUILTIN_USER.id;
}

/**
 * 幂等地把内置剧本写入数据库（source=BUILTIN，归属 builtin-library 用户）。
 * 用「同一用户下同 title 已存在」判断是否已 seed，避免重复。
 * 可在应用启动、首次访问库列表时调用。
 */
export async function ensureBuiltinLibrary(): Promise<void> {
  const userId = await ensureBuiltinUser();

  for (const entry of BUILTIN_LIBRARY) {
    const exists = await prisma.script.findFirst({
      where: { userId, source: ScriptSource.BUILTIN, title: entry.script.title },
      select: { id: true },
    });
    const scriptId =
      exists?.id ?? (await persistScript(userId, entry.script, paramsFor(entry), ScriptSource.BUILTIN));
    await refreshBuiltinVisualAssets(scriptId, entry);
  }
}

async function refreshBuiltinVisualAssets(scriptId: string, entry: BuiltinEntry) {
  const visualStyle = buildScriptVisualStyle(entry.script.title, entry.script.setting);
  await prisma.script.update({
    where: { id: scriptId },
    data: { visualStyle: JSON.stringify(visualStyle) },
  });

  const decoratedClues = entry.script.clueCards.map((clue, index) =>
    decorateGeneratedClue(entry.script.title, clue, index, entry.script.setting)
  );

  for (const clue of decoratedClues) {
    await prisma.clueCard.updateMany({
      where: { scriptId, title: clue.title },
      data: {
        imageUrl: clue.imageUrl,
        mediaType: clue.mediaType ?? "image",
        videoUrl: clue.videoUrl,
        visualBatchId: clue.visualBatchId,
        visualPrompt: clue.visualPrompt,
        sequenceIndex: clue.sequenceIndex,
        sharePolicy: clue.sharePolicy ?? "PUBLIC_AFTER_RELEASE",
      },
    });
  }
}

/** 列出内置库剧本（公开元数据，不含真相/私密剧本） */
export async function listBuiltinScripts() {
  await ensureBuiltinLibrary();
  const scripts = await prisma.script.findMany({
    where: { userId: BUILTIN_USER.id, source: ScriptSource.BUILTIN },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      scriptType: true,
      difficulty: true,
      characterCount: true,
      estimatedDuration: true,
      publicStory: true,
      characters: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          name: true,
          gender: true,
          occupation: true,
          publicProfile: true,
          isPlayerSlot: true,
          isVictim: true,
        },
      },
    },
  });
  return scripts.map((script) => ({
    ...script,
    characters: script.characters
      .filter((c) => !c.isVictim)
      .map((c) => ({
        id: c.id,
        name: c.name,
        gender: c.gender,
        occupation: c.occupation,
        publicProfile: c.publicProfile,
        isPlayerSlot: c.isPlayerSlot,
        avatarUrl: getCharacterAvatarUrl(`${script.title}-${c.name}`),
      })),
  }));
}
