"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClueDeckItem } from "@/components/game/ClueDeck";
import type { ScriptReaderSection } from "@/components/game/ScriptDrawer";
import { BookOpen, Eye, KeyRound, MessageCircleQuestion, ScrollText, ShieldQuestion, Target } from "lucide-react";

export function PlayerHand({
  playerCharacter,
  publicStory,
  clues,
  busy,
  canChat,
  onOpenScript,
  onPlayClue,
  onRecap,
  onFocusFirstCharacter,
}: {
  playerCharacter: {
    name: string;
    occupation: string | null;
    publicProfile: string;
    privateStory: string;
    secrets: string;
    hiddenGoal: string;
    victoryCondition: string;
  } | null;
  publicStory: string;
  clues: ClueDeckItem[];
  busy: boolean;
  canChat: boolean;
  onOpenScript: (section?: ScriptReaderSection) => void;
  onPlayClue: (clue: ClueDeckItem) => void;
  onRecap: () => void;
  onFocusFirstCharacter: () => void;
}) {
  return (
    <div className="case-panel border-x-0 border-b-0 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">玩家手牌</div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpenScript("overview")}>
            <BookOpen className="h-3.5 w-3.5" /> 剧本
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={onRecap}>
            <Eye className="h-3.5 w-3.5" /> 回顾
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy || !canChat} onClick={onFocusFirstCharacter}>
            <MessageCircleQuestion className="h-3.5 w-3.5" /> 质询
          </Button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <HandCard className="min-w-[160px]" onClick={() => onOpenScript(playerCharacter ? "profile" : "overview")}>
          <div className="flex items-center gap-1.5 text-[11px] text-primary">
            <ShieldQuestion className="h-3.5 w-3.5" />
            {playerCharacter ? "身份卡" : "侦探证"}
          </div>
          <div className="mt-1 line-clamp-1 text-sm font-semibold">
            {playerCharacter?.name ?? "外来侦探"}
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {playerCharacter?.occupation ?? "自由审讯与推理"}
          </div>
        </HandCard>

        {playerCharacter && (
          <HandCard className="min-w-[170px]" onClick={() => onOpenScript("secret")}>
            <div className="flex items-center gap-1.5 text-[11px] text-primary">
              <KeyRound className="h-3.5 w-3.5" />
              秘密
            </div>
            <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
              {playerCharacter.secrets}
            </div>
          </HandCard>
        )}

        <HandCard className="min-w-[190px]" onClick={() => onOpenScript("goal")}>
          <div className="flex items-center gap-1.5 text-[11px] text-primary">
            <Target className="h-3.5 w-3.5" />
            目标
          </div>
          <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
            {playerCharacter?.hiddenGoal || playerCharacter?.victoryCondition || "查明真相，并在投票阶段做出判断。"}
          </div>
        </HandCard>

        <HandCard className="min-w-[190px]" onClick={() => onOpenScript("story")}>
          <div className="flex items-center gap-1.5 text-[11px] text-primary">
            <BookOpen className="h-3.5 w-3.5" />
            案情
          </div>
          <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
            {publicStory}
          </div>
        </HandCard>

        {clues.length === 0 ? (
          <HandCard className="min-w-[170px]">
            <div className="flex items-center gap-1.5 text-[11px] text-primary">
              <ScrollText className="h-3.5 w-3.5" />
              线索
            </div>
            <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
              线索会在 DM 发放后沉淀到这里。
            </div>
          </HandCard>
        ) : (
          clues.slice(-5).reverse().map((clue) => (
            <HandCard key={clue.id} className="min-w-[150px]" disabled={busy || !canChat} onClick={() => onPlayClue(clue)}>
              <div className="flex items-center justify-between gap-2">
                <span className="line-clamp-1 text-[11px] text-primary">线索卡</span>
                <Badge variant="secondary" className="px-1.5 text-[10px]">{clue.clueType}</Badge>
              </div>
              <div className="mt-1 line-clamp-2 text-xs font-semibold">{clue.title}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">点击打出到公屏</div>
            </HandCard>
          ))
        )}
      </div>
    </div>
  );
}

function HandCard({
  children,
  className,
  onClick,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const interactive = Boolean(onClick) && !disabled;
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className={cn(
        "h-[76px] rounded-md border border-primary/20 bg-background/55 p-2 text-left shadow-sm transition-all",
        interactive && "hover:-translate-y-1 hover:border-primary/50 hover:bg-primary/5 hover:shadow-lg",
        disabled && "opacity-60",
        className
      )}
    >
      {children}
    </button>
  );
}
