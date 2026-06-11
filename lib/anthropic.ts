import Anthropic from "@anthropic-ai/sdk";

/**
 * 多后端 LLM 客户端。优先级：
 *   1. Step（阶跃星辰，OpenAI 兼容）—— 设置 STEP_API_KEY 时启用
 *   2. Anthropic Claude —— 设置 ANTHROPIC_API_KEY 时启用
 *   3. mock 兜底 —— 都不设置时，走内置样例，整套流程零配置可跑通
 *
 * 三个导出函数 complete / streamComplete / completeJson 的签名对上层保持不变，
 * 切换后端不需要改任何调用方。
 */

const stepApiKey = process.env.STEP_API_KEY?.trim();
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();

type Provider = "step" | "anthropic" | "mock";
export const PROVIDER: Provider = stepApiKey ? "step" : anthropicApiKey ? "anthropic" : "mock";

/** 有任一真实后端的密钥即视为已配置（用于前端 Mock 模式提示）。 */
export const HAS_API_KEY = PROVIDER !== "mock";

// ─── Step（OpenAI 兼容）配置 ───────────────────────────
const STEP_BASE_URL = process.env.STEP_BASE_URL?.trim() || "https://api.stepfun.com/step_plan/v1";
const STEP_MODEL = process.env.STEP_MODEL?.trim() || "step-3.5-flash-2603";

const STEP_VISIBLE_OUTPUT_INSTRUCTION =
  "重要：你必须把给用户看的最终答案写入 chat completion 的 message.content；不要只写 reasoning_content。";
const STEP_REASONING_EFFORT = "low";

function supportsStepTemperature(model: string): boolean {
  // 仅保留 3.7 的兼容分支；默认高频 Agent 场景使用 step-3.5-flash-2603。
  // Step 3.7 Flash 是推理/Agent 模型；避免传入采样参数导致 OpenAI-compatible 端点拒绝。
  return !model.toLowerCase().includes("step-3.7-flash");
}

function normalizeStepMaxTokens(requested: number): number {
  // Step 推理/Agent 模型在很小的 max_tokens 下可能只产出 reasoning，导致 message.content 为空。
  // 不回退到 reasoning_content（那里可能包含推理过程），而是统一给可见答案留足输出空间。
  return Math.max(requested, 256);
}

// ─── Anthropic 配置 ───────────────────────────────────
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

/** 对外暴露当前使用的模型名（日志/调试用） */
export const MODEL = PROVIDER === "step" ? STEP_MODEL : ANTHROPIC_MODEL;

export const anthropic = anthropicApiKey && PROVIDER === "anthropic" ? new Anthropic({ apiKey: anthropicApiKey }) : null;

/**
 * 单次 LLM 调用超时（毫秒）。SSE 路由的 producer 里会顺序发起多次调用，
 * 平台级 maxDuration=120s 是整路由超时，这里给单次调用留预算，避免某次挂起拖垮整条流。
 * 可由 LLM_TIMEOUT_MS / ANTHROPIC_TIMEOUT_MS 覆盖。
 */
const REQUEST_TIMEOUT_MS =
  Number(process.env.LLM_TIMEOUT_MS) || Number(process.env.ANTHROPIC_TIMEOUT_MS) || 40_000;

/** 可重试错误的最大重试次数（仅针对 429 / 5xx / 网络抖动） */
const MAX_TRANSIENT_RETRIES = 2;

/**
 * Opus 4.7+ 移除了采样参数（temperature/top_p），传入会 400（仅 Anthropic 后端相关）。
 */
function supportsTemperature(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes("opus-4-7") || m.includes("opus-4-8") || m.includes("opus-4-9")) {
    return false;
  }
  return true;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

// ─── 错误分类 / 退避 ──────────────────────────────────

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** 判断一个错误是否值得重试（瞬时性） */
function isTransientError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    return status === 429 || status === 529 || (typeof status === "number" && status >= 500);
  }
  if (err instanceof HttpError) {
    return err.status === 429 || err.status >= 500;
  }
  const name = (err as { name?: string })?.name;
  return name === "AbortError" || name === "APIConnectionError" || name === "APIConnectionTimeoutError";
}

/** 不可重试（4xx 客户端错误，schema/鉴权问题） */
function isNonRetryableClientError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    return typeof err.status === "number" && err.status >= 400 && err.status < 500 && !isTransientError(err);
  }
  if (err instanceof HttpError) {
    return err.status >= 400 && err.status < 500 && err.status !== 429;
  }
  return false;
}

function backoffDelay(attempt: number): number {
  // 0.8s, 1.6s, ... 指数退避（无随机数，环境禁用 Math.random）
  return 800 * Math.pow(2, attempt);
}

// ─── Step（OpenAI 兼容）底层调用 ───────────────────────

/** 把 {system, messages} 转成 OpenAI 的 messages 数组 */
function toOpenAiMessages(system: string, messages: ChatMessage[]) {
  return [{ role: "system" as const, content: `${system}\n\n${STEP_VISIBLE_OUTPUT_INSTRUCTION}` }, ...messages];
}

/** Step 非流式 chat completion，返回纯文本 */
async function stepComplete(
  opts: CompleteOptions,
  defaultMaxTokens: number,
  defaultTemperature: number,
  jsonMode = false
): Promise<string> {
  const body: Record<string, unknown> = {
    model: STEP_MODEL,
    messages: toOpenAiMessages(opts.system, opts.messages),
    max_tokens: normalizeStepMaxTokens(opts.maxTokens ?? defaultMaxTokens),
  };
  if (supportsStepTemperature(STEP_MODEL)) {
    body.temperature = opts.temperature ?? defaultTemperature;
  } else {
    body.reasoning_effort = STEP_REASONING_EFFORT;
  }
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${STEP_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${stepApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new HttpError(res.status, `Step API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: {
      message?: { content?: string; reasoning_content?: string; reasoning?: string };
      finish_reason?: string;
    }[];
  };
  const msg = data.choices?.[0]?.message;
  const content = msg?.content?.trim();
  if (content) return content;
  throw new Error("Step API 返回了空的 message.content。");
}

/** Step 流式 chat completion，逐 chunk 产出文本 */
async function* stepStream(
  opts: CompleteOptions,
  defaultMaxTokens: number,
  defaultTemperature: number
): AsyncGenerator<string, void, unknown> {
  const body: Record<string, unknown> = {
    model: STEP_MODEL,
    messages: toOpenAiMessages(opts.system, opts.messages),
    max_tokens: normalizeStepMaxTokens(opts.maxTokens ?? defaultMaxTokens),
    stream: true,
  };
  if (supportsStepTemperature(STEP_MODEL)) {
    body.temperature = opts.temperature ?? defaultTemperature;
  } else {
    body.reasoning_effort = STEP_REASONING_EFFORT;
  }

  const res = await fetch(`${STEP_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${stepApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok || !res.body) {
    const errText = res.ok ? "无响应流" : await res.text().catch(() => "");
    throw new HttpError(res.ok ? 500 : res.status, `Step API stream ${res.status}: ${errText.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const chunk = json.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
      } catch {
        // 忽略不完整/无法解析的片段
      }
    }
  }
}

// ─── Anthropic 底层调用辅助 ───────────────────────────

function buildSystemBlocks(system: string): Anthropic.MessageCreateParams["system"] {
  return [
    {
      type: "text",
      text: system,
      cache_control: { type: "ephemeral" },
    } as Anthropic.TextBlockParam,
  ];
}

// ─── 对外统一接口 ─────────────────────────────────────

/**
 * 非流式补全。mock 模式由 mockFn 提供兜底文本。
 * 真实路径：带超时 + 瞬时错误退避重试；最终失败抛出（调用方负责降级）。
 */
export async function complete(opts: CompleteOptions, mockFn: () => string): Promise<string> {
  if (PROVIDER === "mock") return mockFn();

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      if (PROVIDER === "step") {
        return await stepComplete(opts, 1024, 0.8);
      }
      // anthropic
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens ?? 1024,
        system: buildSystemBlocks(opts.system),
        messages: opts.messages,
      };
      if (supportsTemperature(ANTHROPIC_MODEL)) params.temperature = opts.temperature ?? 0.8;
      const res = await anthropic!.messages.create(params, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_TRANSIENT_RETRIES && isTransientError(err)) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      if (attempt < MAX_TRANSIENT_RETRIES) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "LLM complete failed"));
}

/**
 * 流式补全。返回 async generator，逐块产出文本。
 * mock 模式把 mock 文本切块模拟流式输出。
 *
 * 真实路径的关键约定：流中途报错时，已产出的 chunk 不会回收——
 * 调用方（turn.ts）应在 try/finally 里落库已累计的内容。
 */
export async function* streamComplete(
  opts: CompleteOptions,
  mockFn: () => string
): AsyncGenerator<string, void, unknown> {
  if (PROVIDER === "mock") {
    const text = mockFn();
    for (let i = 0; i < text.length; i += 6) {
      yield text.slice(i, i + 6);
      await sleep(18);
    }
    return;
  }

  if (PROVIDER === "step") {
    let emitted = false;
    try {
      for await (const chunk of stepStream(opts, 1024, 0.85)) {
        emitted = true;
        yield chunk;
      }
    } catch (err) {
      if (emitted) throw err;
      throw err;
    }
    if (!emitted) {
      throw new Error("Step stream returned no visible content");
    }
    return;
  }

  // anthropic
  const params: Anthropic.MessageCreateParamsStreaming = {
    model: ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: buildSystemBlocks(opts.system),
    messages: opts.messages,
    stream: true,
  };
  if (supportsTemperature(ANTHROPIC_MODEL)) params.temperature = opts.temperature ?? 0.8;

  const stream = anthropic!.messages.stream(params, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

/**
 * 结构化 JSON 生成：要求模型只输出 JSON。
 * mock 模式使用 mockFn 返回的对象。带重试与 JSON 提取。
 */
export async function completeJson<T>(
  opts: CompleteOptions,
  mockFn: () => T,
  maxRetries = 3
): Promise<T> {
  if (PROVIDER === "mock") return mockFn();

  let lastErr: unknown;
  let maxTokens = opts.maxTokens ?? 8000;
  const jsonSystem =
    opts.system +
    "\n\n严格要求：只输出一个合法的 JSON 对象，不要任何额外说明文字、不要 markdown 代码块标记。";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      let text: string;
      let truncated = false;

      if (PROVIDER === "step") {
        // Step 支持 OpenAI 的 response_format: json_object，进一步保证输出是合法 JSON
        try {
          text = await stepComplete({ ...opts, system: jsonSystem, maxTokens }, maxTokens, opts.temperature ?? 0.9, true);
        } catch (err) {
          if (err instanceof HttpError && err.status === 400) {
            text = await stepComplete({ ...opts, system: jsonSystem, maxTokens }, maxTokens, opts.temperature ?? 0.9, false);
          } else {
            throw err;
          }
        }
      } else {
        const params: Anthropic.MessageCreateParamsNonStreaming = {
          model: ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          system: buildSystemBlocks(jsonSystem),
          messages: opts.messages,
        };
        if (supportsTemperature(ANTHROPIC_MODEL)) params.temperature = opts.temperature ?? 0.9;
        const res = await anthropic!.messages.create(params, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        truncated = res.stop_reason === "max_tokens";
      }

      if (truncated) {
        // 输出被截断，这次解析必失败。下次提高上限重试，而非重复同样的请求。
        maxTokens = Math.min(maxTokens * 2, 16000);
        lastErr = new Error("LLM 输出被截断（内容过长），已提高上限重试。");
        continue;
      }

      return extractJson<T>(text);
    } catch (err) {
      lastErr = err;
      // 不可重试错误（如 400 schema 错 / 401 鉴权）立即放弃
      if (isNonRetryableClientError(err)) throw err;
      if (isTransientError(err) && attempt < maxRetries - 1) {
        await sleep(backoffDelay(attempt));
      }
      // JSON 解析失败（SyntaxError）则直接进入下一次循环重试
    }
  }
  console.warn("[llm.completeJson] falling back after failure", lastErr);
  return mockFn();
}

function extractJson<T>(text: string): T {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(slice) as T;
  } catch (err) {
    const preview = cleaned.slice(0, 200);
    throw new Error(`JSON 解析失败：${(err as Error).message}。模型原文片段：${preview}…`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
