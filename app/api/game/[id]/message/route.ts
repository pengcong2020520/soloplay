import { NextRequest } from "next/server";
import { loadSession, getCurrentPhase, getPlayerCharacter } from "@/lib/game/session";
import { resolveUserId } from "@/lib/auth/current-user";
import { sseResponse } from "@/lib/sse";
import {
  saveMessage,
  streamCharacterTurn,
  streamDMTurn,
  runPublicGroupDiscussion,
} from "@/lib/game/turn";
import {
  analyzeDialogueTargets,
  buildResponderDirective,
  planPublicResponders,
} from "@/lib/game/conversation-director";
import {
  getSequentialCompletionDirective,
  isFreeDiscussionPhase,
  shouldAutoAdvanceAfterPlayerSpeech,
} from "@/lib/game/phase-flow";
import { emitPhaseAssessment, maybeAutoAdvancePhase } from "@/lib/game/phase-director";
import {
  ChannelType,
  SenderType,
  PlayerMode,
  PUBLIC_CHANNEL_KEY,
} from "@/lib/constants";

export const maxDuration = 120;

/**
 * 玩家在公共频道（或私聊频道）发送消息，
 * 服务端先落库玩家消息，再让相关 AI 角色流式回应。
 * Body: { channelType, channelKey, content }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const channelType: string = body.channelType ?? ChannelType.PUBLIC;
  const channelKey: string = body.channelKey ?? PUBLIC_CHANNEL_KEY;
  const content: string = (body.content ?? "").trim();

  const userId = await resolveUserId();
  const loaded = await loadSession(params.id, userId);
  if (!loaded) {
    return sseResponse(async (send) => {
      send({ type: "ERROR", message: "未找到会话" });
    });
  }
  const phase = getCurrentPhase(loaded);

  // 权限校验
  if (channelType === ChannelType.PUBLIC && !phase.permissions.publicChat) {
    return sseResponse(async (send) => {
      send({ type: "ERROR", message: `当前阶段「${phase.name}」尚未开放公共发言。` });
    });
  }
  if (channelType === ChannelType.PRIVATE && !phase.permissions.privateChat) {
    return sseResponse(async (send) => {
      send({ type: "ERROR", message: `当前阶段「${phase.name}」尚未开放私聊。` });
    });
  }
  if (!content) {
    return sseResponse(async (send) => {
      send({ type: "ERROR", message: "消息不能为空" });
    });
  }

  // 玩家发言人信息
  const playerSc = getPlayerCharacter(loaded);
  const playerName =
    loaded.playerMode === PlayerMode.ROLE_PLAY && playerSc
      ? playerSc.character.name
      : "侦探";

  return sseResponse(async (send) => {
    // 1. 落库玩家消息
    send({
      type: "AGENT_STATUS_CHANGED",
      agentId: "dm",
      agentName: "DM",
      status: "LISTENING",
      reason: "正在监听玩家公共发言",
    });
    const playerMsg = await saveMessage({
      sessionId: loaded.session.id,
      channelType,
      channelKey,
      senderType: SenderType.PLAYER,
      senderId: "player",
      senderName: playerName,
      content,
      phase: loaded.currentPhase,
      metadata: {
        dialogue: analyzeDialogueTargets(loaded, content, { speakerId: "player", includePlayer: false }),
      },
    });
    send({
      type: "MESSAGE_COMPLETE",
      messageId: playerMsg.id,
      fullContent: content,
      sender: { type: "PLAYER", id: "player", name: playerName },
      phase: loaded.currentPhase,
      channelKey,
      metadata: playerMsg.metadata ? safeObj(playerMsg.metadata) : undefined,
    });

    // 2. 决定哪些角色回应
    if (channelType === ChannelType.PRIVATE) {
      // 私聊：channelKey = player-<characterId>，回应方为该角色
      const otherId = channelKey
        .split("-")
        .find((id) => id !== "player");
      const target = loaded.sessionCharacters.find(
        (sc) => sc.character.id === otherId
      );
      if (target) {
        // 私聊指令：明确告知这是 1:1 密谈，必须针对玩家刚说的话作答，不要自说自话。
        const privateDirective = `（这是只有你和"${playerName}"两人的私下密谈，没有旁人在场。）${playerName}私下对你说："${content}"。请直接回应 ta 本人：针对 ta 刚才说的话作答，可以比公开场合更坦诚，也可以试探、反问、结盟或有所保留，但不要复述你的公开发言，也不要自言自语。`;
        await streamCharacterTurn(
          loaded,
          target.character,
          channelKey,
          ChannelType.PRIVATE,
          send,
          privateDirective
        );
      }
      return;
    }

    if (playerSc && shouldAutoAdvanceAfterPlayerSpeech(phase)) {
      await streamDMTurn(
        loaded,
        getSequentialCompletionDirective(phase, playerName),
        "GUIDE",
        send,
        { channelType: ChannelType.DM_BROADCAST }
      );
      if (loaded.currentPhase < loaded.phases.length - 1) {
        send({
          type: "PHASE_CHANGED",
          newPhase: loaded.currentPhase + 1,
          phaseName: "",
          dmAnnouncement: "__AUTO_NEXT__",
        });
      }
      return;
    }

    await emitPhaseAssessment(loaded, send);

    // 公共频道：挑选若干 AI 角色依次回应；非首位回应者会接着前面的话茬，让讨论热起来
    const plan = planPublicResponders(loaded, content, { fallbackSalt: "player-public" });
    const responders = plan.responders;
    let recentContents = [content];
    for (let i = 0; i < responders.length; i++) {
      const directive = buildResponderDirective({
        playerName,
        playerContent: content,
        responderName: responders[i].name,
        signal: plan.signal,
        isFirst: i === 0,
        recentContents,
      });
      const reply = await streamCharacterTurn(
        loaded,
        responders[i],
        PUBLIC_CHANNEL_KEY,
        ChannelType.PUBLIC,
        send,
        directive
      );
      recentContents = [reply, ...recentContents].slice(0, 5);
    }

    if (isFreeDiscussionPhase(phase) && responders.length > 0) {
      await runPublicGroupDiscussion(loaded, send, { turns: 1, topic: content.slice(0, 80) });
    }
    await maybeAutoAdvancePhase(loaded, send, { source: "PLAYER_MESSAGE" });
  });
}

function safeObj(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : undefined;
  } catch {
    return undefined;
  }
}
