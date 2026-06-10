import type { LoadedSession } from "@/lib/game/session";
import { getAiCharacters, getCurrentPhase, getPlayerCharacter } from "@/lib/game/session";
import { isFreeDiscussionPhase, isSequentialCharacterPhase } from "@/lib/game/phase-flow";
import type { Character } from "@prisma/client";

export interface DialogueSignal {
  mentionedCharacterIds: string[];
  mentionedCharacterNames: string[];
  addressedCharacterIds: string[];
  addressedCharacterNames: string[];
  asksQuestion: boolean;
  shouldInvitePlayer: boolean;
}

export interface ResponderPlan {
  responders: Character[];
  signal: DialogueSignal;
  reason: string;
}

const QUESTION_RE = /[?？]|(为什么|怎么|是否|是不是|难道|谁|哪里|何时|几点|能不能|可不可以|你说|解释|交代)/;

export function analyzeDialogueTargets(
  loaded: LoadedSession,
  content: string,
  opts: { speakerId?: string; includePlayer?: boolean } = {}
): DialogueSignal {
  const normalized = normalize(content);
  const playerSc = getPlayerCharacter(loaded);
  const candidates = loaded.sessionCharacters
    .filter((sc) => sc.character.id !== opts.speakerId)
    .filter((sc) => opts.includePlayer || sc.assignedTo === "AI")
    .map((sc) => sc.character);

  const mentioned = candidates.filter((character) => isNameMentioned(normalized, character.name));
  const addressed = mentioned.filter((character) => isDirectAddress(normalized, character.name));
  const asksQuestion = QUESTION_RE.test(content);
  const playerMentioned = playerSc
    ? playerSc.character.id !== opts.speakerId &&
      isNameMentioned(normalized, playerSc.character.name)
    : false;

  return {
    mentionedCharacterIds: mentioned.map((c) => c.id),
    mentionedCharacterNames: mentioned.map((c) => c.name),
    addressedCharacterIds: addressed.map((c) => c.id),
    addressedCharacterNames: addressed.map((c) => c.name),
    asksQuestion,
    shouldInvitePlayer: Boolean(playerMentioned || /玩家|侦探|你来|你怎么看|你觉得/.test(content)),
  };
}

export function planPublicResponders(
  loaded: LoadedSession,
  content: string,
  opts: {
    speakerId?: string;
    maxSpeakers?: number;
    excludeSpeakerIds?: string[];
    fallbackSalt?: string;
  } = {}
): ResponderPlan {
  const phase = getCurrentPhase(loaded);
  if (isSequentialCharacterPhase(phase)) {
    return {
      responders: [],
      signal: emptySignal(),
      reason: "sequential phase",
    };
  }

  const ai = getAiCharacters(loaded)
    .map((sc) => sc.character)
    .filter((c) => c.id !== opts.speakerId)
    .filter((c) => !(opts.excludeSpeakerIds ?? []).includes(c.id));
  if (ai.length === 0) {
    return { responders: [], signal: emptySignal(), reason: "no ai characters" };
  }

  const signal = analyzeDialogueTargets(loaded, content, { speakerId: opts.speakerId });
  const directIds = signal.addressedCharacterIds.length > 0
    ? signal.addressedCharacterIds
    : signal.mentionedCharacterIds;
  const direct = directIds
    .map((id) => ai.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c));

  if (direct.length > 0) {
    return {
      responders: direct.slice(0, opts.maxSpeakers ?? 2),
      signal,
      reason: signal.addressedCharacterNames.length > 0 ? "direct address" : "character mentioned",
    };
  }

  const freeChat = isFreeDiscussionPhase(phase);
  const count = Math.min(opts.maxSpeakers ?? (freeChat ? 2 : 1), ai.length);
  const start = stableIndex(`${content}-${opts.fallbackSalt ?? ""}-${loaded.currentPhase}`, ai.length);
  const responders: Character[] = [];
  for (let i = 0; i < count; i++) {
    responders.push(ai[(start + i) % ai.length]);
  }
  return {
    responders,
    signal,
    reason: freeChat ? "free discussion rotation" : "phase rotation",
  };
}

export function pickNextGroupSpeaker(
  loaded: LoadedSession,
  lastContent: string,
  opts: {
    lastSpeakerId?: string;
    spokenIds?: Set<string>;
    fallbackSalt?: string;
  } = {}
): { speaker: Character | null; signal: DialogueSignal; reason: string } {
  const ai = getAiCharacters(loaded).map((sc) => sc.character);
  if (ai.length === 0) return { speaker: null, signal: emptySignal(), reason: "no ai characters" };

  const signal = analyzeDialogueTargets(loaded, lastContent, { speakerId: opts.lastSpeakerId });
  const mentionedIds = [
    ...signal.addressedCharacterIds,
    ...signal.mentionedCharacterIds.filter((id) => !signal.addressedCharacterIds.includes(id)),
  ];

  for (const id of mentionedIds) {
    const direct = ai.find(
      (c) => c.id === id && c.id !== opts.lastSpeakerId && !opts.spokenIds?.has(c.id)
    );
    if (direct) {
      return { speaker: direct, signal, reason: "mentioned speaker should answer" };
    }
  }

  const available = ai.filter((c) => c.id !== opts.lastSpeakerId && !opts.spokenIds?.has(c.id));
  const pool = available.length > 0 ? available : ai.filter((c) => c.id !== opts.lastSpeakerId);
  if (pool.length === 0) return { speaker: null, signal, reason: "no available speaker" };

  const idx = stableIndex(`${lastContent}-${opts.fallbackSalt ?? ""}-${loaded.session.id}`, pool.length);
  return { speaker: pool[idx], signal, reason: "natural rotation" };
}

export function buildResponderDirective(args: {
  playerName: string;
  playerContent: string;
  responderName: string;
  signal: DialogueSignal;
  isFirst: boolean;
  recentContents?: string[];
}) {
  const targetNames = args.signal.mentionedCharacterNames.filter((name) => name !== args.responderName);
  const targetHint = targetNames.length > 0
    ? `这段话提到了 ${targetNames.join("、")}，如果与你有关，请正面回应；如果与别人有关，请把问题递给相关角色。`
    : "如果你要点名别人，请明确说出对方名字，并提出一个具体问题。";
  const antiRepeat = buildAntiRepeatDirective(args.recentContents);

  if (args.isFirst) {
    return `${args.playerName}刚才在公共场合发言。请你以"${args.responderName}"的身份抓住一个最刺痛你或最能推进案情的点回应。${targetHint}不要复述玩家原话；可以回答、反问、表达怀疑、为自己辩白或要求另一位角色解释。句子自然，不要像总结稿。${antiRepeat}玩家原话如下："${args.playerContent}"`;
  }
  return `${args.playerName}刚才发言，前面的同伴也已经接话。请你以"${args.responderName}"的身份顺着当前讨论自然接一句：针对某个具体说法赞同、反驳、追问或补充。不要重复玩家或别人已经说过的内容；如果有人点到你的名字，必须先回应。${antiRepeat}`;
}

export function buildGroupDiscussionDirective(args: {
  speakerName: string;
  isFirst: boolean;
  topic?: string;
  previousContent?: string;
  signal?: DialogueSignal;
  recentContents?: string[];
}) {
  const antiRepeat = buildAntiRepeatDirective(args.recentContents);
  if (args.isFirst) {
    return `现在是自由交流时间，没有人点名你，但请你以"${args.speakerName}"的身份主动开口推进讨论：就案情抛出疑问、说出你对某个人的怀疑，或为自己辩白。${
      args.topic ? `不妨围绕"${args.topic}"展开。` : ""
    }直接发言，点名一两位在场者，并把一个具体问题递给玩家或另一位角色。不要复述玩家或同伴的原话。${antiRepeat}`;
  }

  const directHint = args.signal?.addressedCharacterNames.includes(args.speakerName) ||
    args.signal?.mentionedCharacterNames.includes(args.speakerName)
    ? "刚才有人明确提到你，请你先回应这一点。"
    : "请你接住上一位的话茬。";

  return `公共场合的讨论你都看到了。${directHint}以"${args.speakerName}"的身份自然地接话：针对前面某位的说法表示赞同、反驳、追问或补充，把话头递给玩家或另一位角色，让讨论继续下去。不要重复已经说过的话，也不要等玩家发问。${antiRepeat}${
    args.previousContent ? `上一位的核心发言是："${args.previousContent.slice(0, 180)}"` : ""
  }`;
}

function buildAntiRepeatDirective(contents?: string[]) {
  const recent = contents
    ?.map((content) => content.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!recent || recent.length === 0) return "";
  return `近期公屏已经说过这些内容，请避开相同论点和相同开头，换一个证据、情绪或追问对象：${recent
    .map((content) => `"${content.slice(0, 90)}"`)
    .join(" / ")}。`;
}

function isNameMentioned(normalizedContent: string, name: string) {
  const normalizedName = normalize(name);
  if (!normalizedName) return false;
  return normalizedContent.includes(normalizedName);
}

function isDirectAddress(normalizedContent: string, name: string) {
  const normalizedName = normalize(name);
  if (!normalizedName || !normalizedContent.includes(normalizedName)) return false;
  const patterns = [
    `${normalizedName}你`,
    `${normalizedName}，`,
    `${normalizedName},`,
    `问${normalizedName}`,
    `请${normalizedName}`,
    `让${normalizedName}`,
    `${normalizedName}解释`,
    `${normalizedName}说`,
  ];
  return patterns.some((pattern) => normalizedContent.includes(pattern));
}

function normalize(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function stableIndex(seed: string, mod: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return mod > 0 ? hash % mod : 0;
}

function emptySignal(): DialogueSignal {
  return {
    mentionedCharacterIds: [],
    mentionedCharacterNames: [],
    addressedCharacterIds: [],
    addressedCharacterNames: [],
    asksQuestion: false,
    shouldInvitePlayer: false,
  };
}
