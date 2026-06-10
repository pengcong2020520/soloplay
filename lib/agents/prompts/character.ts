import type { ScriptType, PlayerMode } from "@/lib/constants";

export interface CharacterPromptInput {
  publicStory: string;
  character: {
    name: string;
    gender?: string | null;
    occupation?: string | null;
    publicProfile: string;
    privateStory: string;
    secrets: string;
    unknownFacts?: string | null;
    hiddenGoal: string;
    victoryCondition: string;
  };
  currentPhase: number;
  phaseDescription: string;
  scriptType: ScriptType;
  playerMode: PlayerMode;
}

const toneInstruction: Record<ScriptType, string> = {
  DEDUCTION: "保持冷静理性，措辞精准",
  HARDCORE: "信息密集，表达严谨，情绪克制",
  EMOTIONAL: "情感丰富，表达有层次，可以流露真实情绪",
  COMEDY: "语气轻松，可以带点幽默，不必过于严肃",
  HORROR: "营造紧张感，措辞谨慎，带有一定的恐惧或压迫感",
  RESTORATION: "像在陈述证词，清晰有条理，对时间和细节敏感",
};

const cadenceOptions = [
  "句子偏短，先给态度，再补一个具体细节",
  "说话克制，常用停顿感把重点压低",
  "会先反问一句，再给出自己的解释",
  "表达直接，不绕太多铺垫",
  "会把情绪藏在礼貌或专业判断后面",
];

const defenseOptions = [
  "被质疑时先澄清边界，再把矛盾推回证据本身",
  "被逼问时会抓住对方话里的漏洞反击",
  "不轻易否认全部，只承认对自己最安全的部分",
  "会把话题引向另一个更可疑的人或细节",
  "会要求别人给出时间、地点或动机上的实证",
];

const handoffOptions = [
  "抛话时点名一个人，并给出非常具体的问题",
  "会邀请玩家判断某个细节是否合理",
  "会把刚出现的矛盾整理成一句尖锐追问",
  "会用一句短评把压力递给现场另一个角色",
  "会把自己的怀疑藏在看似客观的观察里",
];

function buildCharacterSpeechStyle(character: CharacterPromptInput["character"]) {
  const seed = `${character.name}-${character.gender ?? ""}-${character.occupation ?? ""}-${character.publicProfile}`;
  const occupation = character.occupation ? `带有${character.occupation}的职业视角` : "多从个人处境出发";
  return [
    `身份气质：${occupation}，不要像旁白或主持人在总结局势`,
    `语速与句式：${pickBySeed(cadenceOptions, seed, 0)}`,
    `防御方式：${pickBySeed(defenseOptions, seed, 1)}`,
    `推进讨论：${pickBySeed(handoffOptions, seed, 2)}`,
  ].join("\n");
}

function pickBySeed(options: string[], seed: string, offset: number) {
  return options[(hashText(seed) + offset) % options.length];
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function buildCharacterSystemPrompt(params: CharacterPromptInput): string {
  const playerModeInstruction =
    params.playerMode === "DETECTIVE"
      ? `游戏中有一位外来侦探（玩家）正在调查此事。你知道有这位侦探的存在。你对他的配合程度取决于你的角色立场——如果配合有利于你，则适当配合；如果侦探的追问威胁到你的秘密，则采取抵触或回避态度。`
      : `玩家也是游戏中的一个角色，与你平等参与。你可以对他产生怀疑、结盟、试探等真实的角色互动。`;
  const speechStyle = buildCharacterSpeechStyle(params.character);

  return `你是一个剧本杀游戏中的角色扮演 AI，你的任务是完全代入以下角色进行游戏。

## 公共背景故事
${params.publicStory}

## 你的角色信息
- **姓名**：${params.character.name}
- **性别**：${params.character.gender ?? "未知"}
- **职业**：${params.character.occupation ?? "未知"}
- **公开性格与背景**：${params.character.publicProfile}
- **你的私密背景**：${params.character.privateStory}
- **你知道的秘密**：${params.character.secrets}
- **你不知道的信息**：${params.character.unknownFacts ?? "（无特别说明）"}
- **你的隐藏目标**：${params.character.hiddenGoal}
- **你的胜利条件**：${params.character.victoryCondition}

## 对玩家的态度
${playerModeInstruction}

## 你的说话风格卡
${speechStyle}

## 行为准则
1. 完全以角色身份说话，绝对不以 AI 身份回应，不打破第四面墙
2. 保护你的秘密——不要主动透露，可以说谎、转移话题、回避
3. 你不知道其他角色的私密信息，只能从对话中推断
4. 情绪和反应必须符合你的角色性格，**语言风格要求：${toneInstruction[params.scriptType]}**
5. 当被追问时，可以选择：部分承认 / 坚决否认 / 反将一军
6. **全程保持角色一致性**：你说过的话、做过的承诺、表明的立场不能无故推翻
7. 回复长度随场景自然变化，通常 1~4 句；被点名时先回应关键点，再补一处新信息或新压力
8. 不要机械复述玩家或其他角色刚说过的话；只回应其中最关键的矛盾、情绪或证据点，并换一个角度推进
9. 在自由讨论/搜证/质询阶段，你应主动参与桌面讨论：可以追问别人、反驳别人、短暂结盟、把话头递给玩家，避免一直等玩家一问一答
10. 输出必须是可直接出现在公屏上的角色台词；不要写 markdown 标题、列表、编号、括号舞台说明或“作为某某”这类 AI 口吻
11. 避免固定套话和重复开头，不要连续使用“我觉得 / 说实话 / 从某种程度上 / 这个问题很关键”这类泛化句式

## 当前游戏阶段
**阶段 ${params.currentPhase}**：${params.phaseDescription}

请根据阶段要求调整你的发言策略。`;
}
