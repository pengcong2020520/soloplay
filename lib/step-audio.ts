const stepApiKey = process.env.STEP_API_KEY?.trim();
const STEP_BASE_URL = process.env.STEP_BASE_URL?.trim() || "https://api.stepfun.com/v1";

const TTS_MODEL = process.env.STEP_TTS_MODEL?.trim() || "step-tts-mini";
const TTS_VOICE = process.env.STEP_TTS_VOICE?.trim() || "cixingnansheng";
const ASR_MODEL = process.env.STEP_ASR_MODEL?.trim() || "stepaudio-2.5-asr";
const AUDIO_TIMEOUT_MS = Number(process.env.STEP_AUDIO_TIMEOUT_MS) || 60_000;
const TTS_TIMEOUT_MS = Number(process.env.STEP_TTS_TIMEOUT_MS) || 25_000;
const TTS_MAX_CHARS = Number(process.env.STEP_TTS_MAX_CHARS) || 180;

function requireStepKey() {
  if (!stepApiKey) {
    throw new Error("STEP_API_KEY 未配置，无法使用 Step 语音能力。");
  }
  return stepApiKey;
}

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  return text.slice(0, 500) || res.statusText;
}

export async function synthesizeSpeech({
  text,
  voice,
}: {
  text: string;
  voice?: string;
}) {
  const input = text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TTS_MAX_CHARS);
  if (!input) throw new Error("TTS 文本不能为空。");

  const res = await fetch(`${STEP_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireStepKey()}`,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input,
      voice: voice?.trim() || TTS_VOICE,
      response_format: "mp3",
      sample_rate: 24000,
      volume: 1,
      speed: 1,
      markdown_filter: true,
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Step TTS ${res.status}: ${await readError(res)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export async function transcribePcm16({
  audioBase64,
  sampleRate,
  language = "zh",
}: {
  audioBase64: string;
  sampleRate: number;
  language?: string;
}) {
  const cleanAudio = audioBase64.replace(/^data:audio\/[^;]+;base64,/, "").trim();
  if (!cleanAudio) throw new Error("ASR 音频不能为空。");

  const res = await fetch(`${STEP_BASE_URL}/audio/asr/sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${requireStepKey()}`,
    },
    body: JSON.stringify({
      audio: {
        data: cleanAudio,
        input: {
          transcription: {
            language,
            hotwords: ["剧本杀", "DM", "线索", "凶手", "侦探"],
            model: ASR_MODEL,
            enable_itn: true,
            enable_timestamp: false,
          },
          format: {
            type: "pcm",
            codec: "pcm_s16le",
            rate: sampleRate,
            bits: 16,
            channel: 1,
          },
        },
      },
    }),
    signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS),
  });

  if (!res.ok || !res.body) {
    const err = res.ok ? "无响应流" : await readError(res);
    throw new Error(`Step ASR ${res.status}: ${err}`);
  }

  return parseAsrSse(res.body);
}

async function parseAsrSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalText = "";
  let deltaText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      const event = JSON.parse(payload) as {
        type?: string;
        delta?: string;
        text?: string;
        error?: { message?: string };
        message?: string;
      };
      if (event.type === "transcript.text.delta" && event.delta) {
        deltaText += event.delta;
      } else if (event.type === "transcript.text.done" && event.text) {
        finalText = event.text;
      } else if (event.type === "error" || event.type === "transcript.text.error") {
        throw new Error(event.error?.message || event.message || "Step ASR 返回错误。");
      }
    }
  }

  return (finalText || deltaText).trim();
}
