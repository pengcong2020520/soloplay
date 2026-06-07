import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { parseJson } from "@/lib/utils";
import { assertSessionOwner } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/** 复盘数据：真相、全角色私密剧本、全部消息（含私聊）、投票、胜负 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await assertSessionOwner(params.id);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 403 });
  const session = auth.session;

  const script = await prisma.script.findUnique({
    where: { id: session.scriptId },
    include: { characters: true, clueCards: true },
  });
  if (!script) return NextResponse.json({ error: "未找到剧本" }, { status: 404 });

  const sessionCharacters = await prisma.sessionCharacter.findMany({
    where: { sessionId: params.id },
    include: { character: true },
  });

  const messages = await prisma.message.findMany({
    where: { sessionId: params.id },
    orderBy: { createdAt: "asc" },
  });

  const votes = await prisma.vote.findMany({ where: { sessionId: params.id } });

  return NextResponse.json({
    title: script.title,
    scriptType: script.scriptType,
    publicStory: script.publicStory,
    murderSummary: script.murderSummary, // 复盘阶段公开真相
    playerMode: session.playerMode,
    // 全角色完整剧本（复盘全公开）
    characters: sessionCharacters.map((sc) => ({
      name: sc.character.name,
      gender: sc.character.gender,
      occupation: sc.character.occupation,
      assignedTo: sc.assignedTo,
      isMurderer: sc.character.isMurderer,
      privateStory: sc.character.privateStory,
      secrets: sc.character.secrets,
      hiddenGoal: sc.character.hiddenGoal,
      victoryCondition: sc.character.victoryCondition,
      relationships: parseJson(sc.character.relationships, {}),
      victoryAchieved: sc.victoryAchieved,
      victoryReason: sc.victoryReason,
    })),
    clueCards: script.clueCards.map((c) => ({
      title: c.title,
      content: c.content,
      clueType: c.clueType,
      isSecret: c.isSecret,
    })),
    // 全部消息，含私聊（复盘全开放）
    messages: messages.map((m) => {
      const meta = m.metadata ? parseJson<Record<string, any>>(m.metadata, {}) : {};
      return {
        id: m.id,
        channelType: m.channelType,
        channelKey: m.channelKey,
        senderType: m.senderType,
        senderName: m.senderName,
        content: m.content,
        phase: m.phase,
        createdAt: m.createdAt.toISOString(),
        // 穿帮检测结果（若有），供复盘标注角色前后矛盾
        consistency: meta.consistency ?? null,
      };
    }),
    // 穿帮汇总：把检测出的矛盾按角色聚合，便于复盘一眼看到"谁哪里穿帮了"
    consistencyIssues: messages
      .map((m) => {
        const meta = m.metadata ? parseJson<Record<string, any>>(m.metadata, {}) : {};
        const c = meta.consistency;
        if (!c || !c.contradicts) return null;
        return {
          senderName: m.senderName,
          phase: m.phase,
          content: m.content,
          detail: c.detail as string,
          against: c.against as string,
          severity: c.severity as number,
        };
      })
      .filter(Boolean),
    votes: votes.map((v) => ({
      voterName: v.voterName,
      targetName: v.targetName,
      reason: v.reason,
    })),
  });
}
