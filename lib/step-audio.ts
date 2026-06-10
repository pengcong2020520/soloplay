const stepApiKey = process.env.STEP_API_KEY?.trim();
const STEP_BASE_URL = process.env.STEP_BASE_URL?.trim() || "https://api.stepfun.com/step_plan/v1";

const TTS_MODEL = process.env.STEP_TTS_MODEL?.trim() || "stepaudio-2.5-tts";
export const REALTIME_AUDIO_MODEL = process.env.STEP_REALTIME_AUDIO_MODEL?.trim() || "stepaudio-2.5-realtime";
export const STEP_IMAGE_MODEL = process.env.STEP_IMAGE_MODEL?.trim() || "step-image-edit-2";
const TTS_VOICE = process.env.STEP_TTS_VOICE?.trim() || "cixingnansheng";
const TTS_DM_VOICE = process.env.STEP_TTS_DM_VOICE?.trim() || "boyinnansheng";
const TTS_MALE_VOICES = parseVoicePool(
  process.env.STEP_TTS_MALE_VOICES,
  ["cixingnansheng", "ruyananshi", "wenrougongzi", "shenchennanyin", "zhengpaiqingnian", "yuanqinansheng", "boyinnansheng", "shuangkuainansheng"]
);
const TTS_FEMALE_VOICES = parseVoicePool(
  process.env.STEP_TTS_FEMALE_VOICES,
  ["wenrounvsheng", "ganliannvsheng", "jingdiannvsheng", "tianmeinvsheng", "qingchunshaonv", "linjiajiejie", "huolinvsheng", "qinhenvsheng"]
);
const ASR_MODEL = process.env.STEP_ASR_MODEL?.trim() || "stepaudio-2.5-asr";
const AUDIO_TIMEOUT_MS = Number(process.env.STEP_AUDIO_TIMEOUT_MS) || 60_000;
const TTS_TIMEOUT_MS = Number(process.env.STEP_TTS_TIMEOUT_MS) || 25_000;
const TTS_MAX_CHARS = Number(process.env.STEP_TTS_MAX_CHARS) || 240;
const TTS_INSTRUCTION_MAX_CHARS = Number(process.env.STEP_TTS_INSTRUCTION_MAX_CHARS) || 200;

export interface RoleSpeechInput {
  text: string;
  senderType?: string;
  senderName?: string;
  gender?: string | null;
  occupation?: string | null;
  publicProfile?: string | null;
  voice?: string;
}

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
  instruction,
}: {
  text: string;
  voice?: string;
  instruction?: string;
}) {
  const input = normalizeTtsText(text);
  if (!input) throw new Error("TTS 文本不能为空。");
  if (input.length > TTS_MAX_CHARS) {
    throw new Error(`TTS 文本过长（${input.length}/${TTS_MAX_CHARS}），请先在客户端按句切分。`);
  }

  const body: Record<string, unknown> = {
    model: TTS_MODEL,
    input,
    voice: voice?.trim() || TTS_VOICE,
    response_format: "mp3",
    sample_rate: 24000,
    volume: 1,
    speed: 1,
    markdown_filter: true,
  };
  if (instruction && TTS_MODEL === "stepaudio-2.5-tts") {
    body.instruction = instruction.slice(0, TTS_INSTRUCTION_MAX_CHARS);
  }

  const res = await fetch(`${STEP_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireStepKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Step TTS ${res.status}: ${await readError(res)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export function buildRoleSpeechOptions(input: RoleSpeechInput) {
  const senderType = input.senderType ?? "";
  const senderName = input.senderName?.trim() || (senderType === "DM" ? "DM" : "角色");
  const text = normalizeTtsText(input.text);

  if (senderType === "DM") {
    return {
      text,
      voice: input.voice?.trim() || TTS_DM_VOICE,
      instruction: "你是剧本杀主持人DM。声音稳定、有掌控感，节奏清楚，带轻微悬疑旁白感；自然停顿，不机械，不夸张。",
    };
  }

  const voice = input.voice?.trim() || pickCharacterVoice(senderName, input.gender);
  const gender = input.gender?.trim() || "未知性别";
  const occupation = input.occupation?.trim();
  const profile = compactProfile(input.publicProfile);
  const identity = [senderName, gender, occupation].filter(Boolean).join("，");
  const instruction = trimByChars(
    `以剧本杀角色“${identity}”的身份朗读。音色符合性别，语气贴合人设${profile ? `：${profile}` : ""}。自然、有情绪，不机械；括号内是动作提示，不要读出。`,
    TTS_INSTRUCTION_MAX_CHARS
  );

  return { text, voice, instruction };
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

function parseVoicePool(value: string | undefined, fallback: string[]) {
  const voices = value
    ?.split(",")
    .map((voice) => voice.trim())
    .filter(Boolean);
  return voices && voices.length > 0 ? voices : fallback;
}

function pickCharacterVoice(name: string, gender?: string | null) {
  const pool = isFemale(gender) ? TTS_FEMALE_VOICES : isMale(gender) ? TTS_MALE_VOICES : hashString(name) % 2 === 0 ? TTS_MALE_VOICES : TTS_FEMALE_VOICES;
  return pool[hashString(name) % pool.length] ?? TTS_VOICE;
}

function isFemale(gender?: string | null) {
  return /女|female/i.test(gender ?? "");
}

function isMale(gender?: string | null) {
  return /男|male/i.test(gender ?? "");
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function compactProfile(value?: string | null) {
  return value
    ?.replace(/\s+/g, " ")
    .replace(/[。！？!?].*$/, "")
    .trim()
    .slice(0, 70);
}

function normalizeTtsText(text: string) {
  return text
    .replace(/^【DM】\s*/g, "")
    .replace(/^【系统】\s*/g, "")
    .replace(/（([^（）]{1,80})）/g, "($1)")
    .replace(/[🎉💀⚠️🔍]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimByChars(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1)).replace(/[，,；;：:\s]*$/, "")}…`;
}
