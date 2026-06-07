import { prisma } from "@/lib/db/prisma";
import { GameStatus, PlayerMode } from "@/lib/constants";
import type { ScriptType } from "@/lib/constants";
import type { GameOutcome } from "@/types/game";
import type { LoadedSession } from "@/lib/game/session";

/**
 * 差异化结局判定（PRD 7.1）：
 * - 推理/硬核：标准投票制（投出真凶）
 * - 还原：以指认关键人物（=凶手/责任人）是否正确判定（时间线还原简化为指认正确）
 * - 情感：情感目标达成制——不以投出凶手论胜负，玩家"完成表态/深度对话"即视为达成
 * - 欢乐：轻量判定——无严格胜负，全员"达成"，玩家获趣味结局
 * - 恐怖：存活/逃脱判定——玩家做出关键抉择即视为存活（简化）
 */
export async function judgeOutcome(
  loaded: LoadedSession,
  topTargetName: string | null
): Promise<GameOutcome> {
  const scriptType = loaded.script.scriptType as ScriptType;
  const murderer = loaded.sessionCharacters.find((sc) => sc.character.isMurderer)?.character;
  const murdererName = murderer?.name ?? null;
  const murdererVotedOut = Boolean(murdererName && topTargetName === murdererName);

  const playerSc = loaded.sessionCharacters.find((sc) => sc.assignedTo === "PLAYER");
  const playerVote = await prisma.vote.findFirst({
    where: { sessionId: loaded.session.id, voterId: "player" },
  });
  const playerPickedMurderer = Boolean(
    playerVote && murdererName && playerVote.targetName === murdererName
  );

  let playerWon: boolean | null = null;
  let characterResults: GameOutcome["characterResults"];

  switch (scriptType) {
    case "COMEDY": {
      // 欢乐本：无严格胜负，全员达成，玩家获趣味结局
      playerWon = true;
      characterResults = loaded.sessionCharacters.map((sc) => ({
        name: sc.character.name,
        isMurderer: sc.character.isMurderer,
        victoryAchieved: true,
        victoryReason: "欢乐至上——本局没有输家，每个人都贡献了快乐。",
      }));
      break;
    }
    case "EMOTIONAL": {
      // 情感本：情感目标达成制——玩家若有充分参与（发过言）即视为达成
      const playerMsgCount = await prisma.message.count({
        where: { sessionId: loaded.session.id, senderId: "player" },
      });
      playerWon = playerMsgCount >= 3 || playerPickedMurderer;
      characterResults = loaded.sessionCharacters.map((sc) => ({
        name: sc.character.name,
        isMurderer: sc.character.isMurderer,
        victoryAchieved: true,
        victoryReason: "在情感的交汇里，每个角色都得到了被听见的机会。",
      }));
      break;
    }
    case "HORROR": {
      // 恐怖本：存活/逃脱判定——玩家做出抉择（=投了票/做了选择）即存活
      playerWon = Boolean(playerVote);
      characterResults = loaded.sessionCharacters.map((sc) => {
        const survived = sc.character.isMurderer ? false : true;
        return {
          name: sc.character.name,
          isMurderer: sc.character.isMurderer,
          victoryAchieved: survived,
          victoryReason: survived
            ? "在恐惧中找到了出路，成功存活至结局。"
            : "作为威胁的来源，最终被揭露并清除。",
        };
      });
      break;
    }
    case "RESTORATION":
    case "DEDUCTION":
    case "HARDCORE":
    default: {
      // 标准/还原：投出真凶 = 还原成功
      if (loaded.playerMode === PlayerMode.DETECTIVE) {
        playerWon = playerPickedMurderer;
      } else if (playerSc) {
        playerWon = playerSc.character.isMurderer ? !murdererVotedOut : murdererVotedOut;
      }
      characterResults = loaded.sessionCharacters.map((sc) => {
        const c = sc.character;
        let victoryAchieved: boolean;
        let victoryReason: string;
        if (c.isMurderer) {
          victoryAchieved = !murdererVotedOut;
          victoryReason = victoryAchieved
            ? "未被多数票投出，成功隐藏身份。"
            : "被多数票指认，隐藏失败。";
        } else {
          victoryAchieved = murdererVotedOut;
          victoryReason = victoryAchieved
            ? "成功协助投出真凶/还原真相。"
            : "未能投出真凶，被蒙混过关。";
        }
        return { name: c.name, isMurderer: c.isMurderer, victoryAchieved, victoryReason };
      });
      break;
    }
  }

  // 落库胜负 + 标记完成
  for (const sc of loaded.sessionCharacters) {
    const r = characterResults.find((x) => x.name === sc.character.name)!;
    await prisma.sessionCharacter.update({
      where: { id: sc.id },
      data: { victoryAchieved: r.victoryAchieved, victoryReason: r.victoryReason },
    });
  }
  await prisma.gameSession.update({
    where: { id: loaded.session.id },
    data: { status: GameStatus.COMPLETED, completedAt: new Date() },
  });

  return {
    mostVotedName: topTargetName,
    murdererName,
    playerWon,
    characterResults,
  };
}
