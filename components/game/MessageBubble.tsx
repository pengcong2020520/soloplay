"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { RichMessageText } from "@/components/game/RichMessageText";
import { speakTtsNow, type TtsPlaybackProfile } from "@/components/game/tts-playback";
import {
  DEFAULT_SCRIPT_THEME,
  scriptThemeStyle,
  type ScriptTheme,
} from "@/lib/script-themes";
import type { ClueActionDTO, MessageDTO } from "@/types/game";
import { Loader2, ScrollText, Volume2 } from "lucide-react";

export function MessageBubble({
  msg,
  streaming = false,
  avatarUrl,
  theme = DEFAULT_SCRIPT_THEME,
  ttsProfile,
}: {
  msg: Pick<MessageDTO, "senderType" | "senderName" | "content" | "channelType" | "metadata">;
  streaming?: boolean;
  avatarUrl?: string;
  theme?: ScriptTheme;
  ttsProfile?: TtsPlaybackProfile;
}) {
  const isPlayer = msg.senderType === "PLAYER";
  const isDM = msg.senderType === "DM";
  const isPrivate = msg.channelType === "PRIVATE";
  const [speaking, setSpeaking] = useState(false);
  const themeStyle = scriptThemeStyle(theme);
  const clueAction = extractClueAction(msg.metadata);
  const clueReleaseAction = extractClueReleaseAction(msg.metadata);

  async function speak() {
    const text = msg.content.trim();
    if (!text || speaking) return;
    setSpeaking(true);
    try {
      await speakTtsNow(ttsProfile ?? {
        text,
        senderType: msg.senderType,
        senderName: msg.senderName,
      });
    } catch (err) {
      console.warn("[tts] play failed", err);
    } finally {
      setSpeaking(false);
    }
  }

  if (isDM) {
    return (
      <div className="my-3 animate-fade-in" style={themeStyle}>
        <div className="script-bubble relative mx-auto max-w-[92%] rounded-lg px-4 py-3 pr-10 text-[13px] leading-relaxed text-amber-50">
          <div className="mb-1 text-[11px] font-semibold text-primary/90">DM · {theme.label}</div>
          {clueReleaseAction && <EvidenceCard action={clueReleaseAction} compact />}
          {!clueReleaseAction && <RichMessageText text={msg.content} />}
          {streaming && <Cursor />}
          {!streaming && <SpeakButton speaking={speaking} onClick={speak} />}
        </div>
      </div>
    );
  }

  const avatar = <Avatar src={avatarUrl} name={isPlayer ? "你" : msg.senderName} isPlayer={isPlayer} />;

  return (
    <div
      className={cn("my-3 flex animate-fade-in gap-2", isPlayer ? "justify-end" : "justify-start")}
      style={themeStyle}
    >
      {!isPlayer && avatar}
      <div className={cn("max-w-[82%]", isPlayer ? "items-end" : "items-start")}>
        {!isPlayer && (
          <div className="mb-1 ml-1 flex items-center gap-1 text-xs text-muted-foreground">
            <span>{msg.senderName}</span>
            {isPrivate && <span className="rounded-full border border-primary/25 px-1.5 py-0.5 text-[10px] text-primary/90">密谈</span>}
            {!streaming && <SpeakButton compact speaking={speaking} onClick={speak} />}
          </div>
        )}
        <div
          className={cn(
            "script-bubble rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed text-foreground",
            isPlayer
              ? "rounded-br-sm border-primary/45"
            : "rounded-bl-sm"
          )}
        >
          {clueAction ? (
            <EvidenceCard action={clueAction} />
          ) : (
            <RichMessageText text={msg.content} />
          )}
          {streaming && <Cursor />}
        </div>
      </div>
      {isPlayer && avatar}
    </div>
  );
}

function EvidenceCard({ action, compact = false }: { action: ClueActionDTO; compact?: boolean }) {
  const clue = action.clue;
  return (
    <div className={cn("overflow-hidden rounded-md border border-primary/25 bg-background/45", compact ? "mt-1" : "")}>
      {clue.imageUrl && (
        <div
          className={cn("border-b border-primary/20 bg-secondary bg-cover bg-center", compact ? "h-20" : "h-28")}
          style={{ backgroundImage: `url("${clue.imageUrl}")` }}
        />
      )}
      <div className={cn("space-y-2", compact ? "p-2" : "p-3")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
              <ScrollText className="h-3.5 w-3.5" />
              {actionLabel(action)}
            </div>
            <div className="mt-1 line-clamp-2 font-semibold leading-tight">{clue.title}</div>
          </div>
          <span className="shrink-0 rounded-full border border-primary/25 px-2 py-0.5 text-[10px] text-primary/90">
            {clue.clueType}
          </span>
        </div>
        {!compact && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {clue.content}
          </p>
        )}
        {action.question && (
          <p className="rounded border border-border/70 bg-background/55 px-2 py-1.5 text-xs leading-relaxed text-foreground">
            质询：{action.question}
          </p>
        )}
      </div>
    </div>
  );
}

function actionLabel(action: ClueActionDTO) {
  if (action.actionType === "DM_RELEASE") return "DM 发放线索";
  if (action.targetCharacterName) return `${action.actorName}质询${action.targetCharacterName}`;
  return `${action.actorName}公开举证`;
}

function extractClueAction(metadata?: Record<string, any> | null): ClueActionDTO | null {
  const action = metadata?.clueAction;
  return action && typeof action === "object" ? (action as ClueActionDTO) : null;
}

function extractClueReleaseAction(metadata?: Record<string, any> | null): ClueActionDTO | null {
  const action = metadata?.clueRelease?.action;
  return action && typeof action === "object" ? (action as ClueActionDTO) : null;
}

function Cursor() {
  return <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle" />;
}

function SpeakButton({
  speaking,
  compact = false,
  onClick,
}: {
  speaking: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={speaking}
      title="朗读这条消息"
      className={cn(
        "inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60",
        compact ? "h-5 w-5" : "absolute right-2 top-2 h-6 w-6"
      )}
    >
      {speaking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
    </button>
  );
}

function Avatar({ src, name, isPlayer }: { src?: string; name: string; isPlayer: boolean }) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xs font-semibold",
        isPlayer ? "mt-0" : "mt-5",
        isPlayer ? "border-primary/45 bg-primary/15 text-primary" : "border-border bg-secondary text-foreground"
      )}
    >
      {src ? <img src={src} alt={`${name}头像`} className="h-full w-full object-cover" /> : name.slice(0, 1)}
    </div>
  );
}
