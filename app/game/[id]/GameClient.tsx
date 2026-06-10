"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageBubble } from "@/components/game/MessageBubble";
import { AgentStatusRail, type AgentStatusItem } from "@/components/game/AgentStatusRail";
import type { ClueDeckItem } from "@/components/game/ClueDeck";
import { RichMessageText, stripMarkdownSyntax } from "@/components/game/RichMessageText";
import { PhaseIndicator } from "@/components/game/PhaseIndicator";
import { PlayerHand } from "@/components/game/PlayerHand";
import { PrivateChat } from "@/components/game/PrivateChat";
import { ScriptDrawer, type ScriptReaderSection } from "@/components/game/ScriptDrawer";
import {
  DmHostPanel,
  StageControlPanel,
  type DmHostPanelModel,
} from "@/components/game/DmHostPanel";
import {
  queueTtsPlayback,
  setTtsPlaybackEnabled,
  subscribeTtsPlaybackState,
  unlockTtsPlayback,
  type TtsPlaybackProfile,
} from "@/components/game/tts-playback";
import { postSse } from "@/lib/client/sse-client";
import { ScriptTypeLabel, PlayerModeLabel, DifficultyLabel } from "@/lib/constants";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";
import { cn } from "@/lib/utils";
import type {
  AgentRuntimeStatus,
  ConsensusState,
  GameEvent,
  MessageDTO,
  PhaseAssessmentStatus,
  PhaseChecklistItem,
} from "@/types/game";
import {
  Loader2,
  Send,
  Lightbulb,
  ScrollText,
  Users,
  BookOpen,
  Vote as VoteIcon,
  MessageSquare,
  Play,
  Clock,
  RefreshCw,
  UserRound,
  Mic,
  Square,
  X,
  Volume2,
  VolumeX,
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
  characters: { id: string; name: string; gender?: string | null; occupation: string | null; publicProfile: string; assignedTo: string; avatarUrl?: string }[];
  playerCharacter: {
    name: string; gender: string | null; occupation: string | null;
    publicProfile: string;
    privateStory: string; secrets: string; hiddenGoal: string; victoryCondition: string;
    avatarUrl?: string;
  } | null;
  releasedClues: ClueDeckItem[];
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

type AgentStatusState = {
  status: AgentRuntimeStatus;
  reason?: string;
};

type PhaseAssessmentState = {
  status: PhaseAssessmentStatus;
  summary: string;
  checklist: PhaseChecklistItem[];
  focusTopic?: string;
  consensus?: ConsensusState;
};

type PendingPlayerMessage = {
  id: string;
  content: string;
  createdAt: number;
  source: "text" | "asr";
};

export default function GameClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<GameState | null>(null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [streamingMsg, setStreamingMsg] = useState<{ id: string; senderId: string; name: string; type: string; content: string } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [playerSending, setPlayerSending] = useState(false);
  const [pendingPlayerMessage, setPendingPlayerMessage] = useState<PendingPlayerMessage | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [voteResult, setVoteResult] = useState<any>(null);
  const [detectiveSummary, setDetectiveSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryMessageCount, setSummaryMessageCount] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [floatingNotice, setFloatingNotice] = useState<FloatingNotice | null>(null);
  const [dmPanel, setDmPanel] = useState<DmHostPanelModel | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [speechActive, setSpeechActive] = useState(false);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatusState>>({
    dm: { status: "LISTENING", reason: "持续监听全场" },
  });
  const [phaseAssessment, setPhaseAssessment] = useState<PhaseAssessmentState | null>(null);
  const [autoDiscussionEnabled, setAutoDiscussionEnabled] = useState(true);
  const [scriptDrawerOpen, setScriptDrawerOpen] = useState(false);
  const [scriptReaderSection, setScriptReaderSection] = useState<ScriptReaderSection>("overview");
  const [pendingAutoAdvance, setPendingAutoAdvance] = useState(false);
  // 阶段超时：到点后展示的剩余宽限秒数（null = 未到点 / 不计时）
  const [graceLeft, setGraceLeft] = useState<number | null>(null);
  // 玩家本阶段选择"再停留一会儿"，则本阶段不再自动推进
  const [autoAdvancePaused, setAutoAdvancePaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowRef = useRef<number>(0);
  const autoDiscussionTimerRef = useRef<number | null>(null);
  const lastAutoDiscussionAtRef = useRef<number>(0);
  const scriptTheme = useMemo(
    () => getScriptTheme(state?.scriptType, state?.scriptTitle),
    [state?.scriptType, state?.scriptTitle]
  );
  const recorderRef = useRef<PcmRecorder | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("soloplay.tts.enabled");
    const enabled = stored !== "false";
    setTtsEnabled(enabled);
    setTtsPlaybackEnabled(enabled);
  }, []);

  useEffect(() => {
    return subscribeTtsPlaybackState((playbackState) => {
      setSpeechActive(playbackState.active);
    });
  }, []);

  const refreshState = useCallback(async () => {
    const res = await fetch(`/api/game/${sessionId}/state`);
    if (res.ok) setState(await res.json());
  }, [sessionId]);

  const refreshMessages = useCallback(async () => {
    const res = await fetch(`/api/game/${sessionId}/messages?channelKey=public`);
    if (res.ok) {
      const nextMessages = (await res.json()).messages as MessageDTO[];
      const latestDm = [...nextMessages].reverse().find((m) => m.senderType === "DM");
      if (latestDm) {
        setDmPanel(buildDmPanel(latestDm.id, latestDm.content, latestDm.phase));
      }
      setMessages(nextMessages.map(toChatDisplayMessage));
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

  const appendDisplayMessage = useCallback((message: MessageDTO) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
  }, []);

  const setRuntimeStatus = useCallback(
    (agentId: string, status: AgentRuntimeStatus, reason?: string) => {
      setAgentStatuses((prev) => ({
        ...prev,
        [agentId]: { status, reason },
      }));
    },
    []
  );

  const enqueueDisplayMessage = useCallback(
    (message: MessageDTO, speechText?: string) => {
      if (!state || message.senderType === "PLAYER") {
        appendDisplayMessage(message);
        return;
      }

      if (!ttsEnabled) {
        appendDisplayMessage(message);
        setRuntimeStatus(
          message.senderType === "DM" ? "dm" : message.senderId,
          message.senderType === "DM" ? "LISTENING" : "RESPONDED",
          message.senderType === "DM" ? "继续监听公共讨论" : "本轮已回应"
        );
        return;
      }

      void queueTtsPlayback(
        buildTtsProfile(message, state, speechText),
        {
          onStart: () => {
            appendDisplayMessage(message);
            setRuntimeStatus(
              message.senderType === "DM" ? "dm" : message.senderId,
              "SPEAKING",
              "正在发言"
            );
          },
          onFinish: () => {
            setRuntimeStatus(
              message.senderType === "DM" ? "dm" : message.senderId,
              message.senderType === "DM" ? "LISTENING" : "RESPONDED",
              message.senderType === "DM" ? "继续监听公共讨论" : "本轮已回应"
            );
          },
          onError: () => appendDisplayMessage(message),
          onSkip: () => appendDisplayMessage(message),
        }
      );
    },
    [appendDisplayMessage, setRuntimeStatus, state, ttsEnabled]
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
    setPendingAutoAdvance(false);
    setPhaseAssessment(null);
    setAgentStatuses((prev) => {
      const next: Record<string, AgentStatusState> = {
        dm: { status: "LISTENING", reason: "监听新阶段" },
      };
      for (const [agentId, value] of Object.entries(prev)) {
        if (agentId !== "dm") next[agentId] = { ...value, status: "IDLE", reason: undefined };
      }
      return next;
    });
  }, [state?.currentPhase]);

  useEffect(() => {
    if (!pendingAutoAdvance || busy || speechActive) return;
    setPendingAutoAdvance(false);
    void advancePhase(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoAdvance, busy, speechActive]);

  useEffect(() => {
    if (
      !pendingPlayerMessage ||
      playerSending ||
      busy ||
      speechActive ||
      !state?.phase.permissions.publicChat ||
      state.status === "COMPLETED"
    ) {
      return;
    }

    const nextMessage = pendingPlayerMessage;
    setPendingPlayerMessage(null);
    void submitPlayerMessage(nextMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingPlayerMessage,
    playerSending,
    busy,
    speechActive,
    state?.phase.permissions.publicChat,
    state?.status,
  ]);

  useEffect(() => {
    if (autoDiscussionTimerRef.current !== null) {
      window.clearTimeout(autoDiscussionTimerRef.current);
      autoDiscussionTimerRef.current = null;
    }

    if (
      !state ||
      !autoDiscussionEnabled ||
      busy ||
      speechActive ||
      input.trim() ||
      pendingPlayerMessage ||
      recording ||
      transcribing
    ) {
      return;
    }
    if (state.status === "COMPLETED") return;
    if (
      phaseAssessment?.status === "CAN_CLOSE" ||
      phaseAssessment?.status === "CLOSING" ||
      phaseAssessment?.status === "EVIDENCE_NEEDED" ||
      phaseAssessment?.status === "CONSENSUS_CHECK"
    ) {
      return;
    }

    const aiCount = state.characters.filter((c) => c.assignedTo === "AI").length;
    const sequential = /自我介绍|最终陈词|陈词/.test(state.phase.name);
    const canAutoDiscuss = state.phase.permissions.publicChat && aiCount >= 2 && !sequential;
    if (!canAutoDiscuss) return;

    const elapsed = Date.now() - lastAutoDiscussionAtRef.current;
    const delay = Math.max(3500, 11000 - elapsed);
    autoDiscussionTimerRef.current = window.setTimeout(() => {
      autoDiscussionTimerRef.current = null;
      lastAutoDiscussionAtRef.current = Date.now();
      void sendCommand("GROUP_DISCUSS", { auto: true });
    }, delay);

    return () => {
      if (autoDiscussionTimerRef.current !== null) {
        window.clearTimeout(autoDiscussionTimerRef.current);
        autoDiscussionTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state?.currentPhase,
    state?.phase.name,
    state?.phase.permissions.publicChat,
    state?.status,
    state?.characters,
    autoDiscussionEnabled,
    busy,
    speechActive,
    input,
    pendingPlayerMessage,
    recording,
    transcribing,
    phaseAssessment?.status,
  ]);

  // 阶段超时自动推进：以服务端 phaseStartedAt 为权威基准本地计时。
  // 到点后不硬切，先进入宽限倒计时（可"再停留"），倒计时归零再自动 advancePhase。
  useEffect(() => {
    if (!state) return;
    const { phaseStartedAt, phaseTimeLimitSec } = state;
    const completed = state.status === "COMPLETED";
    const isLast = state.currentPhase >= state.totalPhases - 1;
    const waitingForSequentialPlayer =
      Boolean(state.playerCharacter) && /自我介绍|最终陈词|陈词/.test(state.phase.name);
    // 无 TIME 条件、已结束、最后阶段、玩家已选择停留 → 不计时
    if (!phaseStartedAt || !phaseTimeLimitSec || completed || isLast || autoAdvancePaused || waitingForSequentialPlayer) {
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
  }, [state?.phaseStartedAt, state?.phaseTimeLimitSec, state?.status, state?.currentPhase, state?.totalPhases, state?.phase.name, state?.playerCharacter, autoAdvancePaused, busy]);

  // 统一的 SSE 事件处理
  const handleEvent = useCallback((e: GameEvent) => {
    switch (e.type) {
      case "AGENT_STATUS_CHANGED":
        setRuntimeStatus(e.agentId, e.status, e.reason);
        break;
      case "DM_PHASE_ASSESSMENT":
        setPhaseAssessment({
          status: e.status,
          summary: e.summary,
          checklist: e.checklist,
          focusTopic: e.focusTopic,
          consensus: e.consensus,
        });
        setRuntimeStatus(
          "dm",
          e.status === "WAITING_PLAYER"
            ? "WAITING_PLAYER"
            : e.status === "CLOSING"
            ? "THINKING"
            : "LISTENING",
          e.summary
        );
        break;
      case "DISCUSSION_MODE_CHANGED":
        setAutoDiscussionEnabled(e.enabled);
        break;
      case "MESSAGE_STREAM":
        if (e.sender.type === "PLAYER") {
          setStreamingMsg((prev) => {
            if (prev && prev.id === e.messageId) {
              return { ...prev, content: prev.content + e.chunk };
            }
            return { id: e.messageId, senderId: e.sender.id, name: e.sender.name, type: e.sender.type, content: e.chunk };
          });
        }
        break;
      case "MESSAGE_COMPLETE":
        setStreamingMsg(null);
        const completedMessage = {
          id: e.messageId,
          channelType: "PUBLIC" as any,
          channelKey: e.channelKey,
          senderType: e.sender.type as any,
          senderId: e.sender.id,
          senderName: e.sender.name,
          content: formatMessageContentForChat(e.sender.type, e.fullContent),
          phase: e.phase,
          createdAt: new Date().toISOString(),
          metadata: e.metadata ?? null,
        } satisfies MessageDTO;
        if (e.sender.type === "DM") {
          setDmPanel(buildDmPanel(e.messageId, e.fullContent, e.phase));
        }
        enqueueDisplayMessage(
          completedMessage,
          e.sender.type === "DM" ? stripMarkdownSyntax(cleanDmText(e.fullContent)) : e.fullContent
        );
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
        if (state && ttsEnabled) {
          void queueTtsPlayback(
            buildTtsProfile(
              {
                senderType: "DM" as any,
                senderId: "dm",
                senderName: "DM",
                content: `发布新线索：${e.clueCard.title}。${e.clueCard.content}`,
              },
              state
            )
          );
        }
        break;
      case "CLUE_PLAYED":
        setState((s) =>
          s
            ? {
                ...s,
                releasedClues: [
                  ...s.releasedClues.filter((c) => c.id !== e.clueCard.id),
                  e.clueCard,
                ],
              }
            : s
        );
        break;
      case "DM_HINT":
        const hintMessage = {
          id: `hint-${Date.now()}-${e.content.length}`,
          channelType: "DM_HINT" as any,
          channelKey: "public",
          senderType: "DM" as any,
          senderId: "dm",
          senderName: "DM",
          content: summarizeDmForChat(e.content),
          phase: state?.currentPhase ?? 0,
          createdAt: new Date().toISOString(),
        } satisfies MessageDTO;
        setDmPanel(buildDmPanel(hintMessage.id, e.content, state?.currentPhase ?? 0));
        enqueueDisplayMessage(hintMessage, stripMarkdownSyntax(cleanDmText(e.content)));
        break;
      case "PHASE_CHANGED":
        if (e.dmAnnouncement === "__SKIP__" || e.dmAnnouncement === "__AUTO_NEXT__") {
          setPendingAutoAdvance(true);
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
  }, [enqueueDisplayMessage, setRuntimeStatus, state, ttsEnabled]);

  function createPendingPlayerMessage(content: string, source: PendingPlayerMessage["source"]): PendingPlayerMessage {
    return {
      id: `player-pending-${Date.now()}`,
      content: content.trim(),
      createdAt: Date.now(),
      source,
    };
  }

  function queueOrSubmitPlayerMessage(content: string, source: PendingPlayerMessage["source"] = "text") {
    const trimmed = content.trim();
    if (!trimmed || !canChat || completed || playerSending || pendingPlayerMessage) return;
    pauseAutoDiscussionForPlayer();
    void unlockTtsPlayback();
    const message = createPendingPlayerMessage(trimmed, source);

    if (busy || speechActive) {
      setPendingPlayerMessage(message);
      return;
    }

    void submitPlayerMessage(message);
  }

  async function submitPlayerMessage(message: PendingPlayerMessage) {
    const content = message.content.trim();
    if (!content || !canChat || completed || playerSending) return;
    const wasBusy = busy;
    pauseAutoDiscussionForPlayer();
    void unlockTtsPlayback();
    setInput("");
    setPlayerSending(true);
    setBusy(true);
    try {
      await postSse(
        `/api/game/${sessionId}/message`,
        { channelType: "PUBLIC", channelKey: "public", content },
        handleEvent
      );
    } finally {
      setPlayerSending(false);
      if (!wasBusy) setBusy(false);
      setStreamingMsg(null);
    }
  }

  async function sendMessage() {
    const content = input.trim();
    if (!content || pendingPlayerMessage) return;
    setInput("");
    queueOrSubmitPlayerMessage(content, "text");
  }

  async function startVoiceInput() {
    if (recording || transcribing || !canChat || completed) return;
    pauseAutoDiscussionForPlayer();
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
        const currentDraft = input.trim();
        setInput("");
        queueOrSubmitPlayerMessage(currentDraft ? `${currentDraft}\n${text}` : text, "asr");
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

  async function advancePhase(force = false) {
    if (busy && !force) return;
    void unlockTtsPlayback();
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
    void unlockTtsPlayback();
    setBusy(true);
    try {
      await postSse(`/api/game/${sessionId}/player-command`, { command, params }, handleEvent);
      await refreshState();
    } finally {
      setBusy(false);
      setStreamingMsg(null);
    }
  }

  async function requestConsensus() {
    await sendCommand("REQUEST_CONSENSUS");
  }

  async function submitPhaseConclusion() {
    const conclusion = input.trim();
    if (!conclusion) {
      await sendCommand("REQUEST_CONSENSUS");
      return;
    }
    setInput("");
    await sendCommand("SUBMIT_PHASE_CONCLUSION", { conclusion });
  }

  async function markNoConsensus() {
    const reason = input.trim() || "目前大家对本阶段关键判断还没有形成一致意见。";
    setInput("");
    await sendCommand("MARK_NO_CONSENSUS", { reason, disputedPoints: [reason] });
  }

  async function requestDmClose() {
    await sendCommand("REQUEST_DM_CLOSE");
  }

  async function playClueToPublic(clue: ClueDeckItem) {
    if (!canChat || completed || busy || speechActive) return;
    void unlockTtsPlayback();
    setBusy(true);
    try {
      await postSse(
        `/api/game/${sessionId}/clue-action`,
        {
          clueId: clue.id,
          actionType: "PLAYER_SHOW_PUBLIC",
        },
        handleEvent
      );
      await refreshState();
    } finally {
      setBusy(false);
      setStreamingMsg(null);
    }
  }

  async function questionClueTarget(clue: ClueDeckItem, targetCharacterId: string, question: string) {
    if (!canChat || completed || busy || speechActive) return;
    void unlockTtsPlayback();
    setBusy(true);
    try {
      await postSse(
        `/api/game/${sessionId}/clue-action`,
        {
          clueId: clue.id,
          actionType: "PLAYER_QUESTION_CHARACTER",
          targetCharacterId,
          question,
        },
        handleEvent
      );
      await refreshState();
    } finally {
      setBusy(false);
      setStreamingMsg(null);
    }
  }

  function requestRecap() {
    void sendCommand("RECAP");
  }

  function focusFirstCharacter() {
    const target = state?.characters.find((c) => c.assignedTo === "AI");
    if (target) void sendCommand("FOCUS_CHARACTER", { characterName: target.name });
  }

  function openScriptReader(section: ScriptReaderSection = "overview") {
    setScriptReaderSection(section);
    setScriptDrawerOpen(true);
  }

  function handleComposerChange(value: string) {
    setInput(value);
  }

  function pauseAutoDiscussionForPlayer() {
    if (autoDiscussionTimerRef.current !== null) {
      window.clearTimeout(autoDiscussionTimerRef.current);
      autoDiscussionTimerRef.current = null;
    }
  }

  async function submitVote(targetId: string) {
    if (busy) return;
    void unlockTtsPlayback();
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
  const sequentialDisplayPhase = /自我介绍|最终陈词|陈词/.test(state.phase.name);
  const canGroupDiscuss = canChat && !completed && aiCount >= 2 && !sequentialDisplayPhase;
  const isReadingPhase = state.currentPhase === 0 || state.phase.name.includes("阅本");
  const composerLocked = !canChat || completed;
  const releasedClues = state.releasedClues as ClueDeckItem[];
  const phaseActionDisabled =
    busy || speechActive || playerSending || Boolean(pendingPlayerMessage) || recording || transcribing;
  const questionTargets = state.characters
    .filter((c) => c.assignedTo === "AI")
    .map((c) => ({ id: c.id, name: c.name, occupation: c.occupation }));
  const dmRuntime = agentStatuses.dm ?? { status: "LISTENING" as AgentRuntimeStatus, reason: "持续监听全场" };
  const agentStatusItems: AgentStatusItem[] = state.characters.map((character) => ({
    id: character.id,
    name: character.name,
    occupation: character.occupation,
    avatarUrl: character.avatarUrl,
    assignedTo: character.assignedTo,
    status: agentStatuses[character.id]?.status,
    reason: agentStatuses[character.id]?.reason,
  }));

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
          <Button
            type="button"
            variant={ttsEnabled ? "secondary" : "outline"}
            size="icon"
            className="h-8 w-8 shrink-0"
            title={ttsEnabled ? "自动朗读已开启" : "自动朗读已关闭"}
            onClick={async () => {
              const next = !ttsEnabled;
              setTtsEnabled(next);
              setTtsPlaybackEnabled(next);
              window.localStorage.setItem("soloplay.tts.enabled", String(next));
              if (next) await unlockTtsPlayback();
            }}
          >
            {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
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
            <Button size="sm" disabled={busy || isLastPhase || sequentialDisplayPhase} onClick={() => advancePhase()}>
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
          {!completed && (
            <StageControlPanel
              busy={busy || speechActive}
              canRequestHint={Boolean(pace?.canRequestHint)}
              canRequestRecap={Boolean(pace?.canRequestRecap)}
              canSkipPhase={Boolean(pace?.canSkipPhase) && !sequentialDisplayPhase}
              canAdvance={!isLastPhase && !sequentialDisplayPhase}
              onCommand={(command) => sendCommand(command)}
              onAdvance={() => advancePhase()}
              onPause={() => {
                void (async () => {
                  await sendCommand("PAUSE");
                  router.push("/history");
                })();
              }}
            />
          )}
          <AgentStatusRail
            dmStatus={dmRuntime.status}
            dmReason={dmRuntime.reason}
            agents={agentStatusItems}
            checklist={phaseAssessment?.checklist ?? []}
            focusTopic={phaseAssessment?.focusTopic}
          />
          {pace?.canFocusCharacter && !completed && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">快速质询</div>
              {state.characters.filter((c) => c.assignedTo === "AI").slice(0, 3).map((c) => (
                <Button
                  key={c.id}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  disabled={busy || speechActive}
                  onClick={() => sendCommand("FOCUS_CHARACTER", { characterName: c.name })}
                >
                  <SmallAvatar src={c.avatarUrl} name={c.name} />
                  <span className="truncate">{c.name}</span>
                </Button>
              ))}
            </div>
          )}
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
                  <MessageBubble
                    key={m.id}
                    msg={m}
                    avatarUrl={avatarFor(m.senderId, m.senderType)}
                    theme={scriptTheme}
                    ttsProfile={buildTtsProfile(m, state)}
                  />
                ))}
                {isReadingPhase && !completed && (
                  <ReadingStartCard
                    disabled={busy || speechActive}
                    onStart={() => advancePhase()}
                  />
                )}
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
                {canGroupDiscuss && (
                  <div className="mb-2 flex items-center gap-2">
                    <Button
                      variant={autoDiscussionEnabled ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setAutoDiscussionEnabled((next) => !next)}
                      title="开启后，空闲时 Agent 会持续公共讨论，玩家可随时插话"
                    >
                      <Users className="h-3.5 w-3.5" /> 自动讨论：{autoDiscussionEnabled ? "开" : "关"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || speechActive}
                      onClick={() => sendCommand("GROUP_DISCUSS")}
                      title="立即让在场角色接着讨论一轮"
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> 立即续聊
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      空闲时会自动续聊；你开始输入时会暂缓。
                    </span>
                  </div>
                )}
                {canChat && !completed && !sequentialDisplayPhase && (
                  <PhaseActionPanel
                    disabled={phaseActionDisabled}
                    status={phaseAssessment?.status}
                    consensus={phaseAssessment?.consensus}
                    hasDraft={Boolean(input.trim())}
                    onRequestConsensus={requestConsensus}
                    onSubmitConclusion={submitPhaseConclusion}
                    onMarkNoConsensus={markNoConsensus}
                    onRequestDmClose={requestDmClose}
                  />
                )}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={input}
                    onChange={(e) => handleComposerChange(e.target.value)}
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
                        ? pendingPlayerMessage
                          ? "上一条发言正在排队等待…"
                          : speechActive || busy
                          ? "可以先发言，系统会等上一位说完再发送…"
                          : "在公共频道发言…（Enter 发送，Shift+Enter 换行）"
                        : `当前阶段「${state.phase.name}」尚未开放发言`
                    }
                    disabled={composerLocked}
                    className="max-h-32 resize-none"
                    rows={2}
                  />
                  <Button
                    type="button"
                    variant={recording ? "destructive" : "outline"}
                    onClick={recording ? stopVoiceInput : startVoiceInput}
                    disabled={composerLocked || transcribing || Boolean(pendingPlayerMessage) || playerSending}
                    size="icon"
                    className="h-[60px] w-12"
                    title={recording ? "停止录音并发送" : "语音输入"}
                  >
                    {transcribing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : recording ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </Button>
                  <Button onClick={sendMessage} disabled={composerLocked || playerSending || Boolean(pendingPlayerMessage) || !input.trim()} size="icon" className="h-[60px] w-12">
                    {playerSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                {(recording || transcribing) && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {recording ? "正在录音，点击停止后会用 Step ASR 转成文字并发送。" : "正在调用 Step ASR 识别语音…"}
                  </p>
                )}
                {pendingPlayerMessage && (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-foreground">
                    <div className="flex min-w-0 items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                      <span className="shrink-0 font-medium">等待上一位发言结束</span>
                      <span className="min-w-0 truncate text-muted-foreground">{pendingPlayerMessage.content}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => setPendingPlayerMessage(null)}
                    >
                      取消
                    </Button>
                  </div>
                )}
              </div>
              <PlayerHand
                playerCharacter={state.playerCharacter}
                publicStory={state.publicStory}
                clues={releasedClues}
                busy={busy || speechActive}
                canChat={canChat && !completed}
                onOpenScript={openScriptReader}
                onPlayClue={playClueToPublic}
                onRecap={requestRecap}
                onFocusFirstCharacter={focusFirstCharacter}
              />
            </>
          )}

          {tab === "private" && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <PrivateChat
                sessionId={sessionId}
                characters={state.characters}
                privateEnabled={state.phase.permissions.privateChat && !completed}
                theme={scriptTheme}
                ttsEnabled={ttsEnabled}
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
                    <Card key={c.id} className="overflow-hidden border-primary/20">
                      {c.imageUrl && (
                        <div
                          className="h-36 border-b border-primary/20 bg-secondary bg-cover bg-center"
                          style={{ backgroundImage: `url("${c.imageUrl}")` }}
                        />
                      )}
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <ScrollText className="h-4 w-4 text-primary" />
                          {c.title}
                          <Badge variant="secondary">{c.clueType}</Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm leading-relaxed text-muted-foreground">{c.content}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canChat || completed || busy || speechActive}
                          onClick={() => playClueToPublic(c)}
                        >
                          <Send className="h-3.5 w-3.5" />
                          打出到公屏
                        </Button>
                      </CardContent>
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

        {/* 右侧：DM 主持台 */}
        {!completed && (
          <aside className="case-panel hidden w-72 shrink-0 overflow-y-auto border-y-0 border-r-0 p-3 xl:block">
            <DmHostPanel
              panel={dmPanel}
              phaseName={state.phase.name}
              phaseDescription={state.phase.description}
              clues={releasedClues}
              hintsUsed={state.hintsUsed}
              themeLabel={scriptTheme.label}
              phaseStatus={phaseAssessment?.status}
              focusTopic={phaseAssessment?.focusTopic}
              consensus={phaseAssessment?.consensus}
              checklist={phaseAssessment?.checklist ?? []}
              questionTargets={questionTargets}
              onPlayClue={playClueToPublic}
              onQuestionClue={questionClueTarget}
            />
          </aside>
        )}
      </div>
      <ScriptDrawer
        open={scriptDrawerOpen}
        onClose={() => setScriptDrawerOpen(false)}
        activeSection={scriptReaderSection}
        onSectionChange={setScriptReaderSection}
        scriptTitle={state.scriptTitle}
        publicStory={state.publicStory}
        playerCharacter={state.playerCharacter}
      />
    </div>
  );
}

function ReadingStartCard({ disabled, onStart }: { disabled: boolean; onStart: () => void }) {
  return (
    <div className="mx-auto my-5 max-w-md rounded-lg border border-primary/30 bg-primary/5 p-4 text-center shadow-sm">
      <div className="text-sm font-semibold text-foreground">阅本完成</div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        DM 已准备好主持下一阶段。
      </p>
      <Button className="mt-3 min-w-36" size="lg" disabled={disabled} onClick={onStart}>
        <Play className="h-4 w-4" />
        游戏开始
      </Button>
    </div>
  );
}

function PhaseActionPanel({
  disabled,
  status,
  consensus,
  hasDraft,
  onRequestConsensus,
  onSubmitConclusion,
  onMarkNoConsensus,
  onRequestDmClose,
}: {
  disabled: boolean;
  status?: PhaseAssessmentStatus;
  consensus?: ConsensusState;
  hasDraft: boolean;
  onRequestConsensus: () => void;
  onSubmitConclusion: () => void;
  onMarkNoConsensus: () => void;
  onRequestDmClose: () => void;
}) {
  return (
    <div className="mb-2 rounded-md border border-border bg-background/45 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[11px] text-muted-foreground">
          阶段收敛
          {consensus?.agreedPoints?.[0] ? ` · ${consensus.agreedPoints[0]}` : ""}
        </div>
        <Badge variant={status === "CAN_CLOSE" ? "success" : status === "EVIDENCE_NEEDED" || status === "CONSENSUS_CHECK" ? "secondary" : "outline"}>
          {formatPhaseActionStatus(status)}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={disabled} onClick={onRequestConsensus}>
          <RefreshCw className="h-3.5 w-3.5" /> 共识检查
        </Button>
        <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" disabled={disabled} onClick={onSubmitConclusion}>
          <Send className="h-3.5 w-3.5" /> {hasDraft ? "提交结论" : "先查共识"}
        </Button>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={disabled} onClick={onMarkNoConsensus}>
          <MessageSquare className="h-3.5 w-3.5" /> 无共识
        </Button>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={disabled} onClick={onRequestDmClose}>
          <Play className="h-3.5 w-3.5" /> 收束
        </Button>
      </div>
    </div>
  );
}

function formatPhaseActionStatus(status?: PhaseAssessmentStatus) {
  switch (status) {
    case "EVIDENCE_NEEDED":
      return "待举证";
    case "CONSENSUS_CHECK":
      return "待结论";
    case "NO_CONSENSUS":
      return "有分歧";
    case "CAN_CLOSE":
      return "可收束";
    case "CLOSING":
      return "收束中";
    case "WAITING_PLAYER":
      return "等你";
    default:
      return "监听中";
  }
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

function buildTtsProfile(
  message: Pick<MessageDTO, "senderType" | "senderId" | "senderName" | "content">,
  state: GameState,
  textOverride?: string
): TtsPlaybackProfile {
  if (message.senderType === "DM") {
    return {
      text: textOverride ?? message.content,
      senderType: message.senderType,
      senderId: message.senderId,
      senderName: "DM",
    };
  }
  const character =
    state.characters.find((c) => c.id === message.senderId) ??
    (message.senderType === "PLAYER" ? state.playerCharacter : null);
  return {
    text: textOverride ?? message.content,
    senderType: message.senderType,
    senderId: message.senderId,
    senderName: message.senderName,
    gender: character?.gender,
    occupation: character?.occupation,
    publicProfile: character?.publicProfile,
  };
}

function formatMessageContentForChat(senderType: string, content: string) {
  return senderType === "DM" ? summarizeDmForChat(content) : content;
}

function buildDmPanel(id: string, content: string, phase: number): DmHostPanelModel {
  const cleaned = cleanDmText(content);
  return {
    id,
    title: inferDmTitle(content),
    summary: summarizeDmForChat(content),
    content: cleaned,
    meta: `阶段 ${phase}`,
  };
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
