import { ChannelType, PUBLIC_CHANNEL_KEY, SenderType } from "@/lib/constants";
import { getAiCharacters } from "@/lib/game/session";
import type { LoadedSession } from "@/lib/game/session";
import type { Character } from "@prisma/client";
import type { ClueActionDTO, ClueActionType, ClueCardDTO } from "@/types/game";

export type ClueCardLike = {
  id: string;
  title: string;
  content: string;
  clueType: string;
  imageUrl?: string | null;
  mediaType?: string | null;
  videoUrl?: string | null;
  visualBatchId?: string | null;
  sequenceIndex?: number | null;
};

export function clueCardToDto(clue: ClueCardLike): ClueCardDTO {
  return {
    id: clue.id,
    title: clue.title,
    content: clue.content,
    clueType: clue.clueType as any,
    imageUrl: clue.imageUrl ?? null,
    mediaType: normalizeMediaType(clue.mediaType),
    videoUrl: clue.videoUrl ?? null,
    visualBatchId: clue.visualBatchId ?? null,
    sequenceIndex: clue.sequenceIndex ?? null,
  };
}

export function buildCluePublicContent(args: {
  actorName: string;
  clue: ClueCardLike;
  actionType: ClueActionType;
  targetName?: string;
  question?: string;
}) {
  const prefix =
    args.actionType === "PLAYER_QUESTION_CHARACTER" || args.actionType === "AGENT_QUESTION_CHARACTER"
      ? `${args.actorName}打出线索《${args.clue.title}》，质询${args.targetName ?? "相关角色"}`
      : `${args.actorName}打出线索《${args.clue.title}》`;
  const question = args.question?.trim()
    ? `\n质询：${args.question.trim()}`
    : "";
  return `${prefix}。\n线索要点：${summarizeClue(args.clue.content)}${question}`;
}

export function buildClueActionDto(args: {
  actionType: ClueActionType;
  actorType: ClueActionDTO["actorType"];
  actorId: string;
  actorName: string;
  clue: ClueCardLike;
  targetCharacter?: Character | null;
  question?: string;
  visibility?: ClueActionDTO["visibility"];
}): ClueActionDTO {
  return {
    actionType: args.actionType,
    actorType: args.actorType,
    actorId: args.actorId,
    actorName: args.actorName,
    targetCharacterId: args.targetCharacter?.id,
    targetCharacterName: args.targetCharacter?.name,
    question: args.question?.trim() || undefined,
    visibility: args.visibility ?? "PUBLIC",
    clue: clueCardToDto(args.clue),
  };
}

export function buildClueMessageMetadata(action: ClueActionDTO) {
  return {
    clueAction: action,
    phaseEvent: {
      kind: "EVIDENCE",
      clueId: action.clue.id,
      actionType: action.actionType,
      targetCharacterId: action.targetCharacterId,
      at: new Date().toISOString(),
    },
  };
}

export function resolveClueResponders(
  loaded: LoadedSession,
  targetCharacterId?: string | null,
  maxSpeakers = 2
): Character[] {
  const ai = getAiCharacters(loaded).map((sc) => sc.character);
  if (ai.length === 0) return [];
  const responders: Character[] = [];
  const target = targetCharacterId ? ai.find((character) => character.id === targetCharacterId) : null;
  if (target) responders.push(target);
  for (const character of ai) {
    if (responders.length >= maxSpeakers) break;
    if (!responders.some((r) => r.id === character.id)) responders.push(character);
  }
  return responders;
}

export function buildClueResponderDirective(args: {
  playerName: string;
  clue: ClueCardLike;
  actionType: ClueActionType;
  actorName: string;
  responderName: string;
  targetName?: string;
  question?: string;
  isTarget: boolean;
  isFirst: boolean;
  recentContents?: string[];
}) {
  const targetLine = args.isTarget
    ? "这张线索正在质询你，请先正面回应线索与质询，不要转移话题。"
    : args.targetName
    ? `这张线索正在质询${args.targetName}，你可以补充证据、追问或判断 ta 的回应是否可信。`
    : "这张线索被公开展示，你需要围绕它推进案情，而不是泛泛聊天。";
  const questionLine = args.question?.trim() ? `质询问题是：「${args.question.trim()}」。` : "";
  const recentLine = args.recentContents?.length
    ? `近期公屏已有观点：${args.recentContents
        .filter(Boolean)
        .slice(0, 3)
        .map((item) => `「${item.replace(/\s+/g, " ").slice(0, 80)}」`)
        .join(" / ")}。请避开相同句式和相同论点。`
    : "";
  const stance = args.isFirst
    ? "先抓住线索里最能刺痛你或最能推进案情的一点。"
    : "接住前一位角色的话，给出新的判断、反驳或具体追问。";
  return [
    `${args.actorName}刚刚在公屏打出线索《${args.clue.title}》。`,
    `线索内容：${args.clue.content}`,
    targetLine,
    questionLine,
    stance,
    "必须以角色本人身份自然发言；可以犹豫、辩解、反问、压低声音承认一部分，但不要像 AI 总结，不要复述整张线索。",
    recentLine,
  ].filter(Boolean).join("");
}

export function buildDmClueReleaseMetadata(clue: ClueCardLike, reason?: string) {
  const action = buildClueActionDto({
    actionType: "DM_RELEASE",
    actorType: "DM",
    actorId: "dm",
    actorName: "DM",
    clue,
  });
  return {
    clueId: clue.id,
    clueRelease: {
      action,
      reason,
      channelKey: PUBLIC_CHANNEL_KEY,
      channelType: ChannelType.DM_BROADCAST,
      senderType: SenderType.DM,
    },
  };
}

function summarizeClue(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 90 ? `${compact.slice(0, 88)}…` : compact;
}

function normalizeMediaType(value?: string | null): ClueCardDTO["mediaType"] {
  if (value === "video" || value === "none") return value;
  return "image";
}
