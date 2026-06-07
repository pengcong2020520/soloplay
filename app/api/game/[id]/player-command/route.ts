import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadSession, getCurrentPhase } from "@/lib/game/session";
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
} from "@/lib/constants";

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
            data: { sessionId: params.id, clueCardId: pending.id, phase: updated.currentPhase },
          });
          await saveMessage({
            sessionId: params.id,
            channelType: ChannelType.DM_BROADCAST,
            channelKey: PUBLIC_CHANNEL_KEY,
            senderType: SenderType.DM,
            senderId: "dm",
            senderName: "DM",
            content: `【DM】（为你额外释放一条线索）【${pending.title}】：${pending.content}`,
            phase: updated.currentPhase,
            metadata: { clueId: pending.id },
          });
          send({
            type: "CLUE_RELEASED",
            clueCard: {
              id: pending.id,
              title: pending.title,
              content: pending.content,
              clueType: pending.clueType as any,
            },
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
        // 让在场 AI 角色在公共频道彼此你来我往地讨论一轮（玩家围观，可随时插话）
        await runPublicGroupDiscussion(loaded, send, { turns: 3 });
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
