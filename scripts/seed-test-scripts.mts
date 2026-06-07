// 批量插入测试剧本（不走 LLM，秒级完成），便于测试验收。
// 用法：npx tsx scripts/seed-test-scripts.mts
// 复用现有 3 个完整剧本对象，以「测试」前缀标题插入到 local-user（游客）名下。

import { prisma } from "../lib/db/prisma";
import { persistScript } from "../lib/agents/script-generator";
import { MOCK_DEDUCTION_SCRIPT } from "../lib/agents/mock-data";
import { BUILTIN_EMOTIONAL_SCRIPT, BUILTIN_COMEDY_SCRIPT } from "../lib/agents/builtin-scripts";
import { LOCAL_USER, ScriptSource, ScriptType, Difficulty } from "../lib/constants";
import type { GeneratedScript, GenerationParams } from "../types/game";

const TEST_USER = LOCAL_USER.id; // 游客账号，免登录即可看到

interface Entry {
  script: GeneratedScript;
  scriptType: string;
  difficulty: string;
  titleSuffix: string;
}

const ENTRIES: Entry[] = [
  { script: MOCK_DEDUCTION_SCRIPT, scriptType: ScriptType.DEDUCTION, difficulty: Difficulty.INTERMEDIATE, titleSuffix: "推理" },
  { script: BUILTIN_EMOTIONAL_SCRIPT, scriptType: ScriptType.EMOTIONAL, difficulty: Difficulty.BEGINNER, titleSuffix: "情感" },
  { script: BUILTIN_COMEDY_SCRIPT, scriptType: ScriptType.COMEDY, difficulty: Difficulty.BEGINNER, titleSuffix: "欢乐" },
];

function paramsFor(e: Entry): GenerationParams {
  return {
    scriptType: e.scriptType as GenerationParams["scriptType"],
    era: e.script.setting?.era ?? "未知",
    location: e.script.setting?.location ?? "未知",
    characterCount: e.script.characters.length,
    duration: "MEDIUM",
    difficulty: e.difficulty as GenerationParams["difficulty"],
    clueDensity: "MEDIUM",
    narrativeStructure: "LINEAR",
    writingStyle: "IMMERSIVE",
    emotionalTone: "NEUTRAL",
    theme: e.script.title,
    specialElements: [],
    twistType: "NONE",
    endingType: "OPEN",
    playerRoleType: "PARTICIPANT",
    specialMechanics: [],
    contentRestrictions: [],
  };
}

async function main() {
  // 确保游客账号存在
  await prisma.user.upsert({
    where: { id: TEST_USER },
    update: {},
    create: { id: TEST_USER, email: LOCAL_USER.email, name: LOCAL_USER.name },
  });

  const HOW_MANY = Number(process.argv[2]) || 1; // 每个类型插几份（默认各 1，共 3 个）
  let count = 0;
  for (let n = 1; n <= HOW_MANY; n++) {
    for (const e of ENTRIES) {
      const cloned: GeneratedScript = {
        ...e.script,
        title: `【测试·${e.titleSuffix}】${e.script.title}${HOW_MANY > 1 ? ` #${n}` : ""}`,
      };
      const id = await persistScript(TEST_USER, cloned, paramsFor(e), ScriptSource.AI_GENERATED);
      console.log(`✓ 插入 [${e.scriptType}] ${cloned.title}  (id=${id})`);
      count++;
    }
  }
  console.log(`\n共插入 ${count} 个测试剧本，归属游客账号 local-user（免登录可见）。`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
