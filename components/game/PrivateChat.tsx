"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/game/MessageBubble";
import { postSse } from "@/lib/client/sse-client";
import {
  DEFAULT_SCRIPT_THEME,
  scriptThemeStyle,
  type ScriptTheme,
} from "@/lib/script-themes";
import { getPrivateChannelKey } from "@/lib/utils";
import type { GameEvent, MessageDTO } from "@/types/game";
import { Loader2, Send, ChevronLeft } from "lucide-react";

interface PrivateChannelInfo {
  characterId: string;
  characterName: string;
  occupation: string | null;
  channelKey: string;
  messageCount: number;
}

export function PrivateChat({
  sessionId,
  characters,
  privateEnabled,
  theme = DEFAULT_SCRIPT_THEME,
}: {
  sessionId: string;
  characters: { id: string; name: string; occupation: string | null; assignedTo: string; avatarUrl?: string }[];
  privateEnabled: boolean;
  theme?: ScriptTheme;
}) {
  const [channels, setChannels] = useState<PrivateChannelInfo[]>([]);
  const [active, setActive] = useState<PrivateChannelInfo | null>(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [streaming, setStreaming] = useState<{ name: string; content: string } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/game/${sessionId}/private-channels`)
      .then((r) => r.json())
      .then((d) => setChannels(d.channels ?? []));
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    fetch(`/api/game/${sessionId}/messages?channelKey=${encodeURIComponent(active.channelKey)}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages ?? []));
  }, [active, sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  function onEvent(e: GameEvent) {
    if (e.type === "MESSAGE_STREAM") {
      setStreaming((p) => (p ? { ...p, content: p.content + e.chunk } : { name: e.sender.name, content: e.chunk }));
    } else if (e.type === "MESSAGE_COMPLETE") {
      setStreaming(null);
      setMessages((prev) =>
        prev.some((m) => m.id === e.messageId)
          ? prev
          : [...prev, {
              id: e.messageId, channelType: "PRIVATE" as any, channelKey: e.channelKey,
              senderType: e.sender.type as any, senderId: e.sender.id, senderName: e.sender.name,
              content: e.fullContent, phase: e.phase, createdAt: new Date().toISOString(),
            }]
      );
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || !active || busy) return;
    setInput("");
    setBusy(true);
    const channelKey = getPrivateChannelKey("player", active.characterId);
    try {
      await postSse(
        `/api/game/${sessionId}/message`,
        { channelType: "PRIVATE", channelKey, content },
        onEvent
      );
    } finally {
      setBusy(false);
      setStreaming(null);
    }
  }

  if (!privateEnabled) {
    return (
      <div className="script-chat-stage flex h-full items-center justify-center p-10 text-center text-sm text-muted-foreground" style={scriptThemeStyle(theme)}>
        <div className="case-panel max-w-md rounded-lg p-5">
          当前阶段尚未开放私聊。进入「自由交流」等阶段后即可与角色单独密谈。
        </div>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="script-chat-stage h-full overflow-y-auto p-4" style={scriptThemeStyle(theme)}>
        <div className="mb-3 text-sm text-muted-foreground">选择一位角色单独密谈（仅你与对方可见，复盘公开）：</div>
        <div className="space-y-2">
          {characters.filter((c) => c.assignedTo === "AI").map((c) => {
            const ch = channels.find((x) => x.characterId === c.id);
            return (
              <button
                key={c.id}
                onClick={() =>
                  setActive(ch ?? { characterId: c.id, characterName: c.name, occupation: c.occupation, channelKey: getPrivateChannelKey("player", c.id), messageCount: 0 })
                }
                className="case-panel flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm transition-all hover:-translate-y-0.5 hover:border-primary/50"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <SmallAvatar src={c.avatarUrl} name={c.name} />
                  <div className="min-w-0">
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{c.occupation}</span>
                  </div>
                </div>
                {ch && ch.messageCount > 0 && <span className="text-xs text-primary">{ch.messageCount} 条</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={scriptThemeStyle(theme)}>
      <div className="case-panel flex items-center gap-2 border-x-0 border-t-0 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => setActive(null)}>
          <ChevronLeft className="h-4 w-4" /> 返回
        </Button>
        <span className="text-sm font-medium">与 {active.characterName} 私聊</span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">{theme.motif}</span>
      </div>
      <div ref={scrollRef} className="script-chat-stage min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="mt-8 text-center text-sm text-muted-foreground">私下问问 {active.characterName} 吧。</p>}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            avatarUrl={characters.find((c) => c.id === m.senderId)?.avatarUrl}
            theme={theme}
          />
        ))}
        {streaming && (
          <MessageBubble
            msg={{ senderType: "AI_CHARACTER" as any, senderName: streaming.name, content: streaming.content, channelType: "PRIVATE" as any }}
            avatarUrl={characters.find((c) => c.name === streaming.name)?.avatarUrl}
            theme={theme}
            streaming
          />
        )}
      </div>
      <div className="case-panel border-x-0 border-b-0 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`私下对 ${active.characterName} 说…`}
            disabled={busy}
            className="max-h-28 resize-none"
            rows={2}
          />
          <Button onClick={send} disabled={busy || !input.trim()} size="icon" className="h-[60px] w-12">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SmallAvatar({ src, name }: { src?: string; name: string }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary text-xs font-semibold text-foreground">
      {src ? <img src={src} alt={`${name}头像`} className="h-full w-full object-cover" /> : name.slice(0, 1)}
    </div>
  );
}
