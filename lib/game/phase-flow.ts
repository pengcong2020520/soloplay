import type { PhaseConfig } from "@/types/game";

export function isSequentialCharacterPhase(phase: PhaseConfig) {
  return phase.dmTriggers.some((trigger) => trigger.type === "PROMPT_CHARACTER");
}

export function isIntroPhase(phase: PhaseConfig) {
  return isSequentialCharacterPhase(phase) && /自我介绍|入戏|介绍/.test(phase.name);
}

export function isFinalStatementPhase(phase: PhaseConfig) {
  return isSequentialCharacterPhase(phase) && /最终陈词|陈词/.test(phase.name);
}

export function getSequentialPlayerPrompt(phase: PhaseConfig, playerName: string) {
  if (isFinalStatementPhase(phase)) {
    return `【DM】轮到${playerName}做最终陈词。请用你的角色立场给出最后判断，不必很长，但要让所有人听清你的态度。`;
  }
  return `【DM】轮到${playerName}做自我介绍。请介绍你的公开身份、你和本案/核心人物的关系，以及你愿意让大家知道的立场。`;
}

export function getSequentialCompletionDirective(phase: PhaseConfig, playerName: string) {
  if (isFinalStatementPhase(phase)) {
    return `玩家角色${playerName}已经完成最终陈词。请作为 DM 用 2 句以内收束全员陈词，不复述任何人的原话，然后宣布即将进入投票阶段。`;
  }
  return `玩家角色${playerName}已经完成自我介绍，所有在场角色均已介绍完毕。请作为 DM 用 2 句以内提炼人物关系和当前氛围，不复述玩家原话，然后宣布即将进入下一环节。`;
}

export function shouldAutoAdvanceAfterPlayerSpeech(phase: PhaseConfig) {
  return isIntroPhase(phase) || isFinalStatementPhase(phase);
}

export function isFreeDiscussionPhase(phase: PhaseConfig) {
  return (
    phase.permissions.publicChat &&
    !isSequentialCharacterPhase(phase) &&
    /自由交流|自由讨论|搜证|质询|推理/.test(`${phase.name}${phase.description}`)
  );
}
