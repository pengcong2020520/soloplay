import type {
  ScriptType,
  Difficulty,
  PlayerMode,
  ClueType,
  SenderType,
  ChannelType,
} from "@/lib/constants";

// ─── 阶段状态机 ─────────────────────────────────────

export interface PhaseConfig {
  id: number;
  name: string;
  description: string;
  estimatedMinutes: number;

  advanceConditions: {
    type: "TIME" | "PLAYER_ACTION" | "DM_DECISION";
    value?: any;
  }[];

  dmTriggers: {
    type: "RELEASE_CLUE" | "PROMPT_CHARACTER" | "BROADCAST" | "RANDOM_EVENT";
    timing: "START" | "MIDDLE" | "END" | "STALL" | "BORED";
    config: any;
  }[];

  permissions: {
    publicChat: boolean;
    privateChat: boolean;
    clueInspection: boolean;
    voting: boolean;
  };

  playerPaceControl?: {
    canRequestHint: boolean;
    canSkipPhase: boolean;
    canRequestRecap: boolean;
    canFocusCharacter: boolean;
  };

  adaptiveConfig?: {
    stuckThresholdRounds: number;
    boredThresholdRounds: number;
    extraClueOnStuck: boolean;
    hiddenEventOnBored: boolean;
  };
}

// ─── 剧本生成 ───────────────────────────────────────

export interface GenerationParams {
  // 第零步：体验意图
  experienceIntent?: string;
  experienceLevel?: string;
  timeBudget?: string;
  // 第一步：基础框架
  scriptType: ScriptType;
  era: string;
  location: string;
  characterCount: number;
  duration: string;
  // 第二步：叙事与风格
  difficulty: Difficulty;
  clueDensity: string;
  narrativeStructure: string;
  writingStyle: string;
  emotionalTone: string;
  // 第三步：主题与内容
  theme: string;
  specialElements: string[];
  twistType: string;
  endingType: string;
  // 第四步：角色定制
  playerRoleType: string;
  relationshipComplexity?: string;
  customCharacterRequirements?: string;
  // 第五步：机制与边界
  specialMechanics: string[];
  contentRestrictions: string[];
}

// Claude 生成剧本的结构化输出
export interface GeneratedScript {
  title: string;
  publicStory: string;
  setting?: Record<string, any>;
  characters: GeneratedCharacter[];
  clueCards: GeneratedClueCard[];
  phaseConfig: GeneratedPhase[];
  murderSummary: string;
}

export interface GeneratedCharacter {
  name: string;
  gender: string;
  occupation: string;
  publicProfile: string;
  privateStory: string;
  secrets: string;
  hiddenGoal: string;
  victoryCondition: string;
  unknownFacts: string;
  relationships?: Record<string, string>;
  isMurderer: boolean;
  isVictim: boolean;
}

export interface GeneratedClueCard {
  title: string;
  content: string;
  clueType: ClueType;
  releasePhase: number;
  isSecret: boolean;
}

export interface GeneratedPhase {
  name: string;
  description: string;
  estimatedMinutes: number;
  objectives: string[];
}

// ─── 运行时游戏状态 ────────────────────────────────

export interface GameStateSnapshot {
  playerMode: PlayerMode;
  currentPhase: number;
  engagementSignals: Record<string, any>;
  hintsUsed: number;
  difficultyAdjusted: boolean;
  releasedClueIds: string[];
  /** 当前阶段进入时间（ISO 字符串），用于超时自动推进；未开始则为 null */
  phaseStartedAt: string | null;
}

// ─── SSE 事件 ──────────────────────────────────────

export interface SenderInfo {
  type: SenderType;
  id: string;
  name: string;
}

export type GameEvent =
  | { type: "MESSAGE_STREAM"; chunk: string; messageId: string; sender: SenderInfo }
  | { type: "MESSAGE_COMPLETE"; messageId: string; fullContent: string; sender: SenderInfo; phase: number; channelKey: string }
  | { type: "PHASE_CHANGED"; newPhase: number; phaseName: string; dmAnnouncement: string }
  | { type: "CLUE_RELEASED"; clueCard: ClueCardDTO; dmDescription: string }
  | { type: "PRIVATE_CHAT_INDICATOR"; participants: string[] }
  | { type: "VOTE_SUBMITTED"; voterName: string }
  | { type: "VOTE_RESULT"; results: VoteResultRow[] }
  | { type: "GAME_COMPLETED"; outcome: GameOutcome }
  | { type: "DM_HINT"; content: string }
  | { type: "ERROR"; message: string };

export interface ClueCardDTO {
  id: string;
  title: string;
  content: string;
  clueType: ClueType;
}

export interface VoteResultRow {
  targetId: string;
  targetName: string;
  count: number;
  voters: { name: string; reason: string }[];
}

export interface GameOutcome {
  mostVotedName: string | null;
  murdererName: string | null;
  playerWon: boolean | null;
  characterResults: {
    name: string;
    isMurderer: boolean;
    victoryAchieved: boolean;
    victoryReason: string;
  }[];
}

// ─── 前端展示用 DTO ────────────────────────────────

export interface MessageDTO {
  id: string;
  channelType: ChannelType;
  channelKey: string;
  senderType: SenderType;
  senderId: string;
  senderName: string;
  content: string;
  phase: number;
  createdAt: string;
}

export interface CharacterPublicDTO {
  id: string; // sessionCharacter id 实际为 characterId
  name: string;
  gender?: string | null;
  occupation?: string | null;
  publicProfile: string;
  assignedTo: "PLAYER" | "AI";
}
