export interface TurnIntegrityResult {
  complete: boolean;
  repaired: boolean;
  continuationCount: number;
  streamError?: string;
  reason?: string;
}

const TERMINAL_RE = /[。！？!?…」』）\])"']$/;
const SOFT_BREAK_RE = /[，,、：:；;（([{「『“"']$/;
const DANGLING_WORD_RE = /(因为|但是|所以|如果|而且|不过|只是|我想|我觉得|比如|例如|首先|其次|最后|至于|关于|我必须|我可以|我不能)$/;
const DANGLING_PHASE_RE = /(现在)?(正式)?进入(第?[一二三四五六七八九十\d]+)?阶段$/;

export function assessTurnIntegrity(
  text: string,
  opts: { streamError?: unknown; minLength?: number } = {}
): TurnIntegrityResult {
  const cleaned = normalizeTurnText(text);
  const streamError = opts.streamError ? String((opts.streamError as Error)?.message ?? opts.streamError) : undefined;

  if (!cleaned) {
    return {
      complete: false,
      repaired: false,
      continuationCount: 0,
      streamError,
      reason: streamError ? "stream_error_empty" : "empty",
    };
  }

  if (streamError) {
    return {
      complete: false,
      repaired: false,
      continuationCount: 0,
      streamError,
      reason: "stream_error_partial",
    };
  }

  if (isLikelyIncompleteTurn(cleaned, opts.minLength)) {
    return {
      complete: false,
      repaired: false,
      continuationCount: 0,
      reason: "unfinished_sentence",
    };
  }

  return { complete: true, repaired: false, continuationCount: 0 };
}

export function isLikelyIncompleteTurn(text: string, minLength = 48) {
  const cleaned = normalizeTurnText(text);
  if (!cleaned) return true;
  if (SOFT_BREAK_RE.test(cleaned)) return true;
  const compact = cleaned.replace(/\s+/g, "");
  if (DANGLING_WORD_RE.test(compact)) return true;
  if (DANGLING_PHASE_RE.test(compact)) return true;
  if (hasUnclosedPunctuation(cleaned)) return true;
  if (cleaned.length >= minLength && !TERMINAL_RE.test(cleaned)) return true;
  return false;
}

export function buildContinuationDirective(args: {
  speakerName: string;
  partialText: string;
  originalDirective?: string;
  isDM?: boolean;
}) {
  const identity = args.isDM ? "DM" : `角色"${args.speakerName}"`;
  const partial = normalizeTurnText(args.partialText).slice(-260);
  return `${identity}刚才的发言在生成中途被打断。请不要重说前文，也不要道歉或提到系统中断；只从断点自然补完 1~3 句，让这段话有完整收束。${
    args.originalDirective ? `原始发言任务是：${args.originalDirective}` : ""
  }\n\n已说出的末尾：${partial}`;
}

export function mergeContinuation(base: string, continuation: string) {
  const left = normalizeTurnText(base);
  const right = normalizeTurnText(continuation);
  if (!left) return right;
  if (!right) return left;

  const normalizedLeft = left.replace(/\s+/g, "");
  const normalizedRight = right.replace(/\s+/g, "");
  if (normalizedLeft.endsWith(normalizedRight)) return left;
  if (normalizedRight.startsWith(normalizedLeft)) return right;

  const overlap = findNormalizedOverlap(normalizedLeft, normalizedRight);
  const repeatedPrefix = findRepeatedRightPrefix(normalizedLeft, normalizedRight);
  const trimChars = Math.max(overlap, repeatedPrefix);
  const trimmedRight = trimNormalizedPrefix(right, trimChars);
  if (!trimmedRight) return left;

  return `${left}${needsSpaceBetween(left, trimmedRight) ? " " : ""}${trimmedRight}`;
}

export function normalizeTurnText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildTurnIntegrityMetadata(result: TurnIntegrityResult) {
  return {
    complete: result.complete,
    repaired: result.repaired,
    continuationCount: result.continuationCount,
    reason: result.reason,
    streamError: result.streamError,
  };
}

function hasUnclosedPunctuation(text: string) {
  const pairs: [string, string][] = [
    ["「", "」"],
    ["『", "』"],
    ["“", "”"],
    ["（", "）"],
    ["(", ")"],
    ["《", "》"],
  ];
  return pairs.some(([open, close]) => count(text, open) > count(text, close));
}

function count(text: string, token: string) {
  return text.split(token).length - 1;
}

function needsSpaceBetween(left: string, right: string) {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

function findNormalizedOverlap(left: string, right: string) {
  const max = Math.min(180, left.length, right.length);
  for (let length = max; length >= 4; length--) {
    if (left.endsWith(right.slice(0, length))) return length;
  }
  return 0;
}

function findRepeatedRightPrefix(left: string, right: string) {
  const max = Math.min(180, right.length);
  for (let length = max; length >= 10; length--) {
    if (left.includes(right.slice(0, length))) return length;
  }
  return 0;
}

function trimNormalizedPrefix(value: string, normalizedCharsToTrim: number) {
  if (normalizedCharsToTrim <= 0) return value;
  let normalizedCount = 0;
  let index = 0;
  while (index < value.length && normalizedCount < normalizedCharsToTrim) {
    if (!/\s/.test(value[index])) normalizedCount += 1;
    index += 1;
  }
  return value.slice(index).trimStart();
}
