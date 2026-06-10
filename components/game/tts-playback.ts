"use client";

export interface TtsPlaybackProfile {
  text: string;
  senderType: string;
  senderId?: string;
  senderName: string;
  gender?: string | null;
  occupation?: string | null;
  publicProfile?: string | null;
}

export interface TtsPlaybackCallbacks {
  onStart?: () => void;
  onFinish?: () => void;
  onError?: (error: unknown) => void;
  onSkip?: () => void;
}

export interface TtsPlaybackState {
  pendingCount: number;
  playing: boolean;
  active: boolean;
}

interface QueueItem {
  id: string;
  profile: TtsPlaybackProfile;
  callbacks?: TtsPlaybackCallbacks;
  preparedUrl?: string;
  preparePromise?: Promise<string>;
  revealed: boolean;
  resolve: () => void;
}

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
const PREFETCH_AHEAD = 2;
const PLAYBACK_TIMEOUT_MS = 60_000;
const SEGMENT_MAX_CHARS = 220;

let enabled = true;
let unlocked = false;
let blocked = false;
let playing = false;
let audioEl: HTMLAudioElement | null = null;
let queue: QueueItem[] = [];
let itemCounter = 0;
const listeners = new Set<(state: TtsPlaybackState) => void>();

function getAudioElement() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

export function setTtsPlaybackEnabled(next: boolean) {
  enabled = next;
  if (!next) {
    revealQueuedWithoutAudio();
    stopCurrentAudio();
    notifyListeners();
    return;
  }
  blocked = false;
  void prefetchUpcoming();
  void playNext();
  notifyListeners();
}

export function queueTtsPlayback(
  profile: TtsPlaybackProfile,
  callbacks?: TtsPlaybackCallbacks
): Promise<void> {
  if (!profile.text.trim()) return Promise.resolve();
  if (profile.senderType === "PLAYER") {
    callbacks?.onStart?.();
    callbacks?.onFinish?.();
    return Promise.resolve();
  }
  if (!enabled) {
    callbacks?.onStart?.();
    callbacks?.onSkip?.();
    callbacks?.onFinish?.();
    return Promise.resolve();
  }

  let resolve!: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });

  const segments = splitTtsText(profile.text.trim(), SEGMENT_MAX_CHARS);
  segments.forEach((segment, index) => {
    const first = index === 0;
    const last = index === segments.length - 1;
    queue.push({
      id: `tts-${Date.now()}-${itemCounter++}`,
      profile: { ...profile, text: segment },
      callbacks: {
        onStart: first ? callbacks?.onStart : undefined,
        onError: callbacks?.onError,
        onSkip: last ? callbacks?.onSkip : undefined,
        onFinish: last ? callbacks?.onFinish : undefined,
      },
      revealed: false,
      resolve: last ? resolve : () => {},
    });
  });
  notifyListeners();

  if (queue.length > 64) {
    const dropped = queue.splice(0, queue.length - 64);
    for (const item of dropped) {
      revealWithoutAudio(item);
    }
  }

  void prefetchUpcoming();
  void playNext();
  return done;
}

export async function unlockTtsPlayback() {
  if (unlocked || typeof window === "undefined") return true;
  try {
    const audio = getAudioElement();
    audio.src = SILENT_WAV;
    audio.muted = true;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    unlocked = true;
    blocked = false;
    void prefetchUpcoming();
    void playNext();
    return true;
  } catch (err) {
    blocked = true;
    console.warn("[tts] unlock failed", err);
    return false;
  }
}

export async function speakTtsNow(profile: TtsPlaybackProfile) {
  revealQueuedWithoutAudio();
  stopCurrentAudio();
  const done = queueTtsPlayback(profile);
  await unlockTtsPlayback();
  void playNext();
  return done;
}

export function stopTtsPlayback() {
  revealQueuedWithoutAudio();
  stopCurrentAudio();
  notifyListeners();
}

export function subscribeTtsPlaybackState(listener: (state: TtsPlaybackState) => void) {
  listeners.add(listener);
  listener(getPlaybackState());
  return () => {
    listeners.delete(listener);
  };
}

async function playNext() {
  if (!enabled || playing || typeof window === "undefined") return;
  const item = queue.shift();
  if (!item) return;

  playing = true;
  notifyListeners();
  let url: string | null = null;
  try {
    if (blocked) {
      revealWithoutAudio(item);
      return;
    }

    if (!unlocked) {
      const ok = await unlockTtsPlayback();
      if (!ok) {
        revealWithoutAudio(item);
        return;
      }
    }

    url = await ensureAudio(item);
    const audio = getAudioElement();
    audio.src = url;
    audio.muted = false;
    revealItem(item);
    await audio.play();
    await waitForAudioToEnd(audio);
    item.callbacks?.onFinish?.();
    item.resolve();
  } catch (err) {
    if ((err as Error).name === "NotAllowedError") {
      blocked = true;
    }
    console.warn("[tts] playback failed", err);
    revealWithoutAudio(item, err);
  } finally {
    if (url) URL.revokeObjectURL(url);
    playing = false;
    notifyListeners();
    void prefetchUpcoming();
    if (!blocked || queue.length > 0) void playNext();
  }
}

async function ensureAudio(item: QueueItem): Promise<string> {
  if (item.preparedUrl) return item.preparedUrl;
  if (!item.preparePromise) {
    item.preparePromise = fetchAudio(item.profile)
      .then((url) => {
        item.preparedUrl = url;
        return url;
      })
      .catch((err) => {
        item.preparePromise = undefined;
        throw err;
      });
  }
  return item.preparePromise;
}

async function prefetchUpcoming() {
  if (!enabled || blocked || typeof window === "undefined") return;
  const upcoming = queue.slice(0, PREFETCH_AHEAD);
  await Promise.all(
    upcoming.map((item) =>
      ensureAudio(item).catch((err) => {
        console.warn("[tts] prefetch failed", err);
      })
    )
  );
}

async function fetchAudio(profile: TtsPlaybackProfile) {
  const res = await fetch("/api/audio/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "TTS 生成失败");
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function waitForAudioToEnd(audio: HTMLAudioElement) {
  return new Promise<void>((resolve) => {
    let timeout: number | null = null;
    const done = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      audio.onended = null;
      audio.onerror = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    timeout = window.setTimeout(done, PLAYBACK_TIMEOUT_MS);
  });
}

function revealItem(item: QueueItem) {
  if (item.revealed) return;
  item.revealed = true;
  item.callbacks?.onStart?.();
}

function revealWithoutAudio(item: QueueItem, err?: unknown) {
  revealItem(item);
  if (err) item.callbacks?.onError?.(err);
  item.callbacks?.onSkip?.();
  item.callbacks?.onFinish?.();
  item.resolve();
  if (item.preparedUrl) URL.revokeObjectURL(item.preparedUrl);
}

function revealQueuedWithoutAudio() {
  const pending = queue;
  queue = [];
  for (const item of pending) {
    revealWithoutAudio(item);
  }
  notifyListeners();
}

function stopCurrentAudio() {
  blocked = false;
  playing = false;
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load();
  }
}

function getPlaybackState(): TtsPlaybackState {
  return {
    pendingCount: queue.length,
    playing,
    active: playing || queue.length > 0,
  };
}

function notifyListeners() {
  const state = getPlaybackState();
  for (const listener of listeners) {
    listener(state);
  }
}

function splitTtsText(text: string, maxChars: number) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return [cleaned];

  const sentences =
    cleaned.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((item) => item.trim()).filter(Boolean) ?? [cleaned];
  const segments: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
    } else if ((current + sentence).length <= maxChars) {
      current += sentence;
    } else {
      pushChunked(segments, current, maxChars);
      current = sentence;
    }
  }
  pushChunked(segments, current, maxChars);
  return segments.length > 0 ? segments : [cleaned.slice(0, maxChars)];
}

function pushChunked(segments: string[], value: string, maxChars: number) {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (trimmed.length <= maxChars) {
    segments.push(trimmed);
    return;
  }
  for (let start = 0; start < trimmed.length; start += maxChars) {
    segments.push(trimmed.slice(start, start + maxChars));
  }
}
