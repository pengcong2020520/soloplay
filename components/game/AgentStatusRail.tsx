"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentRuntimeStatus, PhaseChecklistItem } from "@/types/game";
import { CheckCircle2, Circle, Ear, HelpCircle, Loader2, Radio, Sparkles, Volume2 } from "lucide-react";

export interface AgentStatusItem {
  id: string;
  name: string;
  occupation?: string | null;
  avatarUrl?: string;
  assignedTo?: string;
  status?: AgentRuntimeStatus;
  reason?: string;
}

export function AgentStatusRail({
  dmStatus,
  dmReason,
  agents,
  checklist,
  focusTopic,
}: {
  dmStatus: AgentRuntimeStatus;
  dmReason?: string;
  agents: AgentStatusItem[];
  checklist: PhaseChecklistItem[];
  focusTopic?: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">协同状态</div>
        <StatusRow
          name="DM"
          occupation={focusTopic ? `焦点：${focusTopic}` : "主持与监听"}
          status={dmStatus}
          reason={dmReason}
          accent
        />
      </div>
      <div className="space-y-1.5">
        {agents.map((agent) => (
          <StatusRow
            key={agent.id}
            name={agent.name}
            occupation={agent.assignedTo === "PLAYER" ? "你" : agent.occupation}
            status={agent.assignedTo === "PLAYER" ? "WAITING_PLAYER" : agent.status ?? "IDLE"}
            reason={agent.reason}
            avatarUrl={agent.avatarUrl}
            isPlayer={agent.assignedTo === "PLAYER"}
          />
        ))}
      </div>
      {checklist.length > 0 && (
        <div className="rounded-md border border-border bg-background/35 p-2.5">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">阶段完成度</div>
          <div className="space-y-1">
            {checklist.slice(0, 4).map((item) => (
              <div key={item.label} className="flex items-start gap-1.5 text-[11px] leading-snug">
                {item.done ? (
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/70" />
                )}
                <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusRow({
  name,
  occupation,
  status = "IDLE",
  reason,
  avatarUrl,
  accent,
  isPlayer,
}: {
  name: string;
  occupation?: string | null;
  status?: AgentRuntimeStatus;
  reason?: string;
  avatarUrl?: string;
  accent?: boolean;
  isPlayer?: boolean;
}) {
  const meta = statusMeta(status, isPlayer);
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5 text-xs transition-colors",
        accent ? "border-primary/30 bg-primary/5" : "border-border bg-background/35",
        status === "SPEAKING" && "border-primary/50 bg-primary/10",
        status === "THINKING" && "border-amber-500/35 bg-amber-500/10"
      )}
    >
      <div className="flex items-center gap-2">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary text-[11px] font-semibold">
          {avatarUrl ? <img src={avatarUrl} alt={`${name}头像`} className="h-full w-full object-cover" /> : name.slice(0, 1)}
          {(status === "SPEAKING" || status === "LISTENING") && (
            <span className="absolute inset-0 rounded-full border border-primary/60 animate-pulse" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate font-medium">{name}</span>
            <Badge variant={meta.variant} className="h-5 shrink-0 gap-1 px-1.5 text-[10px]">
              {meta.icon}
              {meta.label}
            </Badge>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">{reason || occupation || meta.hint}</div>
        </div>
      </div>
    </div>
  );
}

function statusMeta(status: AgentRuntimeStatus, isPlayer?: boolean) {
  if (isPlayer) {
    return {
      label: "你",
      hint: "等待你的行动",
      variant: "success" as const,
      icon: <HelpCircle className="h-3 w-3" />,
    };
  }
  switch (status) {
    case "LISTENING":
      return { label: "监听", hint: "正在观察全场", variant: "outline" as const, icon: <Ear className="h-3 w-3" /> };
    case "PLANNED":
      return { label: "排队", hint: "已被选中回应", variant: "secondary" as const, icon: <Radio className="h-3 w-3" /> };
    case "THINKING":
      return { label: "准备", hint: "正在组织语言", variant: "secondary" as const, icon: <Loader2 className="h-3 w-3 animate-spin" /> };
    case "SPEAKING":
      return { label: "发言", hint: "正在说话", variant: "default" as const, icon: <Volume2 className="h-3 w-3" /> };
    case "RESPONDED":
      return { label: "已回应", hint: "本轮已发言", variant: "outline" as const, icon: <CheckCircle2 className="h-3 w-3" /> };
    case "WAITING_PLAYER":
      return { label: "等你", hint: "话头递给玩家", variant: "success" as const, icon: <HelpCircle className="h-3 w-3" /> };
    default:
      return { label: "等待", hint: "当前无动作", variant: "outline" as const, icon: <Sparkles className="h-3 w-3" /> };
  }
}
