import { prisma } from "@/lib/db/prisma";
import { ChannelType, SenderType, PUBLIC_CHANNEL_KEY } from "@/lib/constants";
import type { ScriptType } from "@/lib/constants";
import type { GameEvent } from "@/types/game";
import type { LoadedSession } from "@/lib/game/session";
import { getAiCharacters, getCurrentPhase } from "@/lib/game/session";
import { runCharToCharPrivateChat } from "@/lib/agents/char-to-char";
import { dmComplete } from "@/lib/agents/dm-agent";
import { saveMessage } from "@/lib/game/turn";

/**
 * 稳定的"伪随机"选择器：基于会话 id + 阶段 + salt 派生索引，
 * 避免使用 Math.random（保证可复现，且不依赖运行时随机源）。
 */
function pseudoIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return mod > 0 ? h % mod : 0;
}

// ─── 欢乐本随机事件卡 ───────────────────────────────
const COMEDY_EVENTS = [
  "所有人接下来必须用第三人称称呼自己，违者罚讲一个冷笑话！",
  "突然停电！接下来一轮，每个人发言都要带上『在黑暗中』。",
  "神秘快递送来一箱榴莲，现在每个人都要解释自己和榴莲的关系。",
  "时间胶囊被打开，里面是一张纸条：『凶手其实很可爱』——请各位据此重新审视彼此。",
];

// ─── 恐怖本事件 ─────────────────────────────────────
const HORROR_EVENTS = [
  "走廊尽头的座钟无故敲响了十三下，烛火齐齐熄灭，黑暗中似乎有脚步声逼近……",
  "镜子里出现了一张不属于在场任何人的脸，转瞬即逝。墙上慢慢渗出暗红的字迹。",
  "地下室传来指甲抓挠门板的声音，越来越急。有人发现自己的房门已被从外面反锁。",
];

// ─── 情感本触发事件 ─────────────────────────────────
const EMOTIONAL_EVENTS = [
  "在旧抽屉深处，发现了一张泛黄的合影，背面写着一行褪色的字：『答应过你的，我没忘』。",
  "一封始终没有寄出的信被找到了，落款的日期，正是那场意外发生的前一天。",
  "音乐盒被无意拧响，流淌出一段熟悉的旋律——那是只有特定几个人才会记得的曲子。",
];

export interface MechanicResult {
  triggered: boolean;
  kind?: string;
}

/**
 * 进入新阶段时，根据剧本类型触发对应特殊机制。
 * 通过 send 推送事件，所有内容落库。
 */
export async function triggerPhaseMechanics(
  loaded: LoadedSession,
  send: (e: GameEvent) => void
): Promise<MechanicResult> {
  const scriptType = loaded.script.scriptType as ScriptType;
  const phase = getCurrentPhase(loaded);
  const seed = `${loaded.session.id}-${loaded.currentPhase}`;

  switch (scriptType) {
    case "COMEDY": {
      // 自由交流/高潮阶段触发随机事件卡
      if (phase.permissions.publicChat && phase.id >= 2) {
        const ev = COMEDY_EVENTS[pseudoIndex(seed, COMEDY_EVENTS.length)];
        await broadcastEvent(loaded, `【DM·随机事件卡】${ev}`, send, "RANDOM_EVENT");
        return { triggered: true, kind: "comedy-event" };
      }
      break;
    }
    case "HORROR": {
      if (phase.permissions.publicChat && phase.id >= 2) {
        const ev = HORROR_EVENTS[pseudoIndex(seed, HORROR_EVENTS.length)];
        await broadcastEvent(loaded, `【DM】${ev}`, send, "HORROR_EVENT");
        return { triggered: true, kind: "horror-event" };
      }
      break;
    }
    case "EMOTIONAL": {
      if (phase.permissions.publicChat && phase.id >= 2) {
        const ev = EMOTIONAL_EVENTS[pseudoIndex(seed, EMOTIONAL_EVENTS.length)];
        await broadcastEvent(loaded, `【DM·情感触发事件】${ev}`, send, "EMOTIONAL_EVENT");
        return { triggered: true, kind: "emotional-event" };
      }
      break;
    }
  }

  return { triggered: false };
}

/**
 * 在自由交流/质询阶段，DM 协调一对 AI 角色进行密谈（玩家不可见），
 * 仅给玩家一个"有私聊发生"的提示。
 */
export async function triggerCharToCharGossip(
  loaded: LoadedSession,
  send: (e: GameEvent) => void
): Promise<boolean> {
  const phase = getCurrentPhase(loaded);
  if (!phase.permissions.privateChat) return false;

  const ai = getAiCharacters(loaded).map((sc) => sc.character);
  if (ai.length < 2) return false;

  const seed = `${loaded.session.id}-${loaded.currentPhase}-gossip`;
  const aIdx = pseudoIndex(seed, ai.length);
  const bIdx = pseudoIndex(seed + "b", ai.length - 1);
  const a = ai[aIdx];
  const b = ai.filter((_, i) => i !== aIdx)[bIdx];
  if (!a || !b) return false;

  await runCharToCharPrivateChat(loaded, a, b, 1);
  send({ type: "PRIVATE_CHAT_INDICATOR", participants: [a.name, b.name] });
  return true;
}

/**
 * 恐怖本生存判定节点 / 还原本时间线评估等：DM 给出阶段性判定。
 */
export async function runPhaseJudgment(
  loaded: LoadedSession,
  send: (e: GameEvent) => void
): Promise<void> {
  const scriptType = loaded.script.scriptType as ScriptType;
  const phase = getCurrentPhase(loaded);

  if (scriptType === "HORROR" && phase.name.includes("判定")) {
    const text = await dmComplete(
      loaded,
      "现在是生存判定节点。请根据玩家迄今的探索行为，描述一次紧张的生存判定结果（不直接判死，营造紧迫感），并暗示下一步该往哪走。",
      "GUIDE"
    );
    await broadcastDM(loaded, text, send);
  }
  if (scriptType === "HARDCORE" && phase.name.includes("推理")) {
    const text = await dmComplete(
      loaded,
      "现在是中间推理节点。请邀请玩家提交当前对案情的判断，并准备在其提交后给出『方向正确/需重新考虑』的提示（此刻先发出邀请，不透露真相）。",
      "GUIDE"
    );
    await broadcastDM(loaded, text, send);
  }
}

async function broadcastEvent(
  loaded: LoadedSession,
  content: string,
  send: (e: GameEvent) => void,
  kind: string
) {
  const saved = await saveMessage({
    sessionId: loaded.session.id,
    channelType: ChannelType.DM_BROADCAST,
    channelKey: PUBLIC_CHANNEL_KEY,
    senderType: SenderType.DM,
    senderId: "dm",
    senderName: "DM",
    content,
    phase: loaded.currentPhase,
    metadata: { event: kind },
  });
  send({
    type: "MESSAGE_COMPLETE",
    messageId: saved.id,
    fullContent: content,
    sender: { type: "DM", id: "dm", name: "DM" },
    phase: loaded.currentPhase,
    channelKey: PUBLIC_CHANNEL_KEY,
  });
}

async function broadcastDM(
  loaded: LoadedSession,
  content: string,
  send: (e: GameEvent) => void
) {
  const saved = await saveMessage({
    sessionId: loaded.session.id,
    channelType: ChannelType.DM_BROADCAST,
    channelKey: PUBLIC_CHANNEL_KEY,
    senderType: SenderType.DM,
    senderId: "dm",
    senderName: "DM",
    content,
    phase: loaded.currentPhase,
  });
  send({
    type: "MESSAGE_COMPLETE",
    messageId: saved.id,
    fullContent: content,
    sender: { type: "DM", id: "dm", name: "DM" },
    phase: loaded.currentPhase,
    channelKey: PUBLIC_CHANNEL_KEY,
  });
}

export { pseudoIndex };
