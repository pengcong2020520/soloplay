"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageBubble } from "@/components/game/MessageBubble";
import { RichMessageText, stripMarkdownSyntax } from "@/components/game/RichMessageText";
import { PhaseIndicator } from "@/components/game/PhaseIndicator";
import { PrivateChat } from "@/components/game/PrivateChat";
import { postSse } from "@/lib/client/sse-client";
import { ScriptTypeLabel, PlayerModeLabel, DifficultyLabel } from "@/lib/constants";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";
import { cn } from "@/lib/utils";
import type { GameEvent, MessageDTO } from "@/types/game";
import {
  Loader2,
  Send,
  Lightbulb,
  RotateCcw,
  SkipForward,
  ArrowRight,
  ScrollText,
  Users,
  BookOpen,
  Vote as VoteIcon,
  MessageSquare,
  Pause,
  Clock,
  RefreshCw,
  UserRound,
  Mic,
  Square,
  X,
} from "lucide-react";

/** 阶段超时后，给玩家的宽限秒数（到点不硬切，先提示，可手动停留） */
const PHASE_TIMEOUT_GRACE_SEC = 15;
const ASR_SAMPLE_RATE = 16000;

type PcmRecorder = {
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  silentGain: GainNode;
  stream: MediaStream;
  chunks: Float32Array[];
  inputSampleRate: number;
};

interface GameState {
  status: string;
  playerMode: string;
  scriptTitle: string;
  scriptType: string;
  publicStory: string;
  setting: Record<string, unknown>;
  difficulty: string;
  estimatedDuration: number;
  currentPhase: number;
  totalPhases: number;
  phase: {
    id: number;
    name: string;
    description: string;
    permissions: { publicChat: boolean; privateChat: boolean; clueInspection: boolean; voting: boolean };
    playerPaceControl: { canRequestHint: boolean; canSkipPhase: boolean; canRequestRecap: boolean; canFocusCharacter: boolean } | null;
  };
  phases: { id: number; name: string }[];
  hintsUsed: number;
  usingMockData: boolean;
  phaseStartedAt: string | null;
  phaseTimeLimitSec: number | null;
  characters: { id: string; name: string; occupation: string | null; publicProfile: string; assignedTo: string; avatarUrl?: string }[];
  playerCharacter: {
    name: string; gender: string | null; occupation: string | null;
    publicProfile: string;
    privateStory: string; secrets: string; hiddenGoal: string; victoryCondition: string;
    avatarUrl?: string;
  } | null;
  releasedClues: { id: string; title: string; content: string; clueType: string }[];
}

type Tab = "chat" | "private" | "script" | "clues" | "vote";
type FloatingNotice = {
  id: string;
  kind: "dm" | "clue";
  eyebrow: string;
  title: string;
  content: string;
  meta?: string;
};

export default function GameClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [streamingMsg, setStreamingMsg] = useState<{ id: string; senderId: string; name: string; type: string; content: string } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [voteResult, setVoteResult] = useState<any>(null);
  const [detectiveSummary, setDetectiveSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryMessageCount, setSummaryMessageCount] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [floatingNotice, setFloatingNotice] = useState<FloatingNotice | null>(null);
  // 阶段超时：到点后展示的剩余宽限秒数（null = 未到点 / 不计时）
  const [graceLeft, setGraceLeft] = useState<number | null>(null);
  // 玩家本阶段选择"再停留一会儿"，则本阶段不再自动推进
  const [autoAdvancePaused, setAutoAdvancePaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowRef = useRef<number>(0);
  const scriptTheme = useMemo(
    () => getScriptTheme(state?.scriptType, state?.scriptTitle),
    [state?.scriptType, state?.scriptTitle]
  );
  const recorderRef = useRef<PcmRecorder | null>(null);
  const shownInitialNoticeRef = useRef(false);

  const refreshState = useCallback(async () => {
    const res = await fetch(`/api/game/${sessionId}/state`);
    if (res.ok) setState(await res.json());
  }, [sessionId]);

  const refreshMessages = useCallback(async () => {
    const res = await fetch(`/api/game/${sessionId}/messages?channelKey=public`);
    if (res.ok) {
      const nextMessages = (await res.json()).messages as MessageDTO[];
      setMessages(nextMessages.map(toChatDisplayMessage));
      if (!shownInitialNoticeRef.current) {
        const latestDm = [...nextMessages].reverse().find((m) => m.senderType === "DM");
        if (latestDm) {
          shownInitialNoticeRef.current = true;
          setFloatingNotice({
            id: latestDm.id,
            kind: "dm",
            eyebrow: latestDm.channelType === "DM_HINT" ? "DM 提示" : "DM 旁白",
            title: inferDmTitle(latestDm.content),
            content: cleanDmText(latestDm.content),
            meta: `阶段 ${latestDm.phase}`,
          });
        }
      }
    }
  }, [sessionId]);

  const fetchDetectiveSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/game/${sessionId}/detective-summary`);
      const data = await res.json();
      if (res.ok) {
        setDetectiveSummary(data.summary ?? "暂无总结。");
        setSummaryMessageCount(data.messageCount ?? null);
      } else {
        setDetectiveSummary(data.error ?? "总结失败。");
      }
    } finally {
      setSummaryLoading(false);
    }
  }, [sessionId]);

  const avatarFor = useCallback(
    (senderId: string, senderType: string) => {
      if (senderType === "PLAYER") return undefined;
      return state?.characters.find((c) => c.id === senderId)?.avatarUrl;
    },
    [state?.characters]
  );

  // 初始化：确保开始（或从暂停恢复）+ 拉状态与消息
  // 用 ref 守卫，保证 React 18 严格模式下 effect 双触发时只初始化一次（避免并发 start）。
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    (async () => {
      const s = await fetch(`/api/game/${sessionId}/state`).then((r) => r.json());
      if (s.status === "SETUP") {
        await fetch(`/api/game/${sessionId}/start`, { method: "POST" });
      } else if (s.status === "PAUSED") {
        await fetch(`/api/game/${sessionId}/player-command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "RESUME" }),
        });
      }
      await refreshState();
      await refreshMessages();
    })();
  }, [sessionId, refreshState, refreshMessages]);

  // 自动滚动到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingMsg]);

  useEffect(() => {
    if (!state || state.playerMode !== "DETECTIVE" || tab !== "script" || detectiveSummary || summaryLoading) return;
    void fetchDetectiveSummary();
  }, [state, tab, detectiveSummary, summaryLoading, fetchDetectiveSummary]);

  // 阶段切换时重置本阶段的超时宽限状态
  useEffect(() => {
    setGraceLeft(null);
    setAutoAdvancePaused(false);
  }, [state?.currentPhase]);

  // 阶段超时自动推进：以服务端 phaseStartedAt 为权威基准本地计时。
  // 到点后不硬切，先进入宽限倒计时（可"再停留"），倒计时归零再自动 advancePhase。
  useEffect(() => {
    if (!state) return;
    const { phaseStartedAt, phaseTimeLimitSec } = state;
    const completed = state.status === "COMPLETED";
    const isLast = state.currentPhase >= state.totalPhases - 1;
    // 无 TIME 条件、已结束、最后阶段、玩家已选择停留 → 不计时
    if (!phaseStartedAt || !phaseTimeLimitSec || completed || isLast || autoAdvancePaused) {
      setGraceLeft(null);
      return;
    }

    const startedMs = new Date(phaseStartedAt).getTime();
    const deadlineMs = startedMs + phaseTimeLimitSec * 1000;

    const tick = () => {
      const now = Date.now();
      nowRef.current = now;
      if (now < deadlineMs) {
        setGraceLeft(null);
        return;
      }
      const graceElapsed = Math.floor((now - deadlineMs) / 1000);
      const left = PHASE_TIMEOUT_GRACE_SEC - graceElapsed;
      if (left <= 0) {
        setGraceLeft(0);
        // 到点自动推进（busy 时跳过本次，下个 tick 再判断；CAS 幂等防重复）
        if (!busy) {
          setAutoAdvancePaused(true); // 防止推进过程中重复触发
          void advancePhase();
        }
      } else {
        setGraceLeft(left);
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phaseStartedAt, state?.phaseTimeLimitSec, state?.status, state?.currentPhase, state?.totalPhases, autoAdvancePaused, busy]);

  // 统一的 SSE 事件处理
  const handleEvent = useCallback((e: GameEvent) => {
    switch (e.type) {
      case "MESSAGE_STREAM":
        setStreamingMsg((prev) => {
          if (prev && prev.id === e.messageId) {
            return { ...prev, content: prev.content + e.chunk };
          }
          return { id: e.messageId, senderId: e.sender.id, name: e.sender.name, type: e.sender.type, content: e.chunk };
        });
        break;
      case "MESSAGE_COMPLETE":
        setStreamingMsg(null);
        setMessages((prev) => {
          if (prev.some((m) => m.id === e.messageId)) return prev;
          return [
            ...prev,
            {
              id: e.messageId,
              channelType: "PUBLIC" as any,
              channelKey: e.channelKey,
              senderType: e.sender.type as any,
              senderId: e.sender.id,
              senderName: e.sender.name,
              content: formatMessageContentForChat(e.sender.type, e.fullContent),
              phase: e.phase,
              createdAt: new Date().toISOString(),
            },
          ];
        });
        if (e.sender.type === "DM") {
          setFloatingNotice({
            id: e.messageId,
            kind: "dm",
            eyebrow: "DM 旁白",
            title: inferDmTitle(e.fullContent),
            content: cleanDmText(e.fullContent),
            meta: `阶段 ${e.phase}`,
          });
        }
        break;
      case "CLUE_RELEASED":
        setState((s) =>
          s
            ? { ...s, releasedClues: [...s.releasedClues.filter((c) => c.id !== e.clueCard.id), e.clueCard as any] }
            : s
        );
        setFloatingNotice({
          id: e.clueCard.id,
          kind: "clue",
          eyebrow: "新线索卡",
          title: e.clueCard.title,
          content: e.clueCard.content,
          meta: e.clueCard.clueType,
        });
        break;
      case "DM_HINT":
        setMessages((prev) => [
          ...prev,
          {
            id: `hint-${prev.length}-${e.content.length}`,
            channelType: "DM_HINT" as any,
            channelKey: "public",
            senderType: "DM" as any,
            senderId: "dm",
            senderName: "DM",
            content: summarizeDmForChat(e.content),
            phase: state?.currentPhase ?? 0,
            createdAt: new Date().toISOString(),
          },
        ]);
        setFloatingNotice({
          id: `hint-${Date.now()}`,
          kind: "dm",
          eyebrow: "DM 提示",
          title: inferDmTitle(e.content),
          content: cleanDmText(e.content),
          meta: `阶段 ${state?.currentPhase ?? 0}`,
        });
        break;
      case "PHASE_CHANGED":
        if (e.dmAnnouncement === "__SKIP__") {
          // SKIP_PHASE：触发真正的 next-phase
          void advancePhase();
        }
        break;
      case "ERROR":
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${prev.length}`,
            channelType: "DM_HINT" as any,
            channelKey: "public",
            senderType: "DM" as any,
            senderId: "dm",
            senderName: "系统",
            content: "⚠️ " + e.message,
            phase: state?.currentPhase ?? 0,
            createdAt: new Date().toISOString(),
          },
        ]);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.currentPhase]);

  async function sendMessage() {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    setBusy(true);
    try {
      await postSse(
        `/api/game/${sessionId}/message`,
        { channelType: "PUBLIC", channelKey: "public", content },
        handleEvent
      );
    } finally {
      setBusy(false);
      setStreamingMsg(null);
    }
  }

  async function startVoiceInput() {
    if (recording || transcribing || !canChat || completed) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext: AudioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      const chunks: Float32Array[] = [];

      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      recorderRef.current = {
        audioContext,
        source,
        processor,
        silentGain,
        stream,
        chunks,
        inputSampleRate: audioContext.sampleRate,
      };
      setRecording(true);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `asr-permission-${prev.length}`,
          channelType: "DM_HINT" as any,
          channelKey: "public",
          senderType: "DM" as any,
          senderId: "dm",
          senderName: "系统",
          content: "无法开启麦克风，请检查浏览器麦克风权限。",
          phase: state?.currentPhase ?? 0,
          createdAt: new Date().toISOString(),
        },
      ]);
      console.warn("[asr] start failed", err);
    }
  }

  async function stopVoiceInput() {
    const recorder = recorderRef.current;
    if (!recorder || transcribing) return;
    recorderRef.current = null;
    setRecording(false);
    setTranscribing(true);

    try {
      recorder.processor.disconnect();
      recorder.source.disconnect();
      recorder.silentGain.disconnect();
      recorder.stream.getTracks().forEach((track) => track.stop());
      await recorder.audioContext.close();

      const samples = mergeAudioChunks(recorder.chunks);
      const downsampled = downsampleAudio(samples, recorder.inputSampleRate, ASR_SAMPLE_RATE);
      const audioBase64 = encodePcm16Base64(downsampled);
      const res = await fetch("/api/audio/asr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, sampleRate: ASR_SAMPLE_RATE, language: "zh" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "语音识别失败");
      const text = String(data.text ?? "").trim();
      if (text) {
        setInput((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `asr-error-${prev.length}`,
          channelType: "DM_HINT" as any,
          channelKey: "public",
          senderType: "DM" as any,
          senderId: "dm",
          senderName: "系统",
          content: `语音识别失败：${(err as Error).message}`,
          phase: state?.currentPhase ?? 0,
          createdAt: new Date().toISOString(),
        },
      ]);
      console.warn("[asr] stop failed", err);
    } finally {
      setTranscribing(false);
    }
  }

  async function advancePhase() {
    if (busy) return;
    setBusy(true);
    try {
      await postSse(`/api/game/${sessionId}/next-phase`, {}, handleEvent);
      await refreshState();
    } finally {
      setBusy(false);
      setStreamingMsg(null);
    }
  }

  async function sendCommand(command: string, params?: any) {
    if (busy) return;
    setBusy(true);
    try {
      await postSse(`/api/game/${sessionId}/player-command`, { command, params }, handleEvent);
      await refreshState();
    } finally {
      setBusy(false);
      setStreamingMsg(null);
    }
  }

  async function submitVote(targetId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/game/${sessionId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      const data = await res.json();
      setVoteResult(data);
      await refreshState();
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="case-page flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在进入雾港…
      </div>
    );
  }

  const canChat = state.phase.permissions.publicChat;
  const canVote = state.phase.permissions.voting;
  const pace = state.phase.playerPaceControl;
  const isLastPhase = state.currentPhase >= state.totalPhases - 1;
  const completed = state.status === "COMPLETED";
  const aiCount = state.characters.filter((c) => c.assignedTo === "AI").length;

  return (
    <div className="case-page flex h-screen flex-col bg-background" style={scriptThemeStyle(scriptTheme)}>
      {/* 顶部栏 */}
      <header className="case-panel flex flex-col gap-2 border-x-0 border-t-0 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => router.push("/")}>← 大厅</Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 text-sm font-medium">
              <span className="max-w-[8.5rem] shrink-0 truncate sm:max-w-[18rem]">{state.scriptTitle}</span>
              <Badge className={cn("shrink-0", scriptTheme.badgeClass)}>{scriptTheme.label}</Badge>
              <Badge className="shrink-0" variant="secondary">{ScriptTypeLabel[state.scriptType as keyof typeof ScriptTypeLabel] ?? state.scriptType}</Badge>
              <Badge className="hidden shrink-0 sm:inline-flex" variant="outline">{PlayerModeLabel[state.playerMode as keyof typeof PlayerModeLabel] ?? state.playerMode}</Badge>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto sm:justify-end">
          {state.usingMockData && <Badge variant="destructive">Mock 模式</Badge>}
          <Badge className="shrink-0">阶段 {state.currentPhase}/{state.totalPhases - 1} · {state.phase.name}</Badge>
          {completed && (
            <Button className="shrink-0" size="sm" onClick={() => router.push(`/replay/${sessionId}`)}>查看复盘</Button>
          )}
        </div>
      </header>

      {/* 阶段超时宽限提示条：到点不硬切，给玩家停留的逃生口 */}
      {graceLeft !== null && !completed && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <Clock className="h-4 w-4" />
            本阶段时间已到，
            <span className="font-semibold">{graceLeft} 秒</span>
            后将自动进入下一阶段。
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => { setAutoAdvancePaused(true); setGraceLeft(null); }}
            >
              再停留一会儿
            </Button>
            <Button size="sm" disabled={busy || isLastPhase} onClick={advancePhase}>
              立即进入下一阶段
            </Button>
          </div>
        </div>
      )}

      {floatingNotice && (
        <FloatingNoticeCard
          notice={floatingNotice}
          scriptTheme={scriptTheme}
          onClose={() => setFloatingNotice(null)}
          onOpenClues={() => {
            setTab("clues");
            setFloatingNotice(null);
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左侧：阶段 + 角色 */}
        <aside className="case-panel hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-y-0 border-l-0 p-3 lg:flex">
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">游戏阶段</div>
            <PhaseIndicator phases={state.phases} current={state.currentPhase} />
          </div>
          <div className="script-art min-h-28 rounded-md border border-primary/20 p-3">
            <div className="text-xs font-semibold text-primary">{scriptTheme.name}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{scriptTheme.motif}</div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> 在场角色
            </div>
            <div className="space-y-1.5">
              {state.characters.map((c) => (
                <div key={c.id} className="rounded-md border border-border bg-background/35 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <SmallAvatar src={c.avatarUrl} name={c.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{c.name}</span>
                        {c.assignedTo === "PLAYER" && <Badge variant="success">你</Badge>}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{c.occupation}</div>
                    </div>
                  </div>
                  {c.assignedTo === "AI" && pace?.canFocusCharacter && !completed && (
                    <button
                      className="mt-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => sendCommand("FOCUS_CHARACTER", { characterName: c.name })}
                    >
                      想多了解 ta →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* 中间：主区域（含 tab 切换） */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* tab 条 */}
          <div className="case-panel flex gap-1 overflow-x-auto border-x-0 border-t-0 px-3 py-1.5">
            <TabBtn active={tab === "chat"} onClick={() => setTab("chat")} icon={<Send className="h-3.5 w-3.5" />}>公共大厅</TabBtn>
            <TabBtn active={tab === "private"} onClick={() => setTab("private")} icon={<MessageSquare className="h-3.5 w-3.5" />}>私聊</TabBtn>
            <TabBtn active={tab === "script"} onClick={() => setTab("script")} icon={<BookOpen className="h-3.5 w-3.5" />}>
              {state.playerCharacter ? "我的剧本" : "剧本概况"}
            </TabBtn>
            <TabBtn active={tab === "clues"} onClick={() => setTab("clues")} icon={<ScrollText className="h-3.5 w-3.5" />}>
              线索板 {state.releasedClues.length > 0 && `(${state.releasedClues.length})`}
            </TabBtn>
            {(canVote || completed) && (
              <TabBtn active={tab === "vote"} onClick={() => setTab("vote")} icon={<VoteIcon className="h-3.5 w-3.5" />}>投票</TabBtn>
            )}
          </div>

          {tab === "chat" && (
            <>
              <div ref={scrollRef} className="script-chat-stage min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {messages.length === 0 && (
                  <div className="case-panel mx-auto mt-10 max-w-lg rounded-lg p-5 text-center text-sm text-muted-foreground">
                    <div className="mb-1 text-xs font-semibold text-primary">{state.phase.name}</div>
                    {state.phase.description}
                  </div>
                )}
                {messages.map((m) => (
                  <MessageBubble key={m.id} msg={m} avatarUrl={avatarFor(m.senderId, m.senderType)} theme={scriptTheme} />
                ))}
                {streamingMsg && (
                  <MessageBubble
                    msg={{
                      senderType: streamingMsg.type as any,
                      senderName: streamingMsg.name,
                      content: streamingMsg.content,
                      channelType: "PUBLIC" as any,
                    }}
                    avatarUrl={avatarFor(streamingMsg.senderId, streamingMsg.type)}
                    theme={scriptTheme}
                    streaming
                  />
                )}
              </div>

              {/* 输入区 */}
              <div className="case-panel border-x-0 border-b-0 p-3">
                {canChat && !completed && aiCount >= 2 && (
                  <div className="mb-2 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => sendCommand("GROUP_DISCUSS")}
                      title="让在场角色彼此你来我往地讨论一轮，你可随时插话"
                    >
                      <Users className="h-3.5 w-3.5" /> 让大家讨论一轮
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      不想一直提问？让角色们自己聊起来，你随时可以插话。
                    </span>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder={
                      completed
                        ? "游戏已结束"
                        : canChat
                        ? "在公共频道发言…（Enter 发送，Shift+Enter 换行）"
                        : `当前阶段「${state.phase.name}」尚未开放发言`
                    }
                    disabled={!canChat || busy || completed}
                    className="max-h-32 resize-none"
                    rows={2}
                  />
                  <Button
                    type="button"
                    variant={recording ? "destructive" : "outline"}
                    onClick={recording ? stopVoiceInput : startVoiceInput}
                    disabled={!canChat || busy || completed || transcribing}
                    size="icon"
                    className="h-[60px] w-12"
                    title={recording ? "停止录音并识别" : "语音输入"}
                  >
                    {transcribing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : recording ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </Button>
                  <Button onClick={sendMessage} disabled={!canChat || busy || completed || !input.trim()} size="icon" className="h-[60px] w-12">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                {(recording || transcribing) && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {recording ? "正在录音，点击停止后会用 Step ASR 转成文字。" : "正在调用 Step ASR 识别语音…"}
                  </p>
                )}
              </div>
            </>
          )}

          {tab === "private" && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <PrivateChat
                sessionId={sessionId}
                characters={state.characters}
                privateEnabled={state.phase.permissions.privateChat && !completed}
                theme={scriptTheme}
              />
            </div>
          )}

          {tab === "script" && state.playerCharacter && (
            <div className="script-chat-stage min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {/* 玩法指引：先告诉玩家这份剧本怎么读、目标是什么、怎么玩 */}
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Lightbulb className="h-4 w-4 text-primary" /> 怎么玩这局
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  <p>① 先读懂下面你的<span className="text-foreground">私密背景与秘密</span>——这是只有你知道的信息，别人会想方设法套出来。</p>
                  <p>② 你的目标写在<span className="text-primary">胜利条件</span>里，整局都要朝它努力，同时尽量守住秘密。</p>
                  <p>③ 去「<span className="text-foreground">公共大厅</span>」和大家交流试探；想单独套话就用「<span className="text-foreground">私聊</span>」；线索会出现在「<span className="text-foreground">线索板</span>」。</p>
                  <p>④ 卡住了就用右侧「节奏控制」要提示、回顾或让大家先聊起来。</p>
                </CardContent>
              </Card>

              <Card className="border-primary/25">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {state.playerCharacter.name}
                    {state.playerCharacter.gender && <Badge variant="secondary">{state.playerCharacter.gender}</Badge>}
                    <Badge variant="outline">{state.playerCharacter.occupation}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <Section title="公开身份（别人眼中的你）" hint="这部分是公开的，其他角色也知道。" body={state.playerCharacter.publicProfile} />
                  <Section title="私密背景（只有你知道）" hint="你的真实经历与动机，谨慎透露。" body={state.playerCharacter.privateStory} />
                  <Section title="你的秘密" hint="一旦暴露可能满盘皆输，能瞒则瞒。" body={state.playerCharacter.secrets} />
                  <Section title="隐藏目标" hint="贯穿全局的行动方向。" body={state.playerCharacter.hiddenGoal} />
                  <Section title="胜利条件" hint="达成它你就赢了。" body={state.playerCharacter.victoryCondition} highlight />
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardHeader className="pb-2"><CardTitle className="text-sm">公共故事（所有人都看得到）</CardTitle></CardHeader>
                <CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{state.publicStory}</p></CardContent>
              </Card>
            </div>
          )}

          {tab === "script" && !state.playerCharacter && (
            <div className="script-chat-stage min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Lightbulb className="h-4 w-4 text-primary" /> 侦探玩法指引
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  <p>你是一名<span className="text-foreground">外来侦探</span>，没有固定身份和秘密，目标是查清真相、在投票时指认真凶。</p>
                  <p>① 在「<span className="text-foreground">公共大厅</span>」向所有人提问、制造对质，观察谁的说法前后矛盾。</p>
                  <p>② 用「<span className="text-foreground">私聊</span>」单独审讯某个角色，往往能套出公开场合不肯说的话。</p>
                  <p>③ 留意「<span className="text-foreground">线索板</span>」陆续发布的物证与证词，把它们和各人的说辞对上。</p>
                  <p>④ 卡住了就用右侧「节奏控制」要提示、回顾，或让角色们先自己讨论起来。</p>
                </CardContent>
              </Card>

              <Card className="border-primary/25">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <BookOpen className="h-4 w-4 text-primary" /> 剧本概况
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary">{ScriptTypeLabel[state.scriptType as keyof typeof ScriptTypeLabel] ?? state.scriptType}</Badge>
                    <Badge variant="outline">{DifficultyLabel[state.difficulty as keyof typeof DifficultyLabel] ?? state.difficulty}</Badge>
                    <Badge variant="outline">约 {state.estimatedDuration} 分钟</Badge>
                    {formatSetting(state.setting) && <Badge variant="outline">{formatSetting(state.setting)}</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{state.publicStory}</p>
                </CardContent>
              </Card>

              <Card className="border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <UserRound className="h-4 w-4 text-primary" /> 公开人物表
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {state.characters.map((character) => (
                      <div key={character.id} className="flex gap-3 rounded-md border border-border p-3">
                        <SmallAvatar src={character.avatarUrl} name={character.name} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{character.name}</div>
                          <div className="text-xs text-muted-foreground">{character.occupation ?? "身份待查"}</div>
                          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                            {character.publicProfile}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-primary" /> AI 发言总结
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={summaryLoading}
                      onClick={fetchDetectiveSummary}
                    >
                      {summaryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      更新
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {summaryLoading && !detectiveSummary ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> 正在整理各角色公开发言…
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm leading-relaxed text-muted-foreground">
                      {detectiveSummary ?? "打开本页后会自动生成侦探笔记，也可以点击更新。"}
                    </div>
                  )}
                  {summaryMessageCount !== null && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      已基于 {summaryMessageCount} 条公开消息整理。
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "clues" && (
            <div className="script-chat-stage min-h-0 flex-1 overflow-y-auto p-4">
              {state.releasedClues.length === 0 ? (
                <p className="mt-10 text-center text-sm text-muted-foreground">尚未发布任何线索。进入搜证阶段后，DM 会陆续发布线索卡。</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {state.releasedClues.map((c) => (
                    <Card key={c.id} className="border-primary/20">
                      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">🔍 {c.title}<Badge variant="secondary">{c.clueType}</Badge></CardTitle></CardHeader>
                      <CardContent><p className="text-sm leading-relaxed text-muted-foreground">{c.content}</p></CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "vote" && (
            <div className="script-chat-stage min-h-0 flex-1 overflow-y-auto p-4">
              {voteResult ? (
                <VoteResultView result={voteResult} onReplay={() => router.push(`/replay/${sessionId}`)} />
              ) : (
                <Card>
                  <CardHeader><CardTitle>投票指凶</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground">你认为谁是凶手？提交后所有 AI 角色也会投票，DM 汇总结果并揭晓结局。</p>
                    {state.characters.filter((c) => c.assignedTo === "AI").map((c) => (
                      <Button key={c.id} variant="outline" className="w-full justify-start" disabled={busy} onClick={() => submitVote(c.id)}>
                        投给 {c.name}（{c.occupation}）
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </main>

        {/* 右侧：DM 节奏控制 */}
        {!completed && (
          <aside className="case-panel hidden w-52 shrink-0 flex-col gap-2 overflow-y-auto border-y-0 border-r-0 p-3 xl:flex">
            <div className="text-xs font-medium text-muted-foreground">节奏控制</div>
            <Button variant="outline" size="sm" className="justify-start" disabled={busy || !pace?.canRequestHint} onClick={() => sendCommand("HINT")}>
              <Lightbulb className="h-3.5 w-3.5" /> 我需要提示
            </Button>
            <Button variant="outline" size="sm" className="justify-start" disabled={busy || !pace?.canRequestRecap} onClick={() => sendCommand("RECAP")}>
              <RotateCcw className="h-3.5 w-3.5" /> 回顾剧情
            </Button>
            <Button variant="outline" size="sm" className="justify-start" disabled={busy} onClick={() => sendCommand("LOWER_DIFFICULTY")}>
              <ArrowRight className="h-3.5 w-3.5" /> 觉得太难了
            </Button>
            <Button variant="outline" size="sm" className="justify-start" disabled={busy || !pace?.canSkipPhase} onClick={() => sendCommand("SKIP_PHASE")}>
              <SkipForward className="h-3.5 w-3.5" /> 跳过本阶段
            </Button>
            <Button variant="outline" size="sm" className="justify-start" disabled={busy} onClick={async () => { await sendCommand("PAUSE"); router.push("/history"); }}>
              <Pause className="h-3.5 w-3.5" /> 暂停并退出
            </Button>

            <div className="mt-3 border-t border-border pt-3">
              <Button className="w-full" disabled={busy || isLastPhase} onClick={advancePhase}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                进入下一阶段
              </Button>
              <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
                已用提示 {state.hintsUsed} 次。DM 会按阶段推进游戏。
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Section({ title, body, hint, highlight }: { title: string; body: string; hint?: string; highlight?: boolean }) {
  return (
    <div>
      <div className={`text-xs font-medium ${highlight ? "text-primary" : "text-muted-foreground"}`}>{title}</div>
      {hint && <div className="mb-1 text-[11px] text-muted-foreground/70">{hint}</div>}
      {!hint && <div className="mb-1" />}
      <p className="whitespace-pre-wrap leading-relaxed">{body}</p>
    </div>
  );
}

function SmallAvatar({ src, name }: { src?: string; name: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary text-xs font-semibold">
      {src ? <img src={src} alt={`${name}头像`} className="h-full w-full object-cover" /> : name.slice(0, 1)}
    </div>
  );
}

function formatSetting(setting: Record<string, unknown>) {
  const parts = [setting.era, setting.location]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return parts.join(" · ");
}

function toChatDisplayMessage(message: MessageDTO): MessageDTO {
  return {
    ...message,
    content: formatMessageContentForChat(message.senderType, message.content),
  };
}

function formatMessageContentForChat(senderType: string, content: string) {
  return senderType === "DM" ? summarizeDmForChat(content) : content;
}

function summarizeDmForChat(text: string) {
  const cleaned = stripMarkdownSyntax(cleanDmText(text))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return "";

  const sentences = splitSentences(cleaned);
  const candidates: string[] = [];
  const opening = sentences.find((sentence) =>
    /^(欢迎来到|欢迎|现在进入|进入|发布线索|线索发布)/.test(sentence)
  );

  if (opening) candidates.push(opening);

  for (const sentence of sentences) {
    if (isDmKeySentence(sentence)) {
      candidates.push(compactDmKeySentence(sentence));
    }
  }

  const picked = uniqueCompactKeypoints(candidates).slice(0, 3);
  const fallback = sentences.slice(0, 2);
  return limitChatSummary((picked.length > 0 ? picked : fallback).join("\n") || cleaned);
}

function isDmKeySentence(sentence: string) {
  return (
    /^(欢迎来到|现在|接下来|下一步|请|注意|发布线索|线索发布|自由交流阶段|独立搜证阶段|公开质询阶段|最终陈词|投票指凶|复盘揭秘)/.test(sentence) ||
    /(进入.*阶段|阶段.*开始|发布线索卡|以下是.*线索|请先|请在场|请诸位|可以.*交谈|可以.*密谈|需要.*提示)/.test(sentence)
  );
}

function compactDmKeySentence(sentence: string) {
  const cleaned = sentence.trim();
  if (!/以下是.*线索/.test(cleaned)) return cleaned;
  const clueHeading = cleaned.match(/^(.*?以下是.*?线索[:：]?\s*线索卡[一二三四五六七八九十\d]+[:：]\s*[^\s，。！？.!?]{2,24})/);
  if (clueHeading?.[1]) return clueHeading[1].trim();
  const intro = cleaned.match(/^(.*?以下是.*?线索[:：]?)/);
  return intro?.[1]?.trim() ?? cleaned;
}

function splitSentences(text: string) {
  return (
    text
      .replace(/\s+/g, " ")
      .match(/[^。！？.!?]+[。！？.!?]?/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? []
  );
}

function uniqueCompactKeypoints(values: string[]) {
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, "");
    if (!normalized) continue;
    const coveredIndex = unique.findIndex((item) => {
      const existing = item.replace(/\s+/g, "");
      return existing.includes(normalized) || normalized.includes(existing);
    });
    if (coveredIndex >= 0) {
      if (normalized.length < unique[coveredIndex].replace(/\s+/g, "").length) {
        unique[coveredIndex] = value;
      }
      continue;
    }
    unique.push(value);
  }
  return unique;
}

function limitChatSummary(value: string, maxLength = 320) {
  const compact = value.replace(/\n{3,}/g, "\n\n").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).replace(/[，,；;：:、\s]*$/, "")}…`;
}

function FloatingNoticeCard({
  notice,
  scriptTheme,
  onClose,
  onOpenClues,
}: {
  notice: FloatingNotice;
  scriptTheme: ReturnType<typeof getScriptTheme>;
  onClose: () => void;
  onOpenClues: () => void;
}) {
  const isClue = notice.kind === "clue";
  return (
    <div className="pointer-events-none fixed inset-x-3 top-16 z-50 flex justify-center sm:inset-x-auto sm:right-5 sm:top-20 sm:block">
      <div className="case-float-card pointer-events-auto w-full max-w-[420px] overflow-hidden rounded-lg border border-primary/35 bg-background/95 shadow-2xl backdrop-blur transition-transform duration-200 hover:-translate-y-1">
        <div
          className="relative h-36 overflow-hidden border-b border-primary/20 bg-secondary"
          style={{ backgroundImage: noticeImageDataUrl(notice, scriptTheme) }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-black/15 via-transparent to-black/55" />
          <button
            type="button"
            onClick={onClose}
            title="关闭浮层"
            className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="absolute bottom-3 left-3 right-12">
            <div className="mb-1 inline-flex rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium text-primary backdrop-blur">
              {notice.eyebrow}
            </div>
            <div className="line-clamp-2 text-lg font-semibold leading-tight text-white drop-shadow">
              {notice.title}
            </div>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <Badge className={scriptTheme.badgeClass}>{scriptTheme.label}</Badge>
            {notice.meta && <span className="text-xs text-muted-foreground">{notice.meta}</span>}
          </div>
          <RichMessageText
            text={notice.content}
            className="max-h-44 overflow-y-auto text-sm leading-relaxed text-muted-foreground"
          />
          <div className="flex justify-end gap-2">
            {isClue && (
              <Button size="sm" variant="outline" onClick={onOpenClues}>
                <ScrollText className="h-3.5 w-3.5" />
                查看线索板
              </Button>
            )}
            <Button size="sm" onClick={onClose}>继续游戏</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function cleanDmText(text: string) {
  return text
    .replace(/^【DM】\s*/g, "")
    .replace(/^【系统】\s*/g, "")
    .trim();
}

function inferDmTitle(text: string) {
  const cleaned = stripMarkdownSyntax(cleanDmText(text));
  const explicit = cleaned.match(/^(欢迎来到《[^》]+》|现在进入「[^」]+」|发布线索卡【[^】]+】|[^。！？\n]{4,24})/);
  if (explicit?.[1]) return explicit[1].replace(/^发布线索卡/, "线索发布");
  return "DM 旁白";
}

function noticeImageDataUrl(notice: FloatingNotice, scriptTheme: ReturnType<typeof getScriptTheme>) {
  const title = notice.kind === "clue" ? "CLUE" : "DM";
  const subtitle = scriptTheme.name;
  const accent = notice.kind === "clue" ? "#d4af37" : "#7dd3fc";
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="840" height="320" viewBox="0 0 840 320">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="0.45" stop-color="#1f2937"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <radialGradient id="r" cx="28%" cy="20%" r="70%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="840" height="320" fill="url(#g)"/>
  <rect width="840" height="320" fill="url(#r)"/>
  <path d="M60 240 C170 120 260 300 390 170 S610 100 780 218" fill="none" stroke="${accent}" stroke-width="5" stroke-opacity="0.45"/>
  <circle cx="678" cy="82" r="46" fill="none" stroke="${accent}" stroke-width="4" stroke-opacity="0.75"/>
  <path d="M711 116 L774 178" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-opacity="0.8"/>
  <rect x="54" y="54" width="214" height="130" rx="10" fill="#f8fafc" opacity="0.12" stroke="#f8fafc" stroke-opacity="0.35"/>
  <line x1="82" y1="92" x2="240" y2="92" stroke="#f8fafc" stroke-width="5" stroke-opacity="0.35"/>
  <line x1="82" y1="124" x2="218" y2="124" stroke="#f8fafc" stroke-width="5" stroke-opacity="0.25"/>
  <text x="54" y="272" fill="#f8fafc" font-family="Arial, sans-serif" font-size="64" font-weight="700" opacity="0.92">${escapeSvg(title)}</text>
  <text x="214" y="272" fill="#f8fafc" font-family="Arial, sans-serif" font-size="25" opacity="0.68">${escapeSvg(subtitle)}</text>
</svg>`;
  return `url("data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}")`;
}

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mergeAudioChunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downsampleAudio(input: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (outputSampleRate === inputSampleRate) return input;
  if (outputSampleRate > inputSampleRate) {
    throw new Error("目标采样率不能高于输入采样率。");
  }
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodePcm16Base64(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function VoteResultView({ result, onReplay }: { result: any; onReplay: () => void }) {
  const outcome = result.outcome;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>投票结果</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {result.results.map((r: any) => (
            <div key={r.targetId} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>{r.targetName}</span>
                <Badge>{r.count} 票</Badge>
              </div>
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                {r.voters.map((v: any, i: number) => (
                  <li key={i}>{v.name}：{v.reason}</li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
      {outcome && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle>结局判定</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>真凶是：<span className="font-semibold text-primary">{outcome.murdererName ?? "未知"}</span></p>
            <p>众矢之的：<span className="font-medium">{outcome.mostVotedName ?? "平票"}</span></p>
            {outcome.playerWon !== null && (
              <p className="text-base font-semibold">
                {outcome.playerWon ? "🎉 你赢了！达成了你的胜利条件。" : "💀 很遗憾，本局你未达成胜利条件。"}
              </p>
            )}
            <Button className="mt-2 w-full" onClick={onReplay}>进入复盘揭秘 →</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
