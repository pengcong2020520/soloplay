"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RichMessageText } from "@/components/game/RichMessageText";
import { cn } from "@/lib/utils";
import { MessageCircleQuestion, ScrollText, X } from "lucide-react";

export interface ClueDeckItem {
  id: string;
  title: string;
  content: string;
  clueType: string;
  imageUrl?: string | null;
  mediaType?: "image" | "video" | "none" | null;
  videoUrl?: string | null;
  visualBatchId?: string | null;
  sequenceIndex?: number | null;
}

export interface ClueQuestionTarget {
  id: string;
  name: string;
  occupation?: string | null;
}

export function ClueDeck({
  clues,
  title = "线索牌堆",
  compact = false,
  questionTargets = [],
  onPlayClue,
  onQuestionClue,
}: {
  clues: ClueDeckItem[];
  title?: string;
  compact?: boolean;
  questionTargets?: ClueQuestionTarget[];
  onPlayClue?: (clue: ClueDeckItem) => void;
  onQuestionClue?: (clue: ClueDeckItem, targetCharacterId: string, question: string) => void;
}) {
  const [selected, setSelected] = useState<ClueDeckItem | null>(null);
  const [targetId, setTargetId] = useState("");
  const [question, setQuestion] = useState("");
  const visibleClues = useMemo(() => clues.slice(-8), [clues]);
  const canQuestion = selected && onQuestionClue && questionTargets.length > 0;

  return (
    <div className="rounded-md border border-border bg-background/35 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ScrollText className="h-3.5 w-3.5" />
          {title}
        </div>
        <Badge variant="secondary">{clues.length}</Badge>
      </div>

      {visibleClues.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          尚未发布线索。DM 会在阶段推进时把线索沉淀到这里。
        </p>
      ) : (
        <div className={cn("relative h-32", compact && "h-28")}>
          {visibleClues.map((clue, index) => {
            const offset = index * (compact ? 22 : 24);
            const rotate = (index % 2 === 0 ? -1 : 1) * Math.min(5, index + 1);
            return (
              <button
                key={clue.id}
                type="button"
                onClick={() => {
                  setSelected(clue);
                  setTargetId(questionTargets[0]?.id ?? "");
                  setQuestion("");
                }}
                className="group absolute bottom-0 h-28 w-20 overflow-hidden rounded-md border border-primary/25 bg-background text-left shadow-lg transition-all duration-200 hover:-translate-y-5 hover:scale-110 hover:border-primary hover:shadow-2xl"
                style={{
                  left: `${offset}px`,
                  zIndex: index + 1,
                  rotate: `${rotate}deg`,
                }}
                title={`查看线索：${clue.title}`}
              >
                <div
                  className="h-14 border-b border-primary/20 bg-secondary bg-cover bg-center"
                  style={{ backgroundImage: `url("${clue.imageUrl || clueImageDataUrl(clue, index)}")` }}
                />
                <div className="space-y-1 p-1.5">
                  <div className="line-clamp-2 text-[10px] font-semibold leading-tight text-foreground">
                    {clue.title}
                  </div>
                  <div className="text-[9px] text-primary/90">{clue.clueType}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed bottom-20 right-4 z-50 w-[min(92vw,28rem)] animate-fade-in">
          <div className="case-panel max-h-[78vh] overflow-hidden rounded-lg shadow-2xl">
            <div
              className="relative h-44 border-b border-primary/20 bg-secondary bg-cover bg-center"
              style={{ backgroundImage: `url("${selected.imageUrl || clueImageDataUrl(selected, clues.findIndex((c) => c.id === selected.id))}")` }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              <button
                type="button"
                onClick={() => setSelected(null)}
                title="关闭线索"
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="absolute bottom-4 left-4 right-12">
                <Badge className="mb-2">{selected.clueType}</Badge>
                <div className="text-xl font-semibold leading-tight text-white drop-shadow">{selected.title}</div>
              </div>
            </div>
            <div className="max-h-[46vh] space-y-4 overflow-y-auto p-4">
              <RichMessageText text={selected.content} className="text-sm leading-relaxed text-muted-foreground" />
              {canQuestion && (
                <div className="rounded-md border border-border bg-background/45 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <MessageCircleQuestion className="h-3.5 w-3.5" />
                    用这张线索质询
                  </div>
                  <div className="grid gap-2">
                    <select
                      value={targetId}
                      onChange={(event) => setTargetId(event.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                    >
                      {questionTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.name}{target.occupation ? ` · ${target.occupation}` : ""}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      rows={2}
                      className="resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs leading-relaxed text-foreground"
                      placeholder="例如：你怎么解释这张线索和你的时间线冲突？"
                    />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {canQuestion && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!targetId}
                    onClick={() => {
                      onQuestionClue?.(selected, targetId, question);
                      setSelected(null);
                    }}
                  >
                    质询角色
                  </Button>
                )}
                {onPlayClue && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onPlayClue(selected);
                      setSelected(null);
                    }}
                  >
                    打出到公屏
                  </Button>
                )}
                <Button size="sm" onClick={() => setSelected(null)}>收起</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function clueImageDataUrl(clue: ClueDeckItem, index: number) {
  const palettes = [
    ["#111827", "#334155", "#d4af37"],
    ["#0f172a", "#3f2f46", "#c084fc"],
    ["#1f2937", "#3b2f2f", "#f59e0b"],
    ["#111827", "#1e3a5f", "#7dd3fc"],
  ];
  const palette = palettes[Math.abs(hashString(clue.id + clue.title + index)) % palettes.length];
  const symbol = clue.clueType.slice(0, 1).toUpperCase();
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${palette[0]}"/>
      <stop offset="0.6" stop-color="${palette[1]}"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <radialGradient id="r" cx="35%" cy="20%" r="70%">
      <stop offset="0" stop-color="${palette[2]}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${palette[2]}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="480" height="320" fill="url(#g)"/>
  <rect width="480" height="320" fill="url(#r)"/>
  <rect x="32" y="32" width="416" height="256" rx="18" fill="#f8fafc" opacity="0.08" stroke="#f8fafc" stroke-opacity="0.28"/>
  <path d="M56 230 C126 142 178 256 254 174 S370 118 432 218" fill="none" stroke="${palette[2]}" stroke-width="4" stroke-opacity="0.55"/>
  <circle cx="372" cy="78" r="38" fill="none" stroke="${palette[2]}" stroke-width="4" stroke-opacity="0.72"/>
  <path d="M399 106 L442 148" stroke="${palette[2]}" stroke-width="8" stroke-linecap="round" stroke-opacity="0.78"/>
  <text x="56" y="112" fill="#f8fafc" font-family="Arial, sans-serif" font-size="72" font-weight="700" opacity="0.9">${escapeSvg(symbol)}</text>
  <text x="56" y="266" fill="#f8fafc" font-family="Arial, sans-serif" font-size="28" font-weight="700" opacity="0.9">${escapeSvg(clue.title.slice(0, 12))}</text>
</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
