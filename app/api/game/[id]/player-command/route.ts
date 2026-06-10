import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadSession, getCurrentPhase, getPlayerCharacter } from "@/lib/game/session";
import type { LoadedSession } from "@/lib/game/session";
import { resolveUserId } from "@/lib/auth/current-user";
import { sseResponse } from "@/lib/sse";
import {
  saveMessage,
  streamCharacterTurn,
  streamDMTurn,
  runPublicGroupDiscussion,
} from "@/lib/game/turn";
import {
  ChannelType,
  SenderType,
  PlayerCommand,
  GameStatus,
  PUBLIC_CHANNEL_KEY,
  PlayerMode,
} from "@/lib/constants";
import { isSequentialCharacterPhase } from "@/lib/game/phase-flow";
import { assessPhaseProgress, emitPhaseAssessment, maybeAutoAdvancePhase } from "@/lib/game/phase-director";
import { buildDmClueReleaseMetadata, clueCardToDto } from "@/lib/game/clue-director";
import type { ConsensusState } from "@/types/game";

export const maxDuration = 120;

/**
 * 玩家节奏控制指令。
 * Body: { command, params? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const command: string = body.command;
  const cmdParams = body.params ?? {};

  const userId = await resolveUserId();
  const loaded = await loadSession(params.id, userId);
  if (!loaded) {
    return sseResponse(async (send) => send({ type: "ERROR", message: "未找到会话" }));
  }
  const phase = getCurrentPhase(loaded);

  // PAUSE / RESUME 不需要 SSE 流，直接处理（但为统一前端，仍走 SSE）
  return sseResponse(async (send) => {
    switch (command) {
      case PlayerCommand.HINT: {
        await prisma.gameSession.update({
          where: { id: params.id },
          data: { hintsUsed: { increment: 1 } },
        });
        const updated = (await loadSession(params.id))!;
        await streamDMTurn(
          updated,
          "玩家请求提示。请给出 1~2 个引导性问句，绝不直接透露凶手或答案。",
          "HINT",
          send,
          { channelType: ChannelType.DM_HINT }
        );
        break;
      }
      case PlayerCommand.RECAP: {
        await streamDMTurn(
          loaded,
          "玩家有点出戏，请用旁白形式简短回顾当前剧情状态与当前阶段目标。",
          "RECAP",
          send,
          { channelType: ChannelType.DM_HINT }
        );
        break;
      }
      case PlayerCommand.LOWER_DIFFICULTY: {
        await prisma.gameSession.update({
          where: { id: params.id },
          data: { difficultyAdjusted: true },
        });
        const updated = (await loadSession(params.id))!;
        // 额外发布一条本阶段尚未发布的线索（含隐藏线索）作为帮助
        const pending = await prisma.clueCard.findFirst({
          where: {
            scriptId: updated.script.id,
            id: { notIn: updated.state.releasedClueIds.length ? updated.state.releasedClueIds : ["__none__"] },
          },
          orderBy: { releasePhase: "asc" },
        });
        if (pending) {
          await prisma.clueRelease.create({
            data: {
              sessionId: params.id,
              clueCardId: pending.id,
              phase: updated.currentPhase,
              releasedBy: "DM",
              releaseReason: "玩家降低难度后额外释放",
            },
          });
          await saveMessage({
            sessionId: params.id,
            channelType: ChannelType.DM_BROADCAST,
            channelKey: PUBLIC_CHANNEL_KEY,
            senderType: SenderType.DM,
            senderId: "dm",
            senderName: "DM",
            content: `【DM】额外发放线索卡《${pending.title}》。线索已沉淀到右侧牌堆，可用于举证或质询。`,
            phase: updated.currentPhase,
            metadata: buildDmClueReleaseMetadata(pending, "玩家降低难度后额外释放"),
          });
          send({
            type: "CLUE_RELEASED",
            clueCard: clueCardToDto(pending),
            dmDescription: "",
          });
        }
        await streamDMTurn(
          updated,
          "玩家觉得太难。请安抚玩家，说明你已加快线索释放，并给一个温和的方向性提示。",
          "GUIDE",
          send,
          { channelType: ChannelType.DM_HINT }
        );
        break;
      }
      case PlayerCommand.FOCUS_CHARACTER: {
        const targetName: string | undefined = cmdParams.characterName;
        const target = loaded.sessionCharacters.find(
          (sc) => sc.character.name === targetName && sc.assignedTo === "AI"
        );
        if (!target) {
          send({ type: "ERROR", message: "未找到该角色或该角色不可接触。" });
          return;
        }
        if (!phase.permissions.privateChat) {
          // 当前阶段不开放私聊，则让角色在公共频道主动找玩家
          await streamCharacterTurn(
            loaded,
            target.character,
            PUBLIC_CHANNEL_KEY,
            ChannelType.PUBLIC,
            send,
            "玩家想多了解你，请你主动向大家（尤其是玩家）多透露一点你愿意分享的背景。"
          );
        } else {
          send({ type: "PRIVATE_CHAT_INDICATOR", participants: ["player", target.character.id] });
          send({
            type: "DM_HINT",
            content: `【DM】${target.character.name}愿意与你单独聊聊，已为你开启私聊。`,
          });
        }
        break;
      }
      case PlayerCommand.GROUP_DISCUSS: {
        if (!phase.permissions.publicChat) {
          send({ type: "ERROR", message: "当前阶段尚未开放公共讨论。" });
          return;
        }
        if (isSequentialCharacterPhase(phase)) {
          send({ type: "ERROR", message: "当前是顺序发言阶段，请先完成本阶段发言，DM 会自动推进。" });
          return;
        }
        send({
          type: "DISCUSSION_MODE_CHANGED",
          enabled: true,
          reason: cmdParams.auto ? "自动讨论继续推进" : "玩家请求大家讨论",
        });
        await emitPhaseAssessment(loaded, send);
        // 让在场 AI 角色在公共频道彼此你来我往地讨论一轮（玩家围观，可随时插话）
        await runPublicGroupDiscussion(loaded, send, { turns: 3 });
        await maybeAutoAdvancePhase(loaded, send, {
          source: cmdParams.auto ? "AUTO_DISCUSSION" : "MANUAL_DISCUSSION",
        });
        break;
      }
      case PlayerCommand.REQUEST_CONSENSUS: {
        const assessment = await assessPhaseProgress(loaded);
        const consensus = assessment.consensus;
        const content = consensus
          ? buildConsensusCheckText(consensus)
          : "【DM】当前还没有形成稳定共识。请先围绕已公开线索继续举证或质询。";
        const saved = await saveMessage({
          sessionId: params.id,
          channelType: ChannelType.DM_HINT,
          channelKey: PUBLIC_CHANNEL_KEY,
          senderType: SenderType.DM,
          senderId: "dm",
          senderName: "DM",
          content,
          phase: loaded.currentPhase,
          metadata: { consensusCheck: consensus, dmAction: "CONSENSUS_CHECK" },
        });
        send({
          type: "MESSAGE_COMPLETE",
          messageId: saved.id,
          fullContent: content,
          sender: { type: "DM", id: "dm", name: "DM" },
          phase: loaded.currentPhase,
          channelKey: PUBLIC_CHANNEL_KEY,
          metadata: saved.metadata ? safeObj(saved.metadata) : undefined,
        });
        await emitPhaseAssessment(loaded, send);
        break;
      }
      case PlayerCommand.SUBMIT_PHASE_CONCLUSION: {
        const conclusion = String(cmdParams.conclusion ?? "").trim();
        if (!conclusion) {
          send({ type: "ERROR", message: "请先写下你希望提交的阶段结论。" });
          return;
        }
        const playerName = getPlayerDisplayName(loaded);
        const saved = await saveMessage({
          sessionId: params.id,
          channelType: ChannelType.PUBLIC,
          channelKey: PUBLIC_CHANNEL_KEY,
          senderType: SenderType.PLAYER,
          senderId: "player",
          senderName: playerName,
          content: `【阶段结论】${conclusion}`,
          phase: loaded.currentPhase,
          metadata: {
            phaseConclusion: {
              conclusion,
              submittedAt: new Date().toISOString(),
            },
          },
        });
        send({
          type: "MESSAGE_COMPLETE",
          messageId: saved.id,
          fullContent: saved.content,
          sender: { type: "PLAYER", id: "player", name: playerName },
          phase: loaded.currentPhase,
          channelKey: PUBLIC_CHANNEL_KEY,
          metadata: saved.metadata ? safeObj(saved.metadata) : undefined,
        });
        const advanced = await maybeAutoAdvancePhase(loaded, send, { source: "PLAYER_MESSAGE" });
        if (!advanced) {
          await streamDMTurn(
            loaded,
            `玩家提交了阶段结论：「${conclusion}」。请作为 DM 判断这个结论是否足以收束本阶段：肯定已达成的共识，点出仍需保留的悬念，并明确还差哪一步操作。`,
            "GUIDE",
            send
          );
          await emitPhaseAssessment(loaded, send);
        }
        break;
      }
      case PlayerCommand.MARK_NO_CONSENSUS: {
        const reason = String(cmdParams.reason ?? "").trim() || "目前大家还没有形成一致结论。";
        const disputedPoints = Array.isArray(cmdParams.disputedPoints)
          ? cmdParams.disputedPoints.map((item: unknown) => String(item).trim()).filter(Boolean)
          : [reason];
        const playerName = getPlayerDisplayName(loaded);
        const saved = await saveMessage({
          sessionId: params.id,
          channelType: ChannelType.PUBLIC,
          channelKey: PUBLIC_CHANNEL_KEY,
          senderType: SenderType.PLAYER,
          senderId: "player",
          senderName: playerName,
          content: `【暂未达成共识】${reason}`,
          phase: loaded.currentPhase,
          metadata: {
            noConsensus: {
              reason,
              disputedPoints,
              markedAt: new Date().toISOString(),
            },
          },
        });
        send({
          type: "MESSAGE_COMPLETE",
          messageId: saved.id,
          fullContent: saved.content,
          sender: { type: "PLAYER", id: "player", name: playerName },
          phase: loaded.currentPhase,
          channelKey: PUBLIC_CHANNEL_KEY,
          metadata: saved.metadata ? safeObj(saved.metadata) : undefined,
        });
        await streamDMTurn(
          loaded,
          `玩家标记本阶段暂未达成共识，原因是：「${reason}」。请作为 DM 梳理当前最大分歧，给出下一步最值得验证的一张线索或一个角色，不要强行推进。`,
          "GUIDE",
          send
        );
        await emitPhaseAssessment(loaded, send);
        break;
      }
      case PlayerCommand.REQUEST_DM_CLOSE: {
        const advanced = await maybeAutoAdvancePhase(loaded, send, { source: "PLAYER_MESSAGE" });
        if (!advanced) {
          await streamDMTurn(
            loaded,
            "玩家请求 DM 收束本阶段。请检查当前共识、分歧和已举证线索；如果还不能结束，明确告诉玩家还差哪一步操作。",
            "GUIDE",
            send
          );
          await emitPhaseAssessment(loaded, send);
        }
        break;
      }
      case PlayerCommand.SKIP_PHASE: {
        if (phase.playerPaceControl && !phase.playerPaceControl.canSkipPhase) {
          send({ type: "ERROR", message: "当前阶段不可跳过。" });
          return;
        }
        send({ type: "DM_HINT", content: "【DM】好的，我们直接进入下一阶段。" });
        // 前端收到后会调用 next-phase
        send({ type: "PHASE_CHANGED", newPhase: loaded.currentPhase + 1, phaseName: "", dmAnnouncement: "__SKIP__" });
        break;
      }
      case "PAUSE": {
        await prisma.gameSession.update({
          where: { id: params.id },
          data: { status: GameStatus.PAUSED, pausedAt: new Date() },
        });
        send({ type: "DM_HINT", content: "【DM】游戏已暂停，所有角色进入待机。下次进入将原样恢复。" });
        break;
      }
      case "RESUME": {
        await prisma.gameSession.update({
          where: { id: params.id },
          data: { status: GameStatus.IN_PROGRESS, pausedAt: null },
        });
        send({ type: "DM_HINT", content: "【DM】游戏继续。" });
        break;
      }
      default:
        send({ type: "ERROR", message: "未知指令：" + command });
    }
  });
}

function getPlayerDisplayName(loaded: LoadedSession) {
  const playerSc = getPlayerCharacter(loaded);
  return loaded?.playerMode === PlayerMode.ROLE_PLAY && playerSc
    ? playerSc.character.name
    : "侦探";
}

function buildConsensusCheckText(consensus: ConsensusState) {
  const agreed = consensus.agreedPoints.length ? consensus.agreedPoints.join("；") : "暂未形成明确共识";
  const disputed = consensus.disputedPoints.length ? consensus.disputedPoints.join("；") : "主要分歧暂不明显";
  const open = consensus.openQuestions.length ? consensus.openQuestions.join("；") : "暂无新的待核查问题";
  return `【DM 共识检查】已形成：${agreed}\n仍有分歧：${disputed}\n待核查：${open}`;
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
