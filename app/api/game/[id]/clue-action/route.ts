import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveUserId } from "@/lib/auth/current-user";
import { sseResponse } from "@/lib/sse";
import { loadSession, getCurrentPhase, getPlayerCharacter } from "@/lib/game/session";
import { saveMessage, streamCharacterTurn } from "@/lib/game/turn";
import { emitPhaseAssessment, maybeAutoAdvancePhase } from "@/lib/game/phase-director";
import {
  buildClueActionDto,
  buildClueMessageMetadata,
  buildCluePublicContent,
  buildClueResponderDirective,
  clueCardToDto,
  resolveClueResponders,
} from "@/lib/game/clue-director";
import { ChannelType, PlayerMode, PUBLIC_CHANNEL_KEY, SenderType } from "@/lib/constants";
import type { ClueActionType } from "@/types/game";

export const maxDuration = 120;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const clueId = String(body.clueId ?? "");
  const actionType = normalizeActionType(body.actionType);
  const targetCharacterId = typeof body.targetCharacterId === "string" ? body.targetCharacterId : undefined;
  const question = typeof body.question === "string" ? body.question.trim() : "";

  const userId = await resolveUserId();
  const loaded = await loadSession(params.id, userId);
  if (!loaded) {
    return sseResponse(async (send) => send({ type: "ERROR", message: "未找到会话" }));
  }

  const phase = getCurrentPhase(loaded);
  if (!phase.permissions.publicChat) {
    return sseResponse(async (send) =>
      send({ type: "ERROR", message: `当前阶段「${phase.name}」尚未开放公共举证。` })
    );
  }
  if (!clueId) {
    return sseResponse(async (send) => send({ type: "ERROR", message: "缺少线索卡。" }));
  }

  const release = await prisma.clueRelease.findFirst({
    where: { sessionId: params.id, clueCardId: clueId },
    include: { clueCard: true },
  });
  if (!release) {
    return sseResponse(async (send) =>
      send({ type: "ERROR", message: "这张线索尚未由 DM 发放，不能公开举证。" })
    );
  }

  const playerSc = getPlayerCharacter(loaded);
  const playerName =
    loaded.playerMode === PlayerMode.ROLE_PLAY && playerSc
      ? playerSc.character.name
      : "侦探";
  const targetCharacter =
    targetCharacterId
      ? loaded.sessionCharacters.find((sc) => sc.character.id === targetCharacterId)?.character ?? null
      : null;

  return sseResponse(async (send) => {
    send({
      type: "AGENT_STATUS_CHANGED",
      agentId: "dm",
      agentName: "DM",
      status: "LISTENING",
      reason: "正在记录线索举证",
    });

    const action = buildClueActionDto({
      actionType,
      actorType: "PLAYER",
      actorId: "player",
      actorName: playerName,
      clue: release.clueCard,
      targetCharacter,
      question,
    });
    const content = buildCluePublicContent({
      actorName: playerName,
      clue: release.clueCard,
      actionType,
      targetName: targetCharacter?.name,
      question,
    });

    const recentMessages = await prisma.message.findMany({
      where: {
        sessionId: params.id,
        phase: loaded.currentPhase,
        channelType: ChannelType.PUBLIC,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const saved = await saveMessage({
      sessionId: loaded.session.id,
      channelType: ChannelType.PUBLIC,
      channelKey: PUBLIC_CHANNEL_KEY,
      senderType: SenderType.PLAYER,
      senderId: "player",
      senderName: playerName,
      content,
      phase: loaded.currentPhase,
      metadata: buildClueMessageMetadata(action),
    });

    const metadata = saved.metadata ? parseMetadata(saved.metadata) : undefined;
    send({
      type: "MESSAGE_COMPLETE",
      messageId: saved.id,
      fullContent: content,
      sender: { type: "PLAYER", id: "player", name: playerName },
      phase: loaded.currentPhase,
      channelKey: PUBLIC_CHANNEL_KEY,
      metadata,
    });
    send({
      type: "CLUE_PLAYED",
      clueCard: clueCardToDto(release.clueCard),
      action,
      messageId: saved.id,
    });

    const responders = resolveClueResponders(loaded, targetCharacterId, actionType === "PLAYER_QUESTION_CHARACTER" ? 2 : 2);
    responders.forEach((character) =>
      send({
        type: "AGENT_STATUS_CHANGED",
        agentId: character.id,
        agentName: character.name,
        status: "PLANNED",
        reason: targetCharacterId === character.id ? "被线索质询，准备回应" : "准备围绕线索接话",
      })
    );

    let recentContents = recentMessages.map((message) => message.content);
    for (let i = 0; i < responders.length; i++) {
      const responder = responders[i];
      const reply = await streamCharacterTurn(
        loaded,
        responder,
        PUBLIC_CHANNEL_KEY,
        ChannelType.PUBLIC,
        send,
        buildClueResponderDirective({
          playerName,
          actorName: playerName,
          clue: release.clueCard,
          actionType,
          responderName: responder.name,
          targetName: targetCharacter?.name,
          question,
          isTarget: responder.id === targetCharacterId,
          isFirst: i === 0,
          recentContents,
        })
      );
      recentContents = [reply, ...recentContents].slice(0, 5);
    }

    await emitPhaseAssessment(loaded, send);
    await maybeAutoAdvancePhase(loaded, send, { source: "PLAYER_MESSAGE" });
  });
}

function normalizeActionType(value: unknown): ClueActionType {
  return value === "PLAYER_QUESTION_CHARACTER"
    ? "PLAYER_QUESTION_CHARACTER"
    : "PLAYER_SHOW_PUBLIC";
}

function parseMetadata(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : undefined;
  } catch {
    return undefined;
  }
}
