// 枚举取值常量（SQLite 以字符串存储，统一在此定义）

export const ScriptType = {
  DEDUCTION: "DEDUCTION", // 推理本
  HARDCORE: "HARDCORE", // 硬核本
  EMOTIONAL: "EMOTIONAL", // 情感本
  COMEDY: "COMEDY", // 欢乐本
  HORROR: "HORROR", // 恐怖本
  RESTORATION: "RESTORATION", // 还原本
} as const;
export type ScriptType = (typeof ScriptType)[keyof typeof ScriptType];

export const ScriptTypeLabel: Record<ScriptType, string> = {
  DEDUCTION: "推理本",
  HARDCORE: "硬核本",
  EMOTIONAL: "情感本",
  COMEDY: "欢乐本",
  HORROR: "恐怖本",
  RESTORATION: "还原本",
};

export const ScriptSource = {
  UPLOAD: "UPLOAD",
  AI_GENERATED: "AI_GENERATED",
  BUILTIN: "BUILTIN",
} as const;
export type ScriptSource = (typeof ScriptSource)[keyof typeof ScriptSource];

export const Difficulty = {
  BEGINNER: "BEGINNER",
  INTERMEDIATE: "INTERMEDIATE",
  HARDCORE: "HARDCORE",
} as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

export const DifficultyLabel: Record<Difficulty, string> = {
  BEGINNER: "新手友好",
  INTERMEDIATE: "进阶",
  HARDCORE: "硬核烧脑",
};

export const ClueType = {
  PHYSICAL: "PHYSICAL",
  TESTIMONY: "TESTIMONY",
  TIMELINE: "TIMELINE",
  SPECIAL: "SPECIAL",
} as const;
export type ClueType = (typeof ClueType)[keyof typeof ClueType];

export const PlayerMode = {
  ROLE_PLAY: "ROLE_PLAY",
  DETECTIVE: "DETECTIVE",
} as const;
export type PlayerMode = (typeof PlayerMode)[keyof typeof PlayerMode];

export const PlayerModeLabel: Record<PlayerMode, string> = {
  ROLE_PLAY: "角色扮演模式",
  DETECTIVE: "侦探模式",
};

export const GameStatus = {
  SETUP: "SETUP",
  IN_PROGRESS: "IN_PROGRESS",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
} as const;
export type GameStatus = (typeof GameStatus)[keyof typeof GameStatus];

export const AssigneeType = {
  PLAYER: "PLAYER",
  AI: "AI",
} as const;
export type AssigneeType = (typeof AssigneeType)[keyof typeof AssigneeType];

export const ChannelType = {
  PUBLIC: "PUBLIC",
  PRIVATE: "PRIVATE",
  DM_BROADCAST: "DM_BROADCAST",
  DM_HINT: "DM_HINT",
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const SenderType = {
  PLAYER: "PLAYER",
  AI_CHARACTER: "AI_CHARACTER",
  DM: "DM",
} as const;
export type SenderType = (typeof SenderType)[keyof typeof SenderType];

// 玩家节奏控制指令
export const PlayerCommand = {
  HINT: "HINT",
  LOWER_DIFFICULTY: "LOWER_DIFFICULTY",
  SKIP_PHASE: "SKIP_PHASE",
  RECAP: "RECAP",
  FOCUS_CHARACTER: "FOCUS_CHARACTER",
  GROUP_DISCUSS: "GROUP_DISCUSS",
} as const;
export type PlayerCommand = (typeof PlayerCommand)[keyof typeof PlayerCommand];

// 公共频道固定 key
export const PUBLIC_CHANNEL_KEY = "public";

// 默认本地用户（V1 单用户，免登录跑通）
export const LOCAL_USER = {
  id: "local-user",
  email: "local@aidm.dev",
  name: "玩家",
};

// 内置剧本库的归属用户（系统账号）。其名下 source=BUILTIN 的剧本对所有用户共享、可直接开局。
export const BUILTIN_USER = {
  id: "builtin-library",
  email: "builtin@aidm.dev",
  name: "内置剧本库",
};
