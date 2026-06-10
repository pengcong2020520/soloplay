import type { GeneratedClueCard } from "@/types/game";

const KNOWN_SCRIPT_SLUGS: Record<string, string> = {
  "雾港庄园谋杀案": "misty-harbor-manor",
  "灯塔下的最后一封信": "lighthouse-last-letter",
  "年会惊魂：消失的全勤奖": "annual-award-vanished",
  "零号舱的悖论": "zero-cabin-paradox",
  "槐树村第七夜": "huai-village-seventh-night",
  "归墟列车失踪案": "abyss-train-disappearance",
};

export interface ScriptVisualStyle {
  batchId: string;
  generator: "local-svg" | "step-image-editor";
  aspectRatio: "4:3";
  styleGuide: string;
  continuityGuide: string;
  assetRoot: string;
  videoStatus: "not_configured";
}

export function buildScriptVisualStyle(
  scriptTitle: string,
  setting?: Record<string, unknown> | null
): ScriptVisualStyle {
  const slug = scriptSlug(scriptTitle);
  const location = typeof setting?.location === "string" ? setting.location : "核心案发场景";
  const era = typeof setting?.era === "string" ? setting.era : "剧本时代";
  return {
    batchId: `clue-batch-${slug}`,
    generator: "local-svg",
    aspectRatio: "4:3",
    assetRoot: `/generated/clues/${slug}`,
    videoStatus: "not_configured",
    styleGuide:
      `同一剧本的线索图必须作为同一批 storyboard 生成，保持统一镜头语言、纸张质感、色彩温度和光源方向。背景为${era}、${location}，画面像被 DM 摊在桌面上的调查证物照片。`,
    continuityGuide:
      "每张图表现不同线索，但边框、编号、桌面材质、低饱和电影感和证物标签保持一致；线索之间应像同一晚调查中连续发现的证物。",
  };
}

export function decorateGeneratedClue(
  scriptTitle: string,
  clue: GeneratedClueCard,
  index: number,
  setting?: Record<string, unknown> | null
): GeneratedClueCard {
  const style = buildScriptVisualStyle(scriptTitle, setting);
  const sequenceIndex = clue.sequenceIndex ?? index + 1;
  return {
    ...clue,
    imageUrl: clue.imageUrl ?? clueImagePath(scriptTitle, clue.title, index),
    mediaType: clue.mediaType ?? "image",
    videoUrl: clue.videoUrl ?? null,
    visualBatchId: clue.visualBatchId ?? style.batchId,
    visualPrompt:
      clue.visualPrompt ??
      buildClueVisualPrompt({
        scriptTitle,
        clueTitle: clue.title,
        clueContent: clue.content,
        clueType: clue.clueType,
        sequenceIndex,
        style,
      }),
    sequenceIndex,
    sharePolicy: clue.sharePolicy ?? "PUBLIC_AFTER_RELEASE",
  };
}

export function clueImagePath(scriptTitle: string, clueTitle: string, index: number) {
  const sequence = String(index + 1).padStart(2, "0");
  return `/generated/clues/${scriptSlug(scriptTitle)}/${sequence}-${clueSlug(clueTitle)}.svg`;
}

export function scriptSlug(scriptTitle: string) {
  const known = KNOWN_SCRIPT_SLUGS[scriptTitle];
  if (known) return known;
  const ascii = slugAscii(scriptTitle);
  return ascii || `script-${shortHash(scriptTitle)}`;
}

export function clueSlug(clueTitle: string) {
  const ascii = slugAscii(clueTitle);
  return ascii || `clue-${shortHash(clueTitle)}`;
}

function buildClueVisualPrompt(args: {
  scriptTitle: string;
  clueTitle: string;
  clueContent: string;
  clueType: string;
  sequenceIndex: number;
  style: ScriptVisualStyle;
}) {
  return [
    `批量线索图 ${args.style.batchId} / 第 ${args.sequenceIndex} 张`,
    `剧本：《${args.scriptTitle}》`,
    `线索：${args.clueTitle}（${args.clueType}）`,
    `证物内容：${args.clueContent}`,
    args.style.styleGuide,
    args.style.continuityGuide,
    "不要生成写实人物肖像；优先呈现物证、纸面、屏幕、档案、现场痕迹等可被玩家检查的线索主体。",
  ].join("\n");
}

function slugAscii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}
