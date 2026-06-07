import { NextRequest, NextResponse } from "next/server";
import { complete } from "@/lib/anthropic";
import { prisma } from "@/lib/db/prisma";
import { loadSession } from "@/lib/game/session";
import { resolveUserId } from "@/lib/auth/current-user";
import { ChannelType, PlayerMode } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await resolveUserId();
  const loaded = await loadSession(params.id, userId);
  if (!loaded) return NextResponse.json({ error: "未找到会话" }, { status: 404 });
  if (loaded.playerMode !== PlayerMode.DETECTIVE) {
    return NextResponse.json({ error: "仅侦探模式可用" }, { status: 400 });
  }

  const messages = await prisma.message.findMany({
    where: {
      sessionId: params.id,
      isVisible: true,
      channelType: { in: [ChannelType.PUBLIC, ChannelType.DM_BROADCAST, ChannelType.DM_HINT] },
    },
    orderBy: { createdAt: "asc" },
    take: 120,
  });

  const aiCharacters = loaded.sessionCharacters
    .filter((sc) => sc.assignedTo === "AI")
    .map((sc) => ({
      id: sc.character.id,
      name: sc.character.name,
      occupation: sc.character.occupation,
      publicProfile: sc.character.publicProfile,
    }));

  if (messages.length === 0) {
    return NextResponse.json({
      summary: "暂无公开发言。进入公共大厅后，角色发言会在这里被自动整理成侦探笔记。",
      generatedAt: new Date().toISOString(),
      messageCount: 0,
    });
  }

  const transcript = messages
    .map((m) => `[${m.senderName}]：${m.content}`)
    .join("\n");
  const roster = aiCharacters
    .map((c) => `- ${c.name}${c.occupation ? `（${c.occupation}）` : ""}：${c.publicProfile}`)
    .join("\n");

  const summary = await complete(
    {
      system:
        "你是剧本杀侦探助手。你只根据公开频道内容整理侦探笔记，不推断未出现的私密剧本，不直接剧透真凶。输出中文 Markdown。",
      messages: [
        {
          role: "user",
          content: `剧本：《${loaded.script.title}》

在场人物：
${roster}

公开对话：
${transcript}

请按角色分别总结每个人目前公开说过什么、立场/疑点、需要继续追问的问题。格式：
## 角色名
- 已说内容：
- 可疑点：
- 下一步追问：`,
        },
      ],
      maxTokens: 900,
      temperature: 0.3,
    },
    () => buildMockSummary(aiCharacters, messages)
  );

  return NextResponse.json({
    summary,
    generatedAt: new Date().toISOString(),
    messageCount: messages.length,
  });
}

function buildMockSummary(
  characters: { id: string; name: string; occupation: string | null; publicProfile: string }[],
  messages: { senderId: string; senderName: string; content: string }[]
) {
  return characters
    .map((character) => {
      const spoken = messages.filter((m) => m.senderId === character.id);
      const latest = spoken[spoken.length - 1]?.content;
      return `## ${character.name}
- 已说内容：${spoken.length > 0 ? `公开发言 ${spoken.length} 次。${latest ?? ""}` : "暂未在公开频道发言。"}
- 可疑点：结合其公开身份「${character.publicProfile}」继续观察口径是否前后一致。
- 下一步追问：要求其补充案发前后的具体时间线。`;
    })
    .join("\n\n");
}
