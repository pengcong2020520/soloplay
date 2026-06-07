import type { CSSProperties } from "react";
import { ScriptType, type ScriptType as ScriptTypeValue } from "@/lib/constants";

export interface ScriptTheme {
  id: string;
  name: string;
  label: string;
  motif: string;
  image: string;
  accent: string;
  accentRgb: string;
  shadowRgb: string;
  surface: string;
  badgeClass: string;
}

export const SCRIPT_THEMES: Record<ScriptTypeValue, ScriptTheme> = {
  [ScriptType.DEDUCTION]: {
    id: "deduction-misty-manor",
    name: "雾港庄园",
    label: "雨夜案卷",
    motif: "雨窗、旧档案、庄园灯影",
    image: "/script-themes/deduction-misty-manor.svg",
    accent: "#d9a35b",
    accentRgb: "217, 163, 91",
    shadowRgb: "68, 45, 28",
    surface: "rgba(24, 19, 13, 0.84)",
    badgeClass: "border-amber-300/35 bg-amber-400/10 text-amber-200",
  },
  [ScriptType.EMOTIONAL]: {
    id: "emotional-lighthouse-letter",
    name: "灯塔来信",
    label: "潮汐信纸",
    motif: "灯塔、海潮、未寄出的信",
    image: "/script-themes/emotional-lighthouse-letter.svg",
    accent: "#8dbbd0",
    accentRgb: "141, 187, 208",
    shadowRgb: "31, 67, 86",
    surface: "rgba(12, 25, 32, 0.84)",
    badgeClass: "border-sky-200/35 bg-sky-300/10 text-sky-100",
  },
  [ScriptType.COMEDY]: {
    id: "comedy-award-stage",
    name: "年会舞台",
    label: "奖杯聚光",
    motif: "舞台、奖杯、彩带证据",
    image: "/script-themes/comedy-award-stage.svg",
    accent: "#f7c85f",
    accentRgb: "247, 200, 95",
    shadowRgb: "111, 50, 34",
    surface: "rgba(35, 20, 16, 0.82)",
    badgeClass: "border-yellow-200/35 bg-yellow-300/10 text-yellow-100",
  },
  [ScriptType.HARDCORE]: {
    id: "hardcore-zero-cabin",
    name: "零号舱",
    label: "冷光悖论",
    motif: "实验舱、数据玻璃、量子时钟",
    image: "/script-themes/hardcore-zero-cabin.svg",
    accent: "#91d8ff",
    accentRgb: "145, 216, 255",
    shadowRgb: "20, 68, 94",
    surface: "rgba(8, 22, 31, 0.86)",
    badgeClass: "border-cyan-200/35 bg-cyan-300/10 text-cyan-100",
  },
  [ScriptType.HORROR]: {
    id: "horror-huai-village",
    name: "槐树村",
    label: "祠堂红绳",
    motif: "古槐、祠堂、红绳夜色",
    image: "/script-themes/horror-huai-village.svg",
    accent: "#c04a55",
    accentRgb: "192, 74, 85",
    shadowRgb: "63, 18, 23",
    surface: "rgba(19, 13, 12, 0.88)",
    badgeClass: "border-red-300/35 bg-red-400/10 text-red-100",
  },
  [ScriptType.RESTORATION]: {
    id: "restoration-abyss-train",
    name: "归墟列车",
    label: "时间胶片",
    motif: "列车、旧车票、断裂时间线",
    image: "/script-themes/restoration-abyss-train.svg",
    accent: "#a997e8",
    accentRgb: "169, 151, 232",
    shadowRgb: "54, 45, 99",
    surface: "rgba(20, 17, 35, 0.86)",
    badgeClass: "border-violet-200/35 bg-violet-300/10 text-violet-100",
  },
};

export const DEFAULT_SCRIPT_THEME: ScriptTheme = {
  id: "default-case-file",
  name: "未命名案卷",
  label: "密封案卷",
  motif: "案卷、红线、暗灯",
  image: "/script-themes/default-case-file.svg",
  accent: "#d9a35b",
  accentRgb: "217, 163, 91",
  shadowRgb: "68, 45, 28",
  surface: "rgba(24, 19, 13, 0.84)",
  badgeClass: "border-amber-300/35 bg-amber-400/10 text-amber-200",
};

export function getScriptTheme(scriptType?: string | null, title?: string | null): ScriptTheme {
  const base = scriptType && scriptType in SCRIPT_THEMES
    ? SCRIPT_THEMES[scriptType as ScriptTypeValue]
    : DEFAULT_SCRIPT_THEME;

  if (!title) return base;

  if (title.includes("灯塔")) return SCRIPT_THEMES.EMOTIONAL;
  if (title.includes("年会") || title.includes("全勤")) return SCRIPT_THEMES.COMEDY;
  if (title.includes("零号舱")) return SCRIPT_THEMES.HARDCORE;
  if (title.includes("槐树村")) return SCRIPT_THEMES.HORROR;
  if (title.includes("归墟") || title.includes("列车")) return SCRIPT_THEMES.RESTORATION;
  if (title.includes("雾港") || title.includes("庄园")) return SCRIPT_THEMES.DEDUCTION;

  return base;
}

export function scriptThemeStyle(theme: ScriptTheme): CSSProperties {
  return {
    "--theme-image": `url("${theme.image}")`,
    "--theme-accent": theme.accent,
    "--theme-rgb": theme.accentRgb,
    "--theme-shadow-rgb": theme.shadowRgb,
    "--theme-surface": theme.surface,
  } as CSSProperties;
}
