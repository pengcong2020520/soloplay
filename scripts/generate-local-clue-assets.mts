import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_DEDUCTION_SCRIPT } from "../lib/agents/mock-data";
import {
  BUILTIN_COMEDY_SCRIPT,
  BUILTIN_EMOTIONAL_SCRIPT,
  BUILTIN_HARDCORE_SCRIPT,
  BUILTIN_HORROR_SCRIPT,
  BUILTIN_RESTORATION_SCRIPT,
} from "../lib/agents/builtin-scripts";
import { clueSlug, scriptSlug } from "../lib/game/clue-visuals";
import type { GeneratedScript } from "../types/game";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts: GeneratedScript[] = [
  MOCK_DEDUCTION_SCRIPT,
  BUILTIN_EMOTIONAL_SCRIPT,
  BUILTIN_COMEDY_SCRIPT,
  BUILTIN_HARDCORE_SCRIPT,
  BUILTIN_HORROR_SCRIPT,
  BUILTIN_RESTORATION_SCRIPT,
];

for (const script of scripts) {
  const dir = path.join(root, "public", "generated", "clues", scriptSlug(script.title));
  await mkdir(dir, { recursive: true });
  const palette = paletteFor(script.title);
  for (let i = 0; i < script.clueCards.length; i++) {
    const clue = script.clueCards[i];
    const sequence = String(i + 1).padStart(2, "0");
    const filename = `${sequence}-${clueSlug(clue.title)}.svg`;
    await writeFile(
      path.join(dir, filename),
      renderClueSvg({
        scriptTitle: script.title,
        clueTitle: clue.title,
        clueType: clue.clueType,
        content: clue.content,
        sequence,
        palette,
      }),
      "utf8"
    );
  }
}

console.log(`Generated clue assets for ${scripts.length} built-in scripts.`);

function paletteFor(title: string) {
  if (title.includes("零号舱")) return ["#07111f", "#12364a", "#79e0ff", "#f6fbff"];
  if (title.includes("雾港")) return ["#17130f", "#3c2a1e", "#d4a850", "#fff4d6"];
  if (title.includes("灯塔")) return ["#0c1f2b", "#245066", "#f6c96b", "#f8f2df"];
  if (title.includes("年会")) return ["#26110f", "#63301e", "#f5b64d", "#fff7df"];
  if (title.includes("槐树")) return ["#10140f", "#27321f", "#b5d36a", "#f1f5d6"];
  if (title.includes("归墟")) return ["#0a1020", "#1c3151", "#82a7ff", "#eef3ff"];
  return ["#111827", "#334155", "#d4af37", "#f8fafc"];
}

function renderClueSvg(args: {
  scriptTitle: string;
  clueTitle: string;
  clueType: string;
  content: string;
  sequence: string;
  palette: string[];
}) {
  const [bgA, bgB, accent, paper] = args.palette;
  const typeLabel = clueTypeLabel(args.clueType);
  const shortContent = clamp(args.content.replace(/\s+/g, " "), 54);
  const titleLines = wrap(args.clueTitle, 10).slice(0, 2);
  const contentLines = wrap(shortContent, 18).slice(0, 2);
  const symbol = symbolFor(args.clueType);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <linearGradient id="table" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${bgA}"/>
      <stop offset="0.58" stop-color="${bgB}"/>
      <stop offset="1" stop-color="#05070a"/>
    </linearGradient>
    <radialGradient id="lamp" cx="34%" cy="12%" r="72%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.42"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <pattern id="grain" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M0 7h24M0 19h24" stroke="#fff" stroke-opacity="0.035" stroke-width="1"/>
      <path d="M8 0v24M20 0v24" stroke="#000" stroke-opacity="0.06" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="1200" height="900" fill="url(#table)"/>
  <rect width="1200" height="900" fill="url(#lamp)"/>
  <rect width="1200" height="900" fill="url(#grain)"/>
  <g opacity="0.2" stroke="${accent}" stroke-width="2">
    <path d="M118 738 C270 610 390 790 526 655 S783 522 1038 672" fill="none"/>
    <path d="M98 206 L1090 126M152 788 L1120 704"/>
  </g>
  <g transform="translate(155 105) rotate(-2)" filter="url(#shadow)">
    <rect x="0" y="0" width="890" height="655" rx="24" fill="${paper}" opacity="0.94"/>
    <rect x="30" y="28" width="830" height="598" rx="15" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="3"/>
    <rect x="55" y="56" width="205" height="42" rx="21" fill="${accent}" opacity="0.22"/>
    <text x="76" y="84" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${bgA}">CLUE ${args.sequence}</text>
    <text x="720" y="84" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${bgA}" text-anchor="end">${escapeSvg(typeLabel)}</text>
    <circle cx="714" cy="266" r="96" fill="none" stroke="${accent}" stroke-width="14" opacity="0.68"/>
    <path d="${symbol}" fill="none" stroke="${accent}" stroke-linecap="round" stroke-linejoin="round" stroke-width="18" opacity="0.82"/>
    <g font-family="Arial, 'PingFang SC', sans-serif" fill="${bgA}">
      ${titleLines.map((line, idx) => `<text x="74" y="${220 + idx * 70}" font-size="58" font-weight="800">${escapeSvg(line)}</text>`).join("")}
      <line x1="74" x2="604" y1="365" y2="365" stroke="${accent}" stroke-opacity="0.45" stroke-width="4"/>
      ${contentLines.map((line, idx) => `<text x="76" y="${424 + idx * 44}" font-size="32" font-weight="600" opacity="0.82">${escapeSvg(line)}</text>`).join("")}
      <text x="76" y="570" font-size="22" opacity="0.58">${escapeSvg(args.scriptTitle)}</text>
    </g>
  </g>
  <g transform="translate(850 650) rotate(5)">
    <rect x="0" y="0" width="195" height="66" rx="8" fill="#000" opacity="0.28"/>
    <text x="97" y="43" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${accent}" text-anchor="middle">EVIDENCE</text>
  </g>
</svg>`;
}

function clueTypeLabel(type: string) {
  switch (type) {
    case "PHYSICAL":
      return "物证";
    case "TESTIMONY":
      return "证词";
    case "TIMELINE":
      return "时间线";
    case "SPECIAL":
      return "特殊线索";
    default:
      return type;
  }
}

function symbolFor(type: string) {
  switch (type) {
    case "TESTIMONY":
      return "M654 246 q60 -74 142 -34 q-34 54 -4 104 q-70 -18 -110 -70";
    case "TIMELINE":
      return "M714 170 v95 l62 58 M714 170 a96 96 0 1 0 1 0";
    case "SPECIAL":
      return "M714 160 l32 76 l82 8 l-62 54 l18 80 l-70 -42 l-70 42 l18 -80 l-62 -54 l82 -8 z";
    default:
      return "M654 308 l120 -120 M662 190 h92 v92 M632 378 h166";
  }
}

function wrap(value: string, size: number) {
  const chars = Array.from(value);
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += size) {
    lines.push(chars.slice(i, i + size).join(""));
  }
  return lines.length ? lines : [value];
}

function clamp(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
