import type { GenerationParams } from "@/types/game";
import { ScriptTypeLabel, DifficultyLabel } from "@/lib/constants";

export function buildScriptGenerationPrompt(params: GenerationParams): string {
  return `你是一位资深剧本杀编剧，请根据以下需求创作一个完整的剧本杀剧本。

## 创作需求
- 剧本类型：${ScriptTypeLabel[params.scriptType] ?? params.scriptType}
- 时代背景：${params.era}
- 地点场景：${params.location}
- 角色数量：${params.characterCount} 人（含玩家角色，即角色1）
- 游戏时长：${params.duration}
- 难度：${DifficultyLabel[params.difficulty] ?? params.difficulty}
- 线索密度：${params.clueDensity}
- 叙事结构：${params.narrativeStructure}
- 文字风格：${params.writingStyle}
- 情感基调：${params.emotionalTone}
- 主题类型：${params.theme}
- 特殊元素：${(params.specialElements ?? []).join("、") || "无"}
- 翻转设计：${params.twistType}
- 结局类型：${params.endingType}
- 玩家角色身份：${params.playerRoleType}
- 角色关系复杂度：${params.relationshipComplexity ?? "适中"}
- 特殊角色要求：${params.customCharacterRequirements || "无"}
- 特殊机制：${(params.specialMechanics ?? []).join("、") || "无"}
- 内容边界：${(params.contentRestrictions ?? []).join("、") || "无限制"}

## 输出格式（严格按 JSON 格式输出，不要任何额外文字）

{
  "title": "剧本标题",
  "publicStory": "公共背景故事（所有玩家可见，500~800字）",
  "setting": { "era": "时代", "location": "地点" },
  "characters": [
    {
      "name": "角色姓名",
      "gender": "性别",
      "occupation": "职业",
      "publicProfile": "公开性格与背景（其他角色可见，100~150字）",
      "privateStory": "私密背景故事（仅本角色可见，300~500字）",
      "secrets": "持有的秘密（2~4条，用分号或换行分隔）",
      "hiddenGoal": "隐藏目标（游戏中需达成的目标）",
      "victoryCondition": "胜利条件（明确可判定的条件）",
      "unknownFacts": "该角色不知道的关键信息",
      "relationships": {"其他角色名": "与该角色的关系描述"},
      "isMurderer": false,
      "isVictim": false
    }
  ],
  "clueCards": [
    {
      "title": "线索名称",
      "content": "线索内容描述",
      "clueType": "PHYSICAL",
      "releasePhase": 3,
      "isSecret": false
    }
  ],
  "phaseConfig": [
    {
      "name": "阶段名称",
      "description": "阶段说明",
      "estimatedMinutes": 15,
      "objectives": ["本阶段目标"]
    }
  ],
  "murderSummary": "完整案情真相（仅供DM知晓，含凶手/动机/作案手法/时间线）"
}

## 创作要求
1. 必须正好生成 ${params.characterCount} 个角色，第 1 个角色（characters[0]）为玩家角色，须符合"玩家角色身份：${params.playerRoleType}"
2. 每个角色的胜利条件必须清晰、可判定，不能模糊
3. 推理/硬核/还原类必须有且仅有一个 isMurderer=true 的角色；凶手须有完整作案动机和手法
4. 线索必须能指向真相，但不能过于直白；releasePhase 取值参考阶段编号（搜证阶段通常为 2 或 3）
5. clueType 仅取：PHYSICAL（物证）/ TESTIMONY（证词）/ TIMELINE（时间线）/ SPECIAL（特殊）
6. 各角色之间必须有合理的关联和冲突点
7. 确保信息量与难度设定一致
8. 至少 4 张线索卡，至少覆盖 2 个不同 releasePhase`;
}
