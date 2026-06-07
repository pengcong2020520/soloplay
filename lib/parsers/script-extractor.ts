import { completeJson } from "@/lib/anthropic";
import { MOCK_DEDUCTION_SCRIPT } from "@/lib/agents/mock-data";
import type { GeneratedScript } from "@/types/game";

/**
 * 用 Claude 从剧本原文中提取结构化信息。
 * 无密钥时返回样例剧本（仅作演示，提示用户人工修正）。
 */
export async function extractScriptFromText(rawText: string): Promise<GeneratedScript> {
  const truncated = rawText.slice(0, 40000); // 控制上下文

  const system = `你是剧本杀剧本结构化解析助手。从用户提供的剧本原文中，提取结构化信息，只输出 JSON。
优先识别结构化标题（如"公共故事""角色：XXX""胜利条件""线索"等关键词）。
若某字段在原文中缺失，请基于上下文合理补全（角色胜利条件若无则生成兜底条件），不要留空。`;

  const prompt = `请从以下剧本原文中提取结构化信息，严格按指定 JSON 格式输出（字段含义同 AI 生成剧本）：

{
  "title": "剧本标题",
  "publicStory": "公共背景故事",
  "setting": { "era": "时代", "location": "地点" },
  "characters": [
    {
      "name": "角色名", "gender": "性别", "occupation": "职业",
      "publicProfile": "公开性格背景", "privateStory": "私密剧本全文",
      "secrets": "秘密", "hiddenGoal": "隐藏目标", "victoryCondition": "胜利条件（缺失则生成兜底）",
      "unknownFacts": "不知道的信息", "relationships": {},
      "isMurderer": false, "isVictim": false
    }
  ],
  "clueCards": [
    { "title": "线索名", "content": "线索内容", "clueType": "PHYSICAL", "releasePhase": 3, "isSecret": false }
  ],
  "phaseConfig": [
    { "name": "阶段名", "description": "说明", "estimatedMinutes": 15, "objectives": [] }
  ],
  "murderSummary": "完整案情真相（仅DM知晓）"
}

要求：
1. 角色数量须在 3~8 之间；若识别出的角色超出，保留主要角色
2. 推理/硬核/还原类必须存在 isMurderer=true 的角色；若原文未明示凶手，根据线索推断标记一个最可能者
3. clueType 仅取 PHYSICAL/TESTIMONY/TIMELINE/SPECIAL

剧本原文：
"""
${truncated}
"""`;

  return completeJson<GeneratedScript>(
    {
      system,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 8000,
      temperature: 0.4,
    },
    () => ({ ...MOCK_DEDUCTION_SCRIPT, title: MOCK_DEDUCTION_SCRIPT.title + "（上传解析·样例）" })
  );
}

/**
 * 剧本校验（PRD 3.1）：按剧本类型差异化检查，返回告警列表（不阻断，仅提示）。
 */
export function validateParsedScript(
  script: GeneratedScript,
  scriptType: string
): string[] {
  const warnings: string[] = [];
  const count = script.characters?.length ?? 0;

  if (count < 3 || count > 8) {
    warnings.push(`角色数量为 ${count}，超出支持范围（3~8 人）。`);
  }

  const needsMurderer = ["DEDUCTION", "HARDCORE", "RESTORATION"].includes(scriptType);
  const hasMurderer = script.characters?.some((c) => c.isMurderer);
  if (needsMurderer && !hasMurderer) {
    warnings.push("推理/硬核/还原本未检测到凶手角色，请补充或人工标注。");
  }

  const missingVictory = script.characters?.filter((c) => !c.victoryCondition?.trim()) ?? [];
  if (missingVictory.length > 0) {
    warnings.push(
      `以下角色缺少胜利条件，已生成兜底：${missingVictory.map((c) => c.name).join("、")}`
    );
  }

  if (!script.publicStory?.trim()) {
    warnings.push("未识别到公共故事，请补充。");
  }

  return warnings;
}
