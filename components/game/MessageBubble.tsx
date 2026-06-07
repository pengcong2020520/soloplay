"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { RichMessageText } from "@/components/game/RichMessageText";
import {
  DEFAULT_SCRIPT_THEME,
  scriptThemeStyle,
  type ScriptTheme,
} from "@/lib/script-themes";
import type { MessageDTO } from "@/types/game";
import { Loader2, Volume2 } from "lucide-react";

export function MessageBubble({
  msg,
  streaming = false,
  avatarUrl,
  theme = DEFAULT_SCRIPT_THEME,
}: {
  msg: Pick<MessageDTO, "senderType" | "senderName" | "content" | "channelType">;
  streaming?: boolean;
  avatarUrl?: string;
  theme?: ScriptTheme;
}) {
  const isPlayer = msg.senderType === "PLAYER";
  const isDM = msg.senderType === "DM";
  const isPrivate = msg.channelType === "PRIVATE";
  const [speaking, setSpeaking] = useState(false);
  const themeStyle = scriptThemeStyle(theme);

  async function speak() {
    const text = msg.content.trim();
    if (!text || speaking) return;
    setSpeaking(true);
    try {
      const res = await fetch("/api/audio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "TTS 生成失败");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        URL.revokeObjectURL(url);
        setSpeaking(false);
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      timeout = setTimeout(cleanup, 30_000);
      void audio.play().catch((err) => {
        console.warn("[tts] play failed", err);
        cleanup();
      });
    } catch (err) {
      setSpeaking(false);
      console.warn("[tts] play failed", err);
    }
  }

  if (isDM) {
    return (
      <div className="my-3 animate-fade-in" style={themeStyle}>
        <div className="script-bubble relative mx-auto max-w-[92%] rounded-lg px-4 py-3 pr-10 text-sm leading-relaxed text-amber-50">
          <div className="mb-1 text-[11px] font-semibold text-primary/90">DM · {theme.label}</div>
          <RichMessageText text={msg.content} />
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
            "script-bubble rounded-2xl px-4 py-2.5 text-sm leading-relaxed text-foreground",
            isPlayer
              ? "rounded-br-sm border-primary/45"
            : "rounded-bl-sm"
          )}
        >
          <RichMessageText text={msg.content} />
          {streaming && <Cursor />}
        </div>
      </div>
      {isPlayer && avatar}
    </div>
  );
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
