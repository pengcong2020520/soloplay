import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadSession, getPlayerCharacter } from "@/lib/game/session";
import { resolveUserId } from "@/lib/auth/current-user";
import { runAiVotes } from "@/lib/agents/vote-agent";
import { tallyVotes } from "@/lib/game/vote-engine";
import { judgeOutcome } from "@/lib/game/outcome";
import { PlayerMode } from "@/lib/constants";

export const maxDuration = 120;

/**
 * 玩家提交投票，随后触发所有 AI 角色投票，汇总并判定结局。
 * Body: { targetId }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { targetId } = await req.json();

  const userId = await resolveUserId();
  const loaded = await loadSession(params.id, userId);
  if (!loaded) return NextResponse.json({ error: "未找到会话" }, { status: 404 });

  // 幂等：已投过则不重复
  const existingPlayerVote = await prisma.vote.findFirst({
    where: { sessionId: params.id, voterId: "player" },
  });

  const target = loaded.sessionCharacters.find((sc) => sc.character.id === targetId);
  if (!target && !existingPlayerVote) {
    return NextResponse.json({ error: "投票对象无效" }, { status: 400 });
  }

  const playerSc = getPlayerCharacter(loaded);
  const playerName =
    loaded.playerMode === PlayerMode.ROLE_PLAY && playerSc
      ? playerSc.character.name
      : "侦探";

  if (!existingPlayerVote && target) {
    // 原子化幂等：靠 Vote 的 (sessionId, voterId) 唯一约束防并发重复投票。
    // 只有成功插入玩家票的这个请求才触发 AI 投票；并发的重复请求会撞 P2002，
    // 视为"已投过"并跳过 runAiVotes，避免双倍玩家票 + AI 票被重复生成。
    let createdPlayerVote = false;
    try {
      await prisma.vote.create({
        data: {
          sessionId: params.id,
          voterId: "player",
          voterName: playerName,
          voterType: "PLAYER",
          targetId: target.character.id,
          targetName: target.character.name,
          reason: "玩家投票",
        },
      });
      createdPlayerVote = true;
    } catch (err) {
      // P2002 = 唯一约束冲突（并发重复投票），幂等吞掉；其它错误照常抛出
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
        throw err;
      }
    }

    if (createdPlayerVote) {
      // 触发 AI 投票
      await runAiVotes(loaded);
    }
  }

  // 汇总
  const allVotes = await prisma.vote.findMany({ where: { sessionId: params.id } });
  const { results, topTargetName } = tallyVotes(allVotes);

  // 判定结局 + 落库胜负
  const outcome = await judgeOutcome(loaded, topTargetName);

  return NextResponse.json({ results, outcome });
}
