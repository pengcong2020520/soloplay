"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClueDeck, type ClueDeckItem, type ClueQuestionTarget } from "@/components/game/ClueDeck";
import { RichMessageText } from "@/components/game/RichMessageText";
import { cn } from "@/lib/utils";
import type { ConsensusState, PhaseChecklistItem } from "@/types/game";
import { ArrowRight, Lightbulb, Pause, RotateCcw, SkipForward } from "lucide-react";

export interface DmHostPanelModel {
  id: string;
  title: string;
  summary: string;
  content: string;
  meta?: string;
}

export function DmHostPanel({
  panel,
  phaseName,
  phaseDescription,
  clues,
  hintsUsed,
  themeLabel,
  phaseStatus,
  focusTopic,
  consensus,
  checklist = [],
  questionTargets = [],
  onPlayClue,
  onQuestionClue,
}: {
  panel: DmHostPanelModel | null;
  phaseName: string;
  phaseDescription: string;
  clues: ClueDeckItem[];
  hintsUsed: number;
  themeLabel: string;
  phaseStatus?: string;
  focusTopic?: string;
  consensus?: ConsensusState | null;
  checklist?: PhaseChecklistItem[];
  questionTargets?: ClueQuestionTarget[];
  onPlayClue?: (clue: ClueDeckItem) => void;
  onQuestionClue?: (clue: ClueDeckItem, targetCharacterId: string, question: string) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">DM 主持台</div>
          <Badge variant="outline">{themeLabel}</Badge>
        </div>
        <div className="rounded-md border border-primary/25 bg-primary/5 p-3">
          <div className="text-sm font-semibold text-foreground">{panel?.title ?? phaseName}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {panel?.summary || phaseDescription}
          </p>
          {panel?.meta && <div className="mt-2 text-[11px] text-muted-foreground">{panel.meta}</div>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-background/35 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">阶段信息</div>
        {panel?.content ? (
          <RichMessageText text={panel.content} className="text-sm leading-relaxed text-muted-foreground" />
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">{phaseDescription}</p>
        )}
      </div>

      <div className="rounded-md border border-border bg-background/35 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">协同监控</div>
        <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span>DM 判断</span>
            <Badge variant={phaseStatus === "CAN_CLOSE" ? "success" : phaseStatus === "WAITING_PLAYER" ? "secondary" : "outline"}>
              {formatPhaseStatus(phaseStatus)}
            </Badge>
          </div>
          {focusTopic && <div>当前焦点：<span className="text-foreground">{focusTopic}</span></div>}
          {checklist.slice(0, 3).map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className={item.done ? "text-emerald-400" : "text-muted-foreground"}>{item.done ? "✓" : "○"}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <ConsensusBoard consensus={consensus} />

      <ClueDeck
        clues={clues}
        questionTargets={questionTargets}
        onPlayClue={onPlayClue}
        onQuestionClue={onQuestionClue}
      />

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        已用提示 {hintsUsed} 次。正常情况下 DM 会自动掌控节奏，左侧按钮仅作应急处理。
      </p>
    </div>
  );
}

function formatPhaseStatus(status?: string) {
  switch (status) {
    case "WAITING_PLAYER":
      return "等玩家";
    case "CAN_CLOSE":
      return "可收束";
    case "CLOSING":
      return "收束中";
    case "EVIDENCE_NEEDED":
      return "待举证";
    case "CONSENSUS_CHECK":
      return "待结论";
    case "NO_CONSENSUS":
      return "有分歧";
    case "RUNNING":
      return "监听中";
    default:
      return "监听中";
  }
}

function ConsensusBoard({ consensus }: { consensus?: ConsensusState | null }) {
  if (!consensus) return null;
  return (
    <div className="rounded-md border border-border bg-background/35 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">共识板</div>
        <Badge variant={consensus.status === "AGREED" ? "success" : consensus.status === "NO_CONSENSUS" || consensus.status === "DISPUTED" ? "secondary" : "outline"}>
          {formatConsensusStatus(consensus.status)}
        </Badge>
      </div>
      <ConsensusList title="已形成" items={consensus.agreedPoints} empty="暂未沉淀明确共识" />
      <ConsensusList title="分歧点" items={consensus.disputedPoints} empty="暂无显性分歧" />
      <ConsensusList title="待核查" items={consensus.openQuestions} empty="暂无待核查项" />
    </div>
  );
}

function ConsensusList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[11px] text-muted-foreground">{title}</div>
      <div className="space-y-1">
        {(items.length ? items : [empty]).slice(0, 3).map((item) => (
          <div key={item} className="rounded border border-border/70 bg-background/40 px-2 py-1 text-[11px] leading-snug text-muted-foreground">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatConsensusStatus(status: ConsensusState["status"]) {
  switch (status) {
    case "AGREED":
      return "已收敛";
    case "DISPUTED":
      return "有分歧";
    case "NO_CONSENSUS":
      return "无共识";
    case "EMERGING":
      return "形成中";
    default:
      return "监听中";
  }
}

export function StageControlPanel({
  busy,
  canRequestHint,
  canRequestRecap,
  canSkipPhase,
  canAdvance,
  onCommand,
  onAdvance,
  onPause,
}: {
  busy: boolean;
  canRequestHint: boolean;
  canRequestRecap: boolean;
  canSkipPhase: boolean;
  canAdvance: boolean;
  onCommand: (command: string) => void;
  onAdvance: () => void;
  onPause: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="mb-2 text-xs font-medium text-muted-foreground">节奏控制</div>
      <ControlButton disabled={busy || !canRequestHint} onClick={() => onCommand("HINT")}>
        <Lightbulb className="h-3.5 w-3.5" /> 提示
      </ControlButton>
      <ControlButton disabled={busy || !canRequestRecap} onClick={() => onCommand("RECAP")}>
        <RotateCcw className="h-3.5 w-3.5" /> 回顾
      </ControlButton>
      <ControlButton disabled={busy} onClick={() => onCommand("LOWER_DIFFICULTY")}>
        <ArrowRight className="h-3.5 w-3.5" /> 降低难度
      </ControlButton>
      <ControlButton disabled={busy || !canSkipPhase} onClick={() => onCommand("SKIP_PHASE")}>
        <SkipForward className="h-3.5 w-3.5" /> 跳过
      </ControlButton>
      <ControlButton disabled={busy} onClick={onPause}>
        <Pause className="h-3.5 w-3.5" /> 暂停
      </ControlButton>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2 w-full justify-start"
        disabled={busy || !canAdvance}
        onClick={onAdvance}
        title="应急推进：正常情况下 DM 会自动判断阶段收束"
      >
        <SkipForward className="h-3.5 w-3.5" /> 应急推进
      </Button>
    </div>
  );
}

function ControlButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("w-full justify-start")}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
