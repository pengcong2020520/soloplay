import { prisma } from "@/lib/db/prisma";
import { ChannelType, SenderType } from "@/lib/constants";
import type {
  ConsensusState,
  GameEvent,
  PhaseAssessmentStatus,
  PhaseChecklistItem,
} from "@/types/game";
import type { LoadedSession } from "@/lib/game/session";
import { getCurrentPhase, getPlayerCharacter } from "@/lib/game/session";
import { isFreeDiscussionPhase, isSequentialCharacterPhase } from "@/lib/game/phase-flow";
import { streamDMTurn } from "@/lib/game/turn";

export interface PhaseAssessment {
  status: PhaseAssessmentStatus;
  summary: string;
  checklist: PhaseChecklistItem[];
  focusTopic?: string;
  consensus?: ConsensusState;
}

export async function assessPhaseProgress(loaded: LoadedSession): Promise<PhaseAssessment> {
  const phase = getCurrentPhase(loaded);
  const playerSc = getPlayerCharacter(loaded);

  const [phaseMessages, clueReleases] = await Promise.all([
    prisma.message.findMany({
      where: {
        sessionId: loaded.session.id,
        phase: loaded.currentPhase,
        channelType: { in: [ChannelType.PUBLIC, ChannelType.DM_BROADCAST, ChannelType.DM_HINT] },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.clueRelease.count({
      where: { sessionId: loaded.session.id, phase: loaded.currentPhase },
    }),
  ]);
  const publicMessages = phaseMessages.filter((message) => message.channelType === ChannelType.PUBLIC).length;
  const aiMessages = phaseMessages.filter(
    (message) => message.channelType === ChannelType.PUBLIC && message.senderType === SenderType.AI_CHARACTER
  ).length;
  const playerMessages = phaseMessages.filter(
    (message) => message.channelType === ChannelType.PUBLIC && message.senderType === SenderType.PLAYER
  ).length;
  const metadata = phaseMessages
    .map((message) => parseMetadata(message.metadata))
    .filter((item): item is Record<string, any> => Boolean(item));
  const clueActions = metadata
    .map((item) => item.clueAction)
    .filter((item): item is Record<string, any> => Boolean(item));
  const phaseConclusion = findLatestMetadata(metadata, "phaseConclusion");
  const noConsensus = findLatestMetadata(metadata, "noConsensus");
  const consensus = buildConsensusState({
    phaseName: phase.name,
    clueActions,
    phaseConclusion,
    noConsensus,
    messages: phaseMessages.map((message) => message.content),
  });

  if (playerSc && isSequentialCharacterPhase(phase)) {
    const checklist = [
      { label: "AI 角色已依次发言", done: aiMessages > 0 },
      { label: `等待 ${playerSc.character.name} 完成本阶段发言`, done: playerMessages > 0 },
    ];
    return {
      status: playerMessages > 0 ? "CAN_CLOSE" : "WAITING_PLAYER",
      summary: playerMessages > 0 ? "本阶段玩家发言已完成，DM 可收束进入下一环节。" : `轮到 ${playerSc.character.name} 发言。`,
      checklist,
      focusTopic: phase.name,
      consensus,
    };
  }

  if (!phase.permissions.publicChat || loaded.currentPhase >= loaded.phases.length - 1) {
    return {
      status: "RUNNING",
      summary: `当前处于「${phase.name}」，DM 正在监听必要操作。`,
      checklist: [{ label: "等待阶段必要操作", done: false }],
      focusTopic: phase.name,
      consensus,
    };
  }

  const cluePhase = phase.name.includes("搜证") || phase.permissions.clueInspection || phase.dmTriggers.some((t) => t.type === "RELEASE_CLUE");
  const interrogationPhase = phase.name.includes("质询") || phase.name.includes("讨论") || isFreeDiscussionPhase(phase);
  const needsConvergence = cluePhase || interrogationPhase || phase.name.includes("推理");
  const hasCluePool = clueReleases > 0 || loaded.state.releasedClueIds.length > 0;
  const hasEvidenceAction = clueActions.length > 0;
  const hasPlayerConclusion = Boolean(phaseConclusion?.conclusion);
  const hasNoConsensusMark = Boolean(noConsensus?.reason || noConsensus?.disputedPoints);
  const checklist: PhaseChecklistItem[] = [
    { label: "玩家已参与本阶段讨论", done: playerMessages > 0 },
    { label: "至少 2 位 Agent 已回应", done: aiMessages >= 2 },
  ];
  if (cluePhase) {
    checklist.push({ label: "本阶段线索已进入牌堆", done: clueReleases > 0 || loaded.state.releasedClueIds.length > 0 });
    if (hasCluePool) {
      checklist.push({ label: "至少一次线索举证或质询", done: hasEvidenceAction });
    }
  }
  if (interrogationPhase) {
    checklist.push({ label: "公共讨论已经形成一轮交锋", done: publicMessages >= 5 });
  }
  if (needsConvergence) {
    checklist.push({
      label: "玩家已提交阶段结论或标记暂未达成共识",
      done: hasPlayerConclusion || hasNoConsensusMark,
    });
  }

  const doneCount = checklist.filter((item) => item.done).length;
  const canClose = checklist.length > 0 && doneCount === checklist.length && aiMessages >= 2;
  const waitingPlayer = playerMessages === 0 && aiMessages >= 2;
  const needsEvidence = cluePhase && hasCluePool && !hasEvidenceAction;
  const needsConsensusCheck = needsConvergence && !hasPlayerConclusion && !hasNoConsensusMark && !needsEvidence && doneCount >= Math.max(2, checklist.length - 1);

  const status: PhaseAssessmentStatus =
    canClose
      ? "CAN_CLOSE"
      : needsEvidence
      ? "EVIDENCE_NEEDED"
      : needsConsensusCheck
      ? "CONSENSUS_CHECK"
      : hasNoConsensusMark
      ? "NO_CONSENSUS"
      : waitingPlayer
      ? "WAITING_PLAYER"
      : "RUNNING";

  return {
    status,
    summary: status === "CAN_CLOSE"
      ? `「${phase.name}」的核心讨论已完成，DM 可以收束。`
      : status === "EVIDENCE_NEEDED"
      ? "线索已进入牌堆，但还没有被正式举证或质询。"
      : status === "CONSENSUS_CHECK"
      ? "讨论已接近收束，请玩家提交阶段结论，或标记暂未达成共识。"
      : status === "NO_CONSENSUS"
      ? "当前分歧已被标记，DM 将围绕分歧继续引导。"
      : waitingPlayer
      ? "Agent 已经抛出话题，等待玩家回应或展示线索。"
      : `DM 正在监听「${phase.name}」的讨论进度。`,
    checklist,
    focusTopic: inferFocusTopicFromPhase(phase.name),
    consensus,
  };
}

export async function emitPhaseAssessment(
  loaded: LoadedSession,
  send: (event: GameEvent) => void
): Promise<PhaseAssessment> {
  const assessment = await assessPhaseProgress(loaded);
  send({
    type: "DM_PHASE_ASSESSMENT",
    status: assessment.status,
    summary: assessment.summary,
    checklist: assessment.checklist,
    focusTopic: assessment.focusTopic,
    consensus: assessment.consensus,
  });
  return assessment;
}

export async function maybeAutoAdvancePhase(
  loaded: LoadedSession,
  send: (event: GameEvent) => void,
  opts: { source?: "AUTO_DISCUSSION" | "PLAYER_MESSAGE" | "MANUAL_DISCUSSION" } = {}
): Promise<boolean> {
  const phase = getCurrentPhase(loaded);
  if (isSequentialCharacterPhase(phase)) return false;
  if (!phase.permissions.publicChat) return false;
  if (loaded.currentPhase >= loaded.phases.length - 1) return false;
  if (phase.name.includes("投票") || phase.name.includes("复盘") || phase.name.includes("揭秘")) return false;

  const assessment = await emitPhaseAssessment(loaded, send);
  if (assessment.status !== "CAN_CLOSE") return false;

  const sourceHint =
    opts.source === "AUTO_DISCUSSION"
      ? "公共讨论已经形成足够交锋。"
      : "玩家与角色的关键讨论已经完成。";
  await streamDMTurn(
    loaded,
    `${sourceHint}请作为 DM 用 1-2 句收束当前阶段，不剧透真相，说明即将进入下一阶段。`,
    "GUIDE",
    send
  );
  send({
    type: "DM_PHASE_ASSESSMENT",
    status: "CLOSING",
    summary: "DM 正在收束当前阶段，准备进入下一阶段。",
    checklist: assessment.checklist,
    focusTopic: assessment.focusTopic,
    consensus: assessment.consensus,
  });
  send({
    type: "PHASE_CHANGED",
    newPhase: loaded.currentPhase + 1,
    phaseName: "",
    dmAnnouncement: "__AUTO_NEXT__",
  });
  return true;
}

function buildConsensusState(args: {
  phaseName: string;
  clueActions: Record<string, any>[];
  phaseConclusion?: Record<string, any>;
  noConsensus?: Record<string, any>;
  messages: string[];
}): ConsensusState {
  const playerConclusion = stringValue(args.phaseConclusion?.conclusion);
  const clueTitles = unique(
    args.clueActions
      .map((action) => stringValue(action?.clue?.title))
      .filter(Boolean)
  );
  const agreedPoints: string[] = [];
  if (clueTitles.length) {
    agreedPoints.push(`已围绕 ${clueTitles.map((title) => `《${title}》`).join("、")} 完成举证`);
  }
  if (playerConclusion) {
    agreedPoints.push(`玩家阶段结论：${playerConclusion}`);
  }

  const disputedPoints = Array.isArray(args.noConsensus?.disputedPoints)
    ? args.noConsensus.disputedPoints.map((item: unknown) => String(item).trim()).filter(Boolean)
    : [];
  const noConsensusReason = stringValue(args.noConsensus?.reason);
  if (noConsensusReason && !disputedPoints.includes(noConsensusReason)) {
    disputedPoints.push(noConsensusReason);
  }
  if (!disputedPoints.length && args.messages.some((message) => /矛盾|反驳|不合理|说不通|怀疑|撒谎|解释/.test(message))) {
    disputedPoints.push("角色说法仍存在冲突，需要继续核查。");
  }

  const openQuestions: string[] = [];
  if (!args.clueActions.length) {
    openQuestions.push("是否需要打出一张线索卡来支撑判断");
  }
  if (!playerConclusion && !args.noConsensus) {
    openQuestions.push("玩家是否认可当前讨论方向，或需要标记暂未达成共识");
  }
  if (disputedPoints.length) {
    openQuestions.push("分歧点是否需要指定角色继续解释");
  }

  let status: ConsensusState["status"] = "NONE";
  if (args.noConsensus) status = "NO_CONSENSUS";
  else if (playerConclusion && disputedPoints.length === 0) status = "AGREED";
  else if (disputedPoints.length) status = "DISPUTED";
  else if (clueTitles.length || agreedPoints.length) status = "EMERGING";

  return {
    status,
    agreedPoints,
    disputedPoints,
    openQuestions: unique(openQuestions),
    playerConclusion: playerConclusion || undefined,
    lastCheckedAt: new Date().toISOString(),
  };
}

function parseMetadata(value: string | null): Record<string, any> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : null;
  } catch {
    return null;
  }
}

function findLatestMetadata(metadata: Record<string, any>[], key: string): Record<string, any> | undefined {
  for (let i = metadata.length - 1; i >= 0; i--) {
    const value = metadata[i][key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
  }
  return undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function inferFocusTopicFromPhase(phaseName: string) {
  if (phaseName.includes("搜证")) return "线索与证据";
  if (phaseName.includes("质询")) return "公开质询";
  if (phaseName.includes("交流") || phaseName.includes("讨论")) return "公共讨论";
  if (phaseName.includes("陈词")) return "立场陈述";
  return phaseName;
}
