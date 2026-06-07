import { prisma } from "@/lib/db/prisma";
import { getPrivateChannelKey } from "@/lib/utils";
import { ChannelType, SenderType } from "@/lib/constants";
import type { LoadedSession } from "@/lib/game/session";
import { getCurrentPhase } from "@/lib/game/session";
import { streamCharacterReply } from "@/lib/agents/character-agent";
import type { Character } from "@prisma/client";

/**
 * DM 协调的角色↔角色私聊（玩家不可见，复盘可查）。
 * 让 a 先开口，b 回应，往返 rounds 轮，全部落库到 PRIVATE 频道。
 * 返回是否真的发生了私聊。
 */
export async function runCharToCharPrivateChat(
  loaded: LoadedSession,
  a: Character,
  b: Character,
  rounds = 1
): Promise<boolean> {
  const channelKey = getPrivateChannelKey(a.id, b.id);
  const phase = getCurrentPhase(loaded);

  let lastLine = `（${a.name}把${b.name}拉到一旁，压低声音）我们得谈谈，关于那晚的事。`;
  await save(loaded.session.id, channelKey, a, lastLine, loaded.currentPhase);

  let speaker = b;
  let listener = a;

  for (let i = 0; i < rounds * 2 - 1; i++) {
    const directive = `${listener.name}刚才私下对你说："${lastLine}"。这是只有你们两人的密谈，请以你的角色立场简短回应（1~3句），可以试探、结盟、威胁或敷衍。`;
    let full = "";
    for await (const chunk of streamCharacterReply({
      loaded,
      character: speaker,
      channelKey,
      directive,
    })) {
      full += chunk;
    }
    if (!full.trim()) {
      full = `（${speaker.name}沉默片刻）……这件事，我们以后再说。`;
    }
    await save(loaded.session.id, channelKey, speaker, full, loaded.currentPhase);
    lastLine = full;
    // swap
    const tmp = speaker;
    speaker = listener;
    listener = tmp;
  }

  void phase;
  return true;
}

async function save(
  sessionId: string,
  channelKey: string,
  character: Character,
  content: string,
  phase: number
) {
  await prisma.message.create({
    data: {
      sessionId,
      channelType: ChannelType.PRIVATE,
      channelKey,
      senderType: SenderType.AI_CHARACTER,
      senderId: character.id,
      senderName: character.name,
      content,
      phase,
      // 标记为角色间私聊，玩家进行中不可见
      metadata: JSON.stringify({ charToChar: true }),
    },
  });
}
