import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadSession, getAiCharacters, getPlayerCharacter, getCurrentPhase } from "@/lib/game/session";
import { resolveUserId } from "@/lib/auth/current-user";
import { sseResponse } from "@/lib/sse";
import {
  saveMessage,
  streamCharacterTurn,
  streamDMTurn,
  runPublicGroupDiscussion,
} from "@/lib/game/turn";
import {
  getSequentialPlayerPrompt,
  isFreeDiscussionPhase,
  isSequentialCharacterPhase,
} from "@/lib/game/phase-flow";
import { refreshPhaseSummaries } from "@/lib/agents/summarizer";
import {
  triggerPhaseMechanics,
  triggerCharToCharGossip,
  runPhaseJudgment,
} from "@/lib/game/mechanics";
import {
  ChannelType,
  SenderType,
  GameStatus,
  PUBLIC_CHANNEL_KEY,
} from "@/lib/constants";
import { buildDmClueReleaseMetadata, clueCardToDto } from "@/lib/game/clue-director";

export const maxDuration = 120;

/**
 * DM 推进到下一阶段：
 * - 更新 currentPhase
 * - DM 广播阶段进入宣告（流式）
 * - 若新阶段有 RELEASE_CLUE 触发，发布对应 releasePhase 的线索卡
 * - 若新阶段是自我介绍/最终陈词，顺序点名 AI 角色发言
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await resolveUserId();
  const loaded = await loadSession(params.id, userId);
  if (!loaded) {
    return sseResponse(async (send) => send({ type: "ERROR", message: "未找到会话" }));
  }
  const currentPhase = getCurrentPhase(loaded);
  const playerSc = getPlayerCharacter(loaded);
  if (playerSc && isSequentialCharacterPhase(currentPhase)) {
    const playerSpoke = await prisma.message.findFirst({
      where: {
        sessionId: params.id,
        phase: loaded.currentPhase,
        channelType: ChannelType.PUBLIC,
        senderType: SenderType.PLAYER,
      },
      select: { id: true },
    });
    if (!playerSpoke) {
      return sseResponse(async (send) =>
        send({
          type: "ERROR",
          message: "当前是顺序发言阶段，请先完成你的发言。DM 会在全员发言后自动进入下一环节。",
        })
      );
    }
  }

  const nextPhaseIdx = Math.min(loaded.currentPhase + 1, loaded.phases.length - 1);
  if (nextPhaseIdx === loaded.currentPhase) {
    return sseResponse(async (send) =>
      send({ type: "ERROR", message: "已经是最后一个阶段了。" })
    );
  }

  return sseResponse(async (send) => {
    // 1. 更新阶段（CAS 幂等：仅当 DB 当前阶段仍等于触发时的值才推进，
    //    防止前端倒计时 timer、手动点击、SKIP 三者并发重复推进。）
    const cas = await prisma.gameSession.updateMany({
      where: { id: params.id, currentPhase: loaded.currentPhase },
      data: {
        currentPhase: nextPhaseIdx,
        phaseStartedAt: new Date(),
        phaseHistory: JSON.stringify([
          ...((loaded.session.phaseHistory &&
            safeArr(loaded.session.phaseHistory)) ||
            []),
          { phase: nextPhaseIdx, at: new Date().toISOString() },
        ]),
      },
    });

    if (cas.count === 0) {
      // 已被其他请求推进过，本次直接收尾，不重复宣告/发线索/点名
      send({ type: "ERROR", message: "阶段已推进，无需重复操作。" });
      return;
    }

    // reload with new phase index
    const reloaded = await loadSession(params.id);
    if (!reloaded) {
      send({ type: "ERROR", message: "重新加载会话失败" });
      return;
    }

    // 1.5 阶段边界压缩：为每个 AI 角色刷新滚动摘要（信息隔离 + 失败静默，见 summarizer.ts）。
    //     压缩的是刚结束阶段累积的对话，供新阶段发言时保持前后一致并降低 token 成本。
    await refreshPhaseSummaries(reloaded);
    // 摘要写入了 agentContext，重新加载以让后续所有发言读到最新摘要
    const updated = (await loadSession(params.id)) ?? reloaded;
    const newPhase = updated.phases[nextPhaseIdx];
    const needsSequential = isSequentialCharacterPhase(newPhase);

    // 2. DM 阶段宣告（流式）
    const sequentialPlayerSc = getPlayerCharacter(updated);
    const sequentialAiNames = getAiCharacters(updated).map((sc) => sc.character.name).join("、");
    const dmDirective = needsSequential
      ? sequentialPlayerSc
        ? `请正式宣告进入阶段「${newPhase.name}」（${newPhase.description}）。说明发言顺序：先由 AI 角色按顺序发言（${sequentialAiNames || "在场角色"}），最后轮到玩家角色「${sequentialPlayerSc.character.name}」。不要说玩家先开始，简短有力。`
        : `请正式宣告进入阶段「${newPhase.name}」（${newPhase.description}）。说明在场角色将依次发言，全部发言后由 DM 收束并进入下一环节，简短有力。`
      : `请正式宣告进入阶段「${newPhase.name}」（${newPhase.description}），用庄重自然的语气，简短有力。`;
    await streamDMTurn(updated, dmDirective, "PHASE_ANNOUNCE", send, { phase: nextPhaseIdx });

    send({
      type: "PHASE_CHANGED",
      newPhase: nextPhaseIdx,
      phaseName: newPhase.name,
      dmAnnouncement: "",
    });

    // 3. 线索发布（若该阶段配置了 RELEASE_CLUE）
    const clueTriggers = newPhase.dmTriggers.filter((t) => t.type === "RELEASE_CLUE");
    if (clueTriggers.length > 0) {
      const clues = await selectCluesForTriggers(updated.script.id, params.id, nextPhaseIdx, clueTriggers);
      for (const clue of clues) {
        // 避免重复发布
        const exists = await prisma.clueRelease.findFirst({
          where: { sessionId: params.id, clueCardId: clue.id },
        });
        if (exists) continue;

        await prisma.clueRelease.create({
          data: {
            sessionId: params.id,
            clueCardId: clue.id,
            phase: nextPhaseIdx,
            releasedBy: "DM",
            releaseReason: `阶段「${newPhase.name}」自动发放`,
          },
        });
        await saveMessage({
          sessionId: params.id,
          channelType: ChannelType.DM_BROADCAST,
          channelKey: PUBLIC_CHANNEL_KEY,
          senderType: SenderType.DM,
          senderId: "dm",
          senderName: "DM",
          content: `【DM】发放线索卡《${clue.title}》。线索已沉淀到右侧牌堆，可用于举证或质询。`,
          phase: nextPhaseIdx,
          metadata: buildDmClueReleaseMetadata(clue, `阶段「${newPhase.name}」自动发放`),
        });
        send({
          type: "CLUE_RELEASED",
          clueCard: clueCardToDto(clue),
          dmDescription: "",
        });
      }
    }

    // 4. 顺序点名（自我介绍 / 最终陈词阶段）
    if (needsSequential) {
      const directive =
        newPhase.name.includes("陈词") || newPhase.id === 5
          ? "请发表你的最终陈词，立场鲜明、简短有力。"
          : "请做一个简短的角色自我介绍，可隐瞒你的秘密。";
      const ai = getAiCharacters(updated).map((sc) => sc.character);
      for (const character of ai) {
        await streamCharacterTurn(
          updated,
          character,
          PUBLIC_CHANNEL_KEY,
          ChannelType.PUBLIC,
          send,
          directive
        );
      }

      const playerSc = getPlayerCharacter(updated);
      if (playerSc) {
        const prompt = getSequentialPlayerPrompt(newPhase, playerSc.character.name);
        const saved = await saveMessage({
          sessionId: params.id,
          channelType: ChannelType.DM_BROADCAST,
          channelKey: PUBLIC_CHANNEL_KEY,
          senderType: SenderType.DM,
          senderId: "dm",
          senderName: "DM",
          content: prompt,
          phase: nextPhaseIdx,
        });
        send({
          type: "MESSAGE_COMPLETE",
          messageId: saved.id,
          fullContent: prompt,
          sender: { type: "DM", id: "dm", name: "DM" },
          phase: nextPhaseIdx,
          channelKey: PUBLIC_CHANNEL_KEY,
        });
      } else {
        const autoDirective = newPhase.name.includes("陈词") || newPhase.id === 5
          ? "所有在场角色已经完成最终陈词。请作为 DM 用 2 句以内收束全员陈词，不复述任何人的原话，然后宣布即将进入投票阶段。"
          : "所有在场角色已经完成自我介绍。请作为 DM 用 2 句以内提炼人物关系和当前氛围，不复述任何人的原话，然后宣布即将进入下一环节。";
        await streamDMTurn(
          updated,
          autoDirective,
          "GUIDE",
          send,
          { phase: nextPhaseIdx }
        );
        if (nextPhaseIdx < updated.phases.length - 1) {
          send({
            type: "PHASE_CHANGED",
            newPhase: nextPhaseIdx + 1,
            phaseName: "",
            dmAnnouncement: "__AUTO_NEXT__",
          });
        }
      }
    }

    // 4.5 特殊机制：按剧本类型触发随机/恐怖/情感事件 + 阶段判定 + 角色间密谈
    if (!needsSequential) {
      await triggerPhaseMechanics(updated, send);
      await runPhaseJudgment(updated, send);
      await triggerCharToCharGossip(updated, send);
    }

    // 4.6 进入「自由交流/讨论」类阶段时，先让 AI 角色在公共频道自发聊起来，
    //     避免该阶段一上来冷场、只能等玩家一问一答。玩家可随时插话。
    if (
      isFreeDiscussionPhase(newPhase)
    ) {
      await runPublicGroupDiscussion(updated, send, { turns: 2 });
    }

    // 5. 若进入复盘阶段，标记完成
    if (newPhase.name.includes("复盘") || newPhase.name.includes("揭秘")) {
      await prisma.gameSession.update({
        where: { id: params.id },
        data: { status: GameStatus.COMPLETED, completedAt: new Date() },
      });
    }
  });
}

async function selectCluesForTriggers(
  scriptId: string,
  sessionId: string,
  currentPhase: number,
  triggers: { config: any }[]
) {
  const released = await prisma.clueRelease.findMany({
    where: { sessionId },
    select: { clueCardId: true },
  });
  const releasedIds = released.map((item) => item.clueCardId);
  const selectedIds = new Set<string>();
  const selected: Awaited<ReturnType<typeof prisma.clueCard.findMany>> = [];

  for (const trigger of triggers) {
    const targetPhase = Number(trigger.config?.phase ?? currentPhase) || currentPhase;
    const batchSize = Math.max(1, Math.min(Number(trigger.config?.batchSize ?? 3) || 3, 6));
    const clueType = typeof trigger.config?.clueType === "string" ? trigger.config.clueType : undefined;
    const exact = await prisma.clueCard.findMany({
      where: {
        scriptId,
        releasePhase: targetPhase,
        isSecret: false,
        ...(clueType ? { clueType } : {}),
        id: { notIn: [...releasedIds, ...selectedIds] },
      },
      orderBy: [{ sequenceIndex: "asc" }, { releasePhase: "asc" }, { id: "asc" }],
      take: batchSize,
    });
    for (const clue of exact) {
      selected.push(clue);
      selectedIds.add(clue.id);
    }
    if (exact.length >= batchSize) continue;

    const fallback = await prisma.clueCard.findMany({
      where: {
        scriptId,
        isSecret: false,
        ...(clueType ? { clueType } : {}),
        id: { notIn: [...releasedIds, ...selectedIds] },
      },
      orderBy: [{ releasePhase: "asc" }, { sequenceIndex: "asc" }, { id: "asc" }],
      take: batchSize - exact.length,
    });
    for (const clue of fallback) {
      selected.push(clue);
      selectedIds.add(clue.id);
    }
  }

  return selected;
}

function safeArr(s: string): any[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
