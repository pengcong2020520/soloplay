import type { PhaseConfig } from "@/types/game";

// 推理本阶段配置（移植自 Tech Spec 6.2）
export const DEDUCTION_PHASES: PhaseConfig[] = [
  {
    id: 0,
    name: "阅本阶段",
    description: "玩家阅读角色剧本，熟悉背景",
    estimatedMinutes: 10,
    advanceConditions: [
      { type: "PLAYER_ACTION", value: "READY_CONFIRMED" },
      { type: "TIME", value: 600 },
    ],
    dmTriggers: [
      {
        type: "BROADCAST",
        timing: "START",
        config: { message: "游戏开始，请各位仔细阅读你们的角色剧本…" },
      },
    ],
    permissions: { publicChat: false, privateChat: false, clueInspection: false, voting: false },
    playerPaceControl: { canRequestHint: false, canSkipPhase: true, canRequestRecap: true, canFocusCharacter: false },
    adaptiveConfig: { stuckThresholdRounds: 3, boredThresholdRounds: 2, extraClueOnStuck: false, hiddenEventOnBored: false },
  },
  {
    id: 1,
    name: "入戏自我介绍",
    description: "每个角色依次进行角色介绍",
    estimatedMinutes: 10,
    advanceConditions: [
      { type: "PLAYER_ACTION", value: "ALL_INTRODUCED" },
      { type: "TIME", value: 600 },
    ],
    dmTriggers: [
      { type: "PROMPT_CHARACTER", timing: "START", config: { order: "sequential" } },
    ],
    permissions: { publicChat: true, privateChat: false, clueInspection: false, voting: false },
    playerPaceControl: { canRequestHint: false, canSkipPhase: true, canRequestRecap: true, canFocusCharacter: true },
    adaptiveConfig: { stuckThresholdRounds: 3, boredThresholdRounds: 2, extraClueOnStuck: false, hiddenEventOnBored: false },
  },
  {
    id: 2,
    name: "自由交流阶段",
    description: "自由讨论，私聊开放",
    estimatedMinutes: 20,
    advanceConditions: [
      { type: "TIME", value: 1200 },
      { type: "DM_DECISION" },
    ],
    dmTriggers: [
      {
        type: "BROADCAST",
        timing: "STALL",
        config: { message: "大家不妨思考一下：案发当晚，每个人究竟在哪里？" },
      },
    ],
    permissions: { publicChat: true, privateChat: true, clueInspection: false, voting: false },
    playerPaceControl: { canRequestHint: true, canSkipPhase: true, canRequestRecap: true, canFocusCharacter: true },
    adaptiveConfig: { stuckThresholdRounds: 3, boredThresholdRounds: 2, extraClueOnStuck: true, hiddenEventOnBored: true },
  },
  {
    id: 3,
    name: "独立搜证阶段",
    description: "DM 发布线索卡，各方分析",
    estimatedMinutes: 20,
    advanceConditions: [
      { type: "TIME", value: 1200 },
      { type: "PLAYER_ACTION", value: "CLUES_REVIEWED" },
    ],
    dmTriggers: [
      { type: "RELEASE_CLUE", timing: "START", config: { phase: 3, batchSize: 3 } },
      { type: "RELEASE_CLUE", timing: "MIDDLE", config: { phase: 3, batchSize: 2 } },
    ],
    permissions: { publicChat: true, privateChat: true, clueInspection: true, voting: false },
    playerPaceControl: { canRequestHint: true, canSkipPhase: true, canRequestRecap: true, canFocusCharacter: true },
    adaptiveConfig: { stuckThresholdRounds: 3, boredThresholdRounds: 2, extraClueOnStuck: true, hiddenEventOnBored: true },
  },
  {
    id: 4,
    name: "公开质询阶段",
    description: "任意角色可对其他角色提出质疑",
    estimatedMinutes: 15,
    advanceConditions: [
      { type: "TIME", value: 900 },
      { type: "DM_DECISION" },
    ],
    dmTriggers: [
      {
        type: "BROADCAST",
        timing: "STALL",
        config: { message: "目前有几个时间点尚存疑问，大家可以重点关注…" },
      },
    ],
    permissions: { publicChat: true, privateChat: true, clueInspection: true, voting: false },
    playerPaceControl: { canRequestHint: true, canSkipPhase: true, canRequestRecap: true, canFocusCharacter: true },
    adaptiveConfig: { stuckThresholdRounds: 3, boredThresholdRounds: 2, extraClueOnStuck: true, hiddenEventOnBored: false },
  },
  {
    id: 5,
    name: "最终陈词",
    description: "每个角色发表最终陈词",
    estimatedMinutes: 10,
    advanceConditions: [
      { type: "PLAYER_ACTION", value: "ALL_STATED" },
      { type: "TIME", value: 600 },
    ],
    dmTriggers: [
      {
        type: "PROMPT_CHARACTER",
        timing: "START",
        config: { order: "sequential", prompt: "请发表你的最终陈词" },
      },
    ],
    permissions: { publicChat: true, privateChat: false, clueInspection: true, voting: false },
    playerPaceControl: { canRequestHint: false, canSkipPhase: false, canRequestRecap: true, canFocusCharacter: false },
    adaptiveConfig: { stuckThresholdRounds: 3, boredThresholdRounds: 2, extraClueOnStuck: false, hiddenEventOnBored: false },
  },
  {
    id: 6,
    name: "投票指凶",
    description: "提交最终投票",
    estimatedMinutes: 5,
    advanceConditions: [{ type: "PLAYER_ACTION", value: "ALL_VOTED" }],
    dmTriggers: [
      {
        type: "BROADCAST",
        timing: "START",
        config: { message: "投票时刻到来，请各位提交你认为的凶手…" },
      },
    ],
    permissions: { publicChat: false, privateChat: false, clueInspection: false, voting: true },
    playerPaceControl: { canRequestHint: false, canSkipPhase: false, canRequestRecap: false, canFocusCharacter: false },
    adaptiveConfig: { stuckThresholdRounds: 99, boredThresholdRounds: 99, extraClueOnStuck: false, hiddenEventOnBored: false },
  },
  {
    id: 7,
    name: "复盘揭秘",
    description: "真相揭示，胜负宣判",
    estimatedMinutes: 10,
    advanceConditions: [],
    dmTriggers: [
      {
        type: "BROADCAST",
        timing: "START",
        config: { message: "现在，揭开真相的时刻到了…" },
      },
    ],
    permissions: { publicChat: true, privateChat: false, clueInspection: true, voting: false },
  },
];
