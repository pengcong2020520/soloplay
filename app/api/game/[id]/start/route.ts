import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { assertSessionOwner } from "@/lib/auth/current-user";
import { parseJson } from "@/lib/utils";
import {
  PlayerMode,
  GameStatus,
  AssigneeType,
  ChannelType,
  SenderType,
  PUBLIC_CHANNEL_KEY,
} from "@/lib/constants";

/**
 * 正式开始游戏：DM 分配角色。
 * - ROLE_PLAY：玩家占据 isPlayerSlot 角色（角色1），其余非死者角色为 AI。
 * - DETECTIVE：玩家不占角色，所有非死者角色均为 AI。
 * 死者角色不创建 SessionCharacter（不发言）。
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await assertSessionOwner(params.id);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });
  const session = auth.session;

  // 幂等：已开始则直接返回
  if (session.status !== GameStatus.SETUP) {
    return NextResponse.json({ ok: true, alreadyStarted: true });
  }

  // 并发保护（CAS）：原子地把 SETUP→IN_PROGRESS。React 18 严格模式下 useEffect 会触发两次，
  // 两个请求可能几乎同时读到 SETUP；这里只有一个能 claim 成功（count===1），由它去创建角色/广播，
  // 另一个直接返回 alreadyStarted，避免 createMany 撞唯一约束 + 重复开场广播。
  const claim = await prisma.gameSession.updateMany({
    where: { id: session.id, status: GameStatus.SETUP },
    data: {
      status: GameStatus.IN_PROGRESS,
      startedAt: new Date(),
      currentPhase: 0,
      phaseStartedAt: new Date(),
    },
  });
  if (claim.count === 0) {
    // 已被并发的另一个请求 claim，本次不重复初始化
    return NextResponse.json({ ok: true, alreadyStarted: true });
  }

  const characters = await prisma.character.findMany({
    where: { scriptId: session.scriptId },
  });
  const script = await prisma.script.findUnique({
    where: { id: session.scriptId },
    select: { title: true, publicStory: true },
  });

  const engagementSignals = parseJson<Record<string, unknown>>(session.engagementSignals, {});
  const selectedPlayerCharacterId =
    typeof engagementSignals.selectedPlayerCharacterId === "string"
      ? engagementSignals.selectedPlayerCharacterId
      : null;
  const selectedPlayerSlot = selectedPlayerCharacterId
    ? characters.find((c) => c.id === selectedPlayerCharacterId && !c.isVictim)
    : null;
  const playerSlot =
    selectedPlayerSlot ?? characters.find((c) => c.isPlayerSlot && !c.isVictim) ?? characters.find((c) => !c.isVictim);

  const sessionCharacterData = characters
    .filter((c) => !c.isVictim) // 死者不进入会话
    .map((c) => {
      const isPlayer =
        session.playerMode === PlayerMode.ROLE_PLAY && c.id === playerSlot?.id;
      return {
        sessionId: session.id,
        characterId: c.id,
        assignedTo: isPlayer ? AssigneeType.PLAYER : AssigneeType.AI,
      };
    });

  // 并发已由上面的 CAS claim 收口（只有 claim 成功的请求会走到这里），故无需 skipDuplicates
  // （SQLite 的 Prisma createMany 也不支持该选项）。
  await prisma.sessionCharacter.createMany({ data: sessionCharacterData });

  // DM 开场广播
  const activeCharacters = characters.filter((c) => !c.isVictim);
  const roster = activeCharacters
    .map((c) => `- ${c.name}${c.occupation ? `（${c.occupation}）` : ""}：${c.publicProfile}`)
    .join("\n");
  await prisma.message.create({
    data: {
      sessionId: session.id,
      channelType: ChannelType.DM_BROADCAST,
      channelKey: PUBLIC_CHANNEL_KEY,
      senderType: SenderType.DM,
      senderId: "dm",
      senderName: "DM",
      content: `【DM】欢迎来到《${script?.title ?? "本局剧本"}》。

背景概况：
${script?.publicStory ?? "剧本背景将在游戏中逐步展开。"}

在场人物：
${roster || "本局角色正在入场。"}

请先确认自己的身份信息与公开背景。准备好后，我会带你进入下一阶段。`,
      phase: 0,
    },
  });

  return NextResponse.json({ ok: true });
}
