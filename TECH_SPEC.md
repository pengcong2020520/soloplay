# AI 单人剧本杀游戏 — 技术规格文档 (Tech Spec)

**版本**: v1.7
**日期**: 2026-06-11
**配套文档**: PRD v1.7

### 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-06-07 | 初版技术规划 |
| v1.1 | 2026-06-10 | 第一轮文档更新：校准当前代码基线，明确本地优先 Next.js + Prisma SQLite + Step/Anthropic/mock 架构，移除 Redis/Supabase 作为当前必需依赖的表述 |
| v1.2 | 2026-06-10 | 第二轮文档更新：加入剧本杀桌面 UI、Agent/DM 协同状态、自动讨论、phase director、clue director、线索卡牌堆、Step Plan 模型配置与线索图批量生成架构 |
| v1.3 | 2026-06-10 | 第三轮文档更新：加入阅本阶段主 CTA、非阻塞 ScriptDrawer、玩家手牌分区阅读，以及边读剧本边输入/语音发言的布局约束 |
| v1.4 | 2026-06-10 | 第四轮文档更新：加入玩家 pending 发言队列、TTS 分段完整播放、真实模式禁用固定 mock fallback、角色风格卡与话题去重 |
| v1.4.1 | 2026-06-10 | 第五轮第一遍文档更新：校准当前线索实现，确认现状仍为文本线索 + 前端占位图 + 普通消息展示，缺少媒体字段、线索展示事件和 Agent 稳定感知 |
| v1.5 | 2026-06-10 | 第五轮第二遍文档更新：加入线索资产模型、线索动作 API、Agent 线索展示、Step 图片批量预生成、DM 多模态推进与视频可选占位 |
| v1.5.1 | 2026-06-10 | 补充 Step 默认对话模型推荐：默认使用 `step-3.5-flash-2603`，保留 `step-3.7-flash` 显式配置兼容分支 |
| v1.5.2 | 2026-06-10 | 第六轮第一遍文档更新：校准当前 `phase-director` 主要按消息/线索数量判断阶段进度，缺少举证动作、共识状态与玩家阶段结论 |
| v1.6 | 2026-06-10 | 第六轮第二遍文档更新：加入阶段目标模型、举证动作、共识/分歧状态、阶段结论命令、DM 收束判定和对应 UI |
| v1.6.1 | 2026-06-10 | 开发后校准：记录已落地的 `clue-visuals`、`clue-director`、`clue-action` API、右侧共识板、阶段收敛指令和线索发放回退逻辑 |
| v1.7 | 2026-06-11 | 第七轮文档更新：Vercel 生产数据库切换到 Supabase Postgres；Auth 改为 Supabase Auth 邮箱密码注册/登录；新增 Postgres schema、Vercel build 数据库准备脚本与业务表 RLS 策略 |

> 文档维护规范：每次新增功能或调整整体技术架构前，必须先阅读 PRD 与 Tech Spec；先更新文档以校准当前实现，再将新增功能与架构写入文档；经用户确认后再进入实现。

---

## 一、技术栈选型

### 1.0 当前实现架构基线（v1.1）

当前代码库的实际架构为本地优先单体 Next.js 应用。后续开发应优先遵循本节，而不是早期远期规划中的 Supabase/Redis 架构。

| 层级 | 当前实现 | 说明 |
|------|----------|------|
| 前端框架 | Next.js 14 App Router + React | 主游戏页位于 `app/game/[id]/GameClient.tsx` |
| UI | Tailwind CSS + 本地 `components/ui/*` + lucide-react | 暗色、紧凑、游戏桌面方向 |
| 后端 API | Next.js Route Handlers | `app/api/game/*`、`app/api/audio/*`、`app/api/script/*` |
| 数据库 | Prisma + SQLite / Supabase Postgres | 本地默认 `DATABASE_URL=file:./dev.db`；Vercel 生产使用 Supabase Postgres 与 `prisma/schema.postgres.prisma` |
| 认证 | Supabase Auth + 本地游客模式 + signed cookie | 邮箱注册/登录由 Supabase Auth 处理；业务 Route Handler 继续通过 `aidm_session` cookie 做归属校验 |
| LLM 抽象 | `lib/anthropic.ts` | provider 优先级：Step > Anthropic > mock |
| 语音 | `lib/step-audio.ts` + `/api/audio/tts` + `/api/audio/asr` | Step TTS/ASR，可配置模型 |
| 游戏状态 | Prisma 持久化 + `Message.metadata` + `GameSession.engagementSignals` | 当前不需要 Redis |
| 实时输出 | SSE | `lib/sse.ts` 与 `lib/client/sse-client.ts` |
| Agent 编排 | `lib/game/turn.ts`、`lib/game/conversation-director.ts`、`lib/game/turn-integrity.ts` | 已支持点名回应、回合完整性修复 |
| 阶段配置 | `lib/game/phase-flow.ts`、`lib/game/phase-configs/*` | 各剧本类型阶段流程 |
| Mock 兜底 | 内置剧本 + mock agent 回复 | 无模型密钥也必须可完整运行 |

#### 1.0.2 当前线索与阶段收敛实现状态（v1.6.1）

本轮已将线索和阶段收敛从“普通聊天文本”升级为结构化游戏动作：

- `prisma/schema.prisma` 的 `Script.visualStyle`、`ClueCard.imageUrl/mediaType/videoUrl/visualBatchId/visualPrompt/sequenceIndex/sharePolicy`、`ClueRelease.releasedBy/releaseReason` 已落地。
- `lib/game/clue-visuals.ts` 负责构建统一视觉批次字段；`scripts/generate-local-clue-assets.mts` 为内置剧本生成 `public/generated/clues/<script-slug>/` 下的本地 SVG 线索图。
- `lib/game/clue-director.ts` 负责 `ClueCardDTO`、`ClueActionDTO`、DM 发放 metadata、玩家举证/质询 metadata 和线索回应 directive。
- `app/api/game/[id]/clue-action/route.ts` 已接管玩家公开举证与质询角色；`Message.metadata.clueAction` 会进入公屏证据卡和 `phase-director`。
- `app/api/game/[id]/next-phase/route.ts` 发布线索时会发送带媒体字段的 `CLUE_RELEASED`，并把公屏 DM 文本压缩为摘要。若旧剧本 `releasePhase` 与阶段 trigger 不一致，会发放最早一批未公开线索作为回退。
- `components/game/MessageBubble.tsx` 已根据 `metadata.clueAction`/`metadata.clueRelease` 渲染证据卡；`ClueDeck` 详情改为非阻塞浮层，支持打出与质询。
- `lib/game/phase-director.ts` 已新增 `ConsensusState` 计算，状态包含 `EVIDENCE_NEEDED/CONSENSUS_CHECK/NO_CONSENSUS/CAN_CLOSE`。
- `player-command` 已新增 `REQUEST_CONSENSUS/SUBMIT_PHASE_CONCLUSION/MARK_NO_CONSENSUS/REQUEST_DM_CLOSE`。
- `GameClient` 输入区已新增阶段收敛操作条；`DmHostPanel` 已新增共识板。

后续缺口：

- Agent 主动展示线索目前仍是架构预留，尚未实现完整的 AI 主动 `AGENT_SHOW_PUBLIC` 写库流程。
- Step Image Editor 批量生图尚未接入运行时；当前使用本地 SVG 资产作为可打包、稳定的多模态占位实现。
- 视频线索仍保留 `videoUrl` 字段，不作为当前运行依赖。

#### 1.0.3 Supabase 生产数据与认证基线（v1.7）

- 生产环境数据库使用 Supabase Postgres；本地开发仍默认 SQLite，避免增加本地启动门槛。
- Prisma 保留双 schema：`prisma/schema.prisma` 用于 SQLite，`prisma/schema.postgres.prisma` 用于 Supabase Postgres。
- `postinstall` 与 `vercel:build` 会根据 `DATABASE_URL` / `POSTGRES_*` 自动选择 Prisma schema。
- 邮箱注册/登录通过 Supabase Auth 的 password flow 完成；注册成功后创建或更新 `public."User"` 资料行，且 `User.id = auth.users.id`。
- 项目仍保留游客 `local-user`，未登录用户可试玩；登录用户的数据通过 `userId` 归属隔离。
- `public` 业务表启用 RLS，并按 `auth.uid()` 与 `userId`/所属 session/script 建立 select/insert/update/delete 策略，防止通过 Supabase Data API 越权访问。
- Next.js Route Handlers 仍是游戏状态写入和 Agent 编排的唯一正式入口；Prisma 服务端连接负责复杂事务与剧本杀流程，不直接把核心写操作暴露给浏览器 Data API。

### 1.0.1 当前不引入 Redis 的原则

当前游戏是单人本地会话，短期记忆主要用于“当前局的可复盘状态”和“前端播放/展示队列”。因此：

- 可复盘状态写入 SQLite，例如消息、线索释放、投票、阶段记录。
- 临时播放队列保存在前端内存。
- Agent/DM 的短期运行信号优先放入 `GameSession.engagementSignals` 或 `Message.metadata`。
- 不引入 Redis 作为默认依赖，除非未来出现多实例部署、跨设备实时同步、后台任务队列或多人实时协作。

### 推荐栈（Full-Stack TypeScript，适合 Vibe Coding）

| 层级 | 技术选型 | 选型理由 |
|------|---------|---------|
| **前端框架** | Next.js 14+ (App Router) | 全栈一体，SSR/SSG 灵活，社区最大 |
| **UI 组件** | shadcn/ui + Tailwind CSS | 高质量组件，零配置可用，样式可控 |
| **状态管理** | Zustand | 轻量，适合游戏状态这类复杂局部状态 |
| **后端 API** | Next.js API Routes (Route Handlers) | 与前端同仓库，减少部署复杂度 |
| **实时通信** | Vercel AI SDK Streaming + Server-Sent Events | 流式输出 Agent 回复，体验流畅；私聊用 SSE 多路复用 |
| **LLM 接入** | Anthropic Claude API (claude-sonnet-4-6) | 强角色扮演能力，长上下文支持，工具调用稳定 |
| **数据库** | PostgreSQL (via Supabase) | 托管 Postgres，内置 Auth、Storage、Realtime |
| **ORM** | Prisma | 类型安全，schema-first，迁移管理成熟 |
| **缓存/会话** | Supabase Realtime / Redis (Upstash) | 游戏状态实时同步 |
| **文件存储** | Supabase Storage | 上传剧本 PDF/文档 |
| **认证** | Supabase Auth | 邮箱+OAuth，与数据库集成 |
| **部署** | Vercel | Next.js 原生支持，零配置 |
| **文档解析** | LangChain Document Loaders / pdf-parse | PDF/Word 解析 |

### 为什么选 Claude 而非 GPT-4

- **角色一致性**：角色扮演一致性更强，不易"出戏"——这是沉浸感（体验核心）的技术基础
- **长上下文**：200K token 可承载多角色完整剧本 + 全程对话历史，不需要频繁截断上下文破坏连贯性
- **指令遵循**：工具调用（Tool Use）稳定，适合 DM 结构化指令和结局判定
- **行为边界**：System Prompt 精细控制支持"角色只知道自己的秘密"等信息隔离需求
- **情感表达**：对情感本、恐怖本的语气和氛围营造能力更细腻，直接影响体验质量

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────┐
│                    Next.js App                       │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │   Frontend   │    │      API Routes          │   │
│  │  (React UI)  │◄──►│  /api/game/*             │   │
│  │              │    │  /api/agent/*             │   │
│  │  - 游戏大厅  │    │  /api/script/*            │   │
│  │  - 聊天界面  │    │  /api/user/*              │   │
│  │  - 复盘页面  │    └──────────┬───────────────┘   │
│  └──────────────┘               │                   │
└────────────────────────────────┼───────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼──────┐  ┌───────▼───────┐  ┌──────▼──────┐
    │  Anthropic API  │  │   Supabase    │  │   Upstash   │
    │                 │  │               │  │   Redis     │
    │ - Claude Sonnet │  │ - PostgreSQL  │  │             │
    │   (角色 Agent)  │  │ - Auth        │  │ - 游戏状态  │
    │ - Claude Sonnet │  │ - Storage     │  │ - 消息队列  │
    │   (DM Agent)    │  │ - Realtime    │  │ - 会话缓存  │
    └─────────────────┘  └───────────────┘  └─────────────┘
```

### Agent 实例化架构

```
GameSession
    │
    ├── DM Agent Instance
    │     └── Context: [所有角色剧本] + [游戏状态] + [DM System Prompt]
    │
    ├── Character Agent A (AI)
    │     └── Context: [公共剧本] + [角色A私密剧本] + [角色A System Prompt]
    │
    ├── Character Agent B (AI)
    │     └── Context: [公共剧本] + [角色B私密剧本] + [角色B System Prompt]
    │
    ├── Character Agent C (AI)
    │     └── Context: [公共剧本] + [角色C私密剧本] + [角色C System Prompt]
    │
    └── Player (Human)
          └── 持有：[公共剧本] + [自己角色剧本（角色模式）/ 无剧本（侦探模式）]
```

---

## 三、数据模型

### 3.1 完整 Prisma Schema

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── 用户 ───────────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  avatarUrl     String?
  preferences   UserPreferences?
  createdAt     DateTime  @default(now())

  scripts       Script[]
  gameSessions  GameSession[]
}

model UserPreferences {
  id                    String    @id @default(cuid())
  userId                String    @unique
  user                  User      @relation(fields: [userId], references: [id])

  // 体验偏好（体验最大化的个性化基础）
  preferredScriptTypes  ScriptType[]  // 偏好的剧本类型（按喜好排序）
  preferredDifficulty   Difficulty?   // 难度舒适区（基于历史反馈自动推断）
  preferredDuration     String?       // SHORT / MEDIUM / LONG / ASK_EACH_TIME
  defaultPlayerMode     PlayerMode?   // 默认玩家模式（null = 每次询问）

  // 内容边界（永久生效）
  contentRestrictions   String[]  // 如 ["NO_VIOLENCE", "NO_HORROR", "FAMILY_FRIENDLY"]

  // 体验历史摘要（系统生成）
  experienceSummary     String?   // 如"偏爱多线翻转推理本，情感接受度高"

  // 统计数据（用于推荐）
  totalGamesPlayed      Int       @default(0)
  avgRating             Float?    // 历史平均体验评分
  favoriteElements      String[]  // 如 ["PLOT_TWIST", "CHARACTER_DEPTH", "ATMOSPHERE"]

  updatedAt             DateTime  @updatedAt
}

// ─── 剧本 ───────────────────────────────────────────

model Script {
  id            String      @id @default(cuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id])

  title         String
  scriptType    ScriptType  // 推理/硬核/情感/欢乐/恐怖/还原
  source        ScriptSource // UPLOAD / AI_GENERATED / BUILTIN

  // 公共内容
  publicStory   String      // 公共背景故事
  setting       Json        // 背景设定（时代、地点等）

  // 游戏配置
  characterCount Int
  estimatedDuration Int     // 分钟
  difficulty    Difficulty
  specialMechanics Json?    // 特殊机制配置
  phaseConfig   Json        // 阶段结构配置

  // 生成参数（AI生成时记录）
  generationParams Json?

  characters    Character[]
  clueCards     ClueCard[]
  gameSessions  GameSession[]

  createdAt     DateTime    @default(now())
}

model Character {
  id              String    @id @default(cuid())
  scriptId        String
  script          Script    @relation(fields: [scriptId], references: [id])

  name            String
  gender          String?
  occupation      String?
  publicProfile   String    // 公开性格/背景
  privateStory    String    // 私密剧本全文
  secrets         String    // 秘密列表
  hiddenGoal      String    // 隐藏目标
  victoryCondition String   // 胜利条件
  unknownFacts    String?   // 该角色不知道的信息

  // 角色关系（与其他角色的预设关系）
  relationships   Json?

  isMurderer      Boolean   @default(false)
  isVictim        Boolean   @default(false)

  sessionCharacters SessionCharacter[]
}

model ClueCard {
  id          String    @id @default(cuid())
  scriptId    String
  script      Script    @relation(fields: [scriptId], references: [id])

  title       String
  content     String
  clueType    ClueType  // PHYSICAL / TESTIMONY / TIMELINE / SPECIAL
  releasePhase Int       // 在第几阶段发布（0=立即，1=阶段1，以此类推）
  triggerCondition String? // 触发条件（若非时间触发）
  isSecret    Boolean   @default(false) // 是否为隐藏线索
}

// ─── 游戏会话 ─────────────────────────────────────

model GameSession {
  id            String        @id @default(cuid())
  userId        String
  user          User          @relation(fields: [userId], references: [id])
  scriptId      String
  script        Script        @relation(fields: [scriptId], references: [id])

  playerMode    PlayerMode    // ROLE_PLAY / DETECTIVE
  status        GameStatus    // SETUP / IN_PROGRESS / PAUSED / COMPLETED
  currentPhase  Int           @default(0)
  phaseHistory  Json          @default("[]") // 阶段推进记录

  // 体验自适应状态（DM 用于体验质量监控）
  engagementSignals Json      @default("{}") // 玩家参与度信号记录
  difficultyAdjusted Boolean  @default(false) // 是否已经做过难度调整
  hintsUsed         Int       @default(0)    // 玩家主动请求提示次数

  startedAt     DateTime?
  completedAt   DateTime?
  pausedAt      DateTime?     // 游戏暂停时间（支持继续游戏）
  duration      Int?          // 实际游戏时长（分钟）

  // 体验反馈（游戏结束后填写）
  experienceFeedback Json?    // 评分、最喜欢环节、难度感受等
  experienceTags     String[] // 系统生成的体验标签（如 CLASSIC_TWIST, TEARFUL_ENDING）

  sessionCharacters SessionCharacter[]
  messages          Message[]
  votes             Vote[]
  clueReleases      ClueRelease[]

  createdAt     DateTime      @default(now())
}

model SessionCharacter {
  id            String        @id @default(cuid())
  sessionId     String
  session       GameSession   @relation(fields: [sessionId], references: [id])
  characterId   String
  character     Character     @relation(fields: [characterId], references: [id])

  assignedTo    AssigneeType  // PLAYER / AI

  // AI Agent 状态
  agentContext  Json?         // Agent 当前对话上下文摘要

  // 胜负结果
  victoryAchieved Boolean?
  victoryReason   String?

  @@unique([sessionId, characterId])
}

// ─── 消息 ─────────────────────────────────────────

model Message {
  id            String        @id @default(cuid())
  sessionId     String
  session       GameSession   @relation(fields: [sessionId], references: [id])

  channelType   ChannelType   // PUBLIC / PRIVATE / DM_BROADCAST / DM_HINT
  channelKey    String        // PUBLIC="public", PRIVATE="charA-charB"（按字母序排列）

  senderType    SenderType    // PLAYER / AI_CHARACTER / DM
  senderId      String        // characterId 或 "player" 或 "dm"
  senderName    String

  content       String
  phase         Int           // 发送时的游戏阶段

  isVisible     Boolean       @default(true) // 软删除/隐藏
  metadata      Json?         // 附加信息（如触发的线索ID等）

  createdAt     DateTime      @default(now())
}

// ─── 投票 ─────────────────────────────────────────

model Vote {
  id            String        @id @default(cuid())
  sessionId     String
  session       GameSession   @relation(fields: [sessionId], references: [id])

  voterId       String        // characterId 或 "player"
  voterName     String
  voterType     SenderType

  targetId      String        // 被投票的 characterId
  targetName    String
  reason        String        // 投票理由

  createdAt     DateTime      @default(now())
}

// ─── 线索发布记录 ──────────────────────────────────

model ClueRelease {
  id            String        @id @default(cuid())
  sessionId     String
  session       GameSession   @relation(fields: [sessionId], references: [id])
  clueCardId    String

  releasedAt    DateTime      @default(now())
  phase         Int
}

// ─── 枚举 ─────────────────────────────────────────

enum ScriptType {
  DEDUCTION      // 推理本
  HARDCORE       // 硬核本
  EMOTIONAL      // 情感本
  COMEDY         // 欢乐本
  HORROR         // 恐怖本
  RESTORATION    // 还原本
}

enum ScriptSource {
  UPLOAD
  AI_GENERATED
  BUILTIN
}

enum Difficulty {
  BEGINNER
  INTERMEDIATE
  HARDCORE
}

enum ClueType {
  PHYSICAL
  TESTIMONY
  TIMELINE
  SPECIAL
}

enum PlayerMode {
  ROLE_PLAY
  DETECTIVE
}

enum GameStatus {
  SETUP
  IN_PROGRESS
  COMPLETED
}

enum AssigneeType {
  PLAYER
  AI
}

enum ChannelType {
  PUBLIC
  PRIVATE
  DM_BROADCAST
  DM_HINT
}

enum SenderType {
  PLAYER
  AI_CHARACTER
  DM
}
```

---

## 四、API 接口设计

### 4.1 剧本模块

```
POST   /api/script/upload          上传剧本文件，触发解析
POST   /api/script/generate/start  启动 AI 生成问卷流程
POST   /api/script/generate/answer 提交问卷回答（分步）
POST   /api/script/generate/confirm 确认生成（触发 Claude 生成完整剧本）
GET    /api/script/[id]            获取剧本详情
GET    /api/script/list            获取用户剧本列表
DELETE /api/script/[id]            删除剧本
PATCH  /api/script/[id]            修正解析结果
```

### 4.2 游戏模块

```
POST   /api/game/create            创建游戏会话（绑定剧本+模式）
POST   /api/game/[id]/start        正式开始游戏（DM 分配角色，初始化 Agents）
GET    /api/game/[id]/state        获取当前游戏状态
POST   /api/game/[id]/next-phase   请求 DM 推进到下一阶段（DM 判断是否满足条件）
POST   /api/game/[id]/pause        暂停游戏（保存完整状态）
POST   /api/game/[id]/resume       恢复暂停的游戏
POST   /api/game/[id]/player-command  玩家发出节奏控制指令（提示/降难度/跳过等）
  Body: { command: 'HINT' | 'LOWER_DIFFICULTY' | 'SKIP_PHASE' | 'RECAP' | 'FOCUS_CHARACTER', params?: any }
POST   /api/game/[id]/feedback     提交游戏后体验反馈
GET    /api/game/[id]/recommend    基于本局体验获取下次推荐
GET    /api/game/list              获取历史游戏列表
GET    /api/game/[id]/replay       获取复盘数据
```

### 4.3 消息模块（流式）

```
POST   /api/game/[id]/message      发送消息（返回 SSE 流式 Agent 回复）
  Body: { channelType, channelKey, content }

GET    /api/game/[id]/messages     获取消息历史
  Query: { channelType, channelKey, since }
```

### 4.4 Agent 模块

```
POST   /api/agent/[sessionId]/[characterId]/speak
  触发某个 AI 角色主动发言（DM 调用）

POST   /api/agent/[sessionId]/dm/action
  触发 DM 执行某个动作（发布线索/推进阶段/发出引导）

POST   /api/agent/[sessionId]/vote
  触发所有 AI 角色模拟投票
```

### 4.5 投票模块

```
POST   /api/game/[id]/vote         玩家提交投票
GET    /api/game/[id]/vote/result  获取投票汇总结果（游戏结束后）
```

---

## 五、Agent Prompt 模板规范

### 5.1 角色 Agent System Prompt 模板

```typescript
function buildCharacterSystemPrompt(params: {
  publicStory: string;
  character: Character;
  currentPhase: number;
  phaseDescription: string;
  scriptType: ScriptType;
  playerMode: PlayerMode;       // 新增：玩家模式影响角色对玩家的态度
  scriptTone: string;           // 新增：剧本情感基调影响角色表达风格
}): string {

  // 根据玩家模式生成不同的"对玩家态度"描述
  const playerModeInstruction = params.playerMode === 'DETECTIVE'
    ? `游戏中有一位外来侦探（玩家）正在调查此事。你知道有这位侦探的存在。你对他的配合程度取决于你的角色立场——如果配合有利于你，则适当配合；如果侦探的追问威胁到你的秘密，则采取抵触或回避态度。`
    : `玩家也是游戏中的一个角色，与你平等参与。你可以对他产生怀疑、结盟、试探等真实的角色互动。`;

  // 根据剧本类型调整语言风格
  const toneInstruction: Record<ScriptType, string> = {
    DEDUCTION: '保持冷静理性，措辞精准',
    HARDCORE: '信息密集，表达严谨，情绪克制',
    EMOTIONAL: '情感丰富，表达有层次，可以流露真实情绪',
    COMEDY: '语气轻松，可以带点幽默，不必过于严肃',
    HORROR: '营造紧张感，措辞谨慎，带有一定的恐惧或压迫感',
    RESTORATION: '像在陈述证词，清晰有条理，对时间和细节敏感',
  };

  return `你是一个剧本杀游戏中的角色扮演 AI，你的任务是完全代入以下角色进行游戏。

## 公共背景故事
${params.publicStory}

## 你的角色信息
- **姓名**：${params.character.name}
- **性别**：${params.character.gender}
- **职业**：${params.character.occupation}
- **公开性格与背景**：${params.character.publicProfile}
- **你的私密背景**：${params.character.privateStory}
- **你知道的秘密**：${params.character.secrets}
- **你不知道的信息**：${params.character.unknownFacts}
- **你的隐藏目标**：${params.character.hiddenGoal}
- **你的胜利条件**：${params.character.victoryCondition}

## 对玩家的态度
${playerModeInstruction}

## 行为准则
1. 完全以角色身份说话，绝对不以 AI 身份回应，不打破第四面墙
2. 保护你的秘密——不要主动透露，可以说谎、转移话题、回避
3. 你不知道其他角色的私密信息，只能从对话中推断
4. 情绪和反应必须符合你的角色性格，**语言风格要求：${toneInstruction[params.scriptType]}**
5. 当被追问时，可以选择：部分承认 / 坚决否认 / 反将一军
6. **全程保持角色一致性**：你说过的话、做过的承诺、表明的立场不能无故推翻
7. 回复长度适中，符合当前阶段的对话节奏，不要过度铺陈

## 当前游戏阶段
**阶段 ${params.currentPhase}**：${params.phaseDescription}

请根据阶段要求调整你的发言策略。`;
}
```

### 5.2 DM Agent System Prompt 模板

```typescript
function buildDMSystemPrompt(params: {
  script: Script;
  allCharacters: Character[];
  phaseConfig: PhaseConfig[];
  currentPhase: number;
  gameState: GameState;
}): string {
  const charactersSummary = params.allCharacters.map(c => `
### ${c.name}（${c.isMurderer ? '⚠️ 凶手' : c.isVictim ? '受害者' : '普通角色'}）
- 私密背景：${c.privateStory}
- 秘密：${c.secrets}
- 隐藏目标：${c.hiddenGoal}
- 胜利条件：${c.victoryCondition}
  `).join('\n');

  // DM 风格按剧本类型差异化
  const dmToneGuide: Record<string, string> = {
    DEDUCTION:   '严肃、精准、克制。不渲染情绪，专注于逻辑推进。',
    HARDCORE:    '冷静、信息密集。每次线索发布都要点出其重要性，推动玩家深度思考。',
    EMOTIONAL:   '温柔、有共情感。描述氛围时带情绪色彩，对玩家的情感投入给予回应。',
    COMEDY:      '活泼、带梗、适度幽默。保持游戏轻松感，但不破坏剧情基本逻辑。',
    HORROR:      '营造恐惧氛围，描述细节时制造紧迫感和不安感，适时拉长悬念。',
    RESTORATION: '像记者/法官，强调证据和逻辑，引导玩家关注时间线细节。',
  };

  return `你是剧本杀游戏的 DM（主持人），拥有完整的上帝视角，掌握所有真相。
你的核心使命是：**最大化这位玩家的游戏体验**。

## 完整剧本信息

### 公共背景
${params.script.publicStory}

### 所有角色完整信息（绝密，不可泄露）
${charactersSummary}

## 游戏阶段结构
${params.phaseConfig.map((p, i) => `阶段${i}: ${p.name} - ${p.description}`).join('\n')}

## 你的职责
1. **阶段推进**：按时或按条件宣布进入下一阶段，语气庄重自然
2. **线索发布**：在适当时机发布线索卡，添加符合剧本类型的场景描写
3. **冲突调解**：防止讨论僵局，适时引导方向（不透露答案，用问句引导）
4. **氛围营造**：根据剧本类型维持对应氛围（见下方风格指南）
5. **投票/结局汇总**：收集所有投票或判定结果，公正宣布
6. **信息保护**：确保 AI 角色不意外泄露超出其知识范围的信息

## 体验自适应（核心能力）
你需要持续监测玩家的体验状态，并主动响应：

- **玩家卡顿信号**：连续多轮问题无实质推进，或出现"不知道""没思路"等表达
  → 响应：给出1~2个引导性问题；若仍无进展，主动释放额外线索

- **玩家无聊信号**：快速消耗所有线索，频繁催促进入下一阶段
  → 响应：触发隐藏支线事件或提前释放更深层线索，增加复杂度

- **玩家高度投入**：大量推理性发言，主动私聊多个角色
  → 响应：减少主动干预，让玩家主导节奏，维持沉浸感

- **玩家节奏控制指令**：玩家主动发出 HINT / LOWER_DIFFICULTY / PAUSE / SKIP_PHASE / RECAP / FOCUS_CHARACTER 指令
  → 必须立即响应，优先级高于其他触发条件

## 当前游戏状态
- 当前阶段：${params.currentPhase}
- 玩家模式：${params.gameState.playerMode}
- 体验信号记录：${JSON.stringify(params.gameState.engagementSignals)}
- 已使用提示次数：${params.gameState.hintsUsed}
- 其他状态：${JSON.stringify(params.gameState, null, 2)}

## DM 发言风格
- 使用"【DM】"前缀
- **当前剧本风格要求**：${dmToneGuide[params.script.scriptType]}
- 引导提示时用问句，不给直接答案
- 阶段推进时用正式宣告语气`;
}
```

### 5.3 AI 剧本生成 Prompt 模板

```typescript
function buildScriptGenerationPrompt(params: GenerationParams): string {
  return `你是一位资深剧本杀编剧，请根据以下需求创作一个完整的剧本杀剧本。

## 创作需求
- 剧本类型：${params.scriptType}
- 时代背景：${params.era}
- 地点场景：${params.location}
- 角色数量：${params.characterCount} 人
- 游戏时长：${params.duration}
- 难度：${params.difficulty}
- 线索密度：${params.clueDensity}
- 叙事结构：${params.narrativeStructure}
- 文字风格：${params.writingStyle}
- 情感基调：${params.emotionalTone}
- 主题类型：${params.theme}
- 特殊元素：${params.specialElements.join('、')}
- 翻转设计：${params.twistType}
- 结局类型：${params.endingType}
- 玩家角色身份：${params.playerRoleType}
- 特殊角色要求：${params.customCharacterRequirements || '无'}
- 特殊机制：${params.specialMechanics.join('、')}
- 内容边界：${params.contentRestrictions.join('、')}

## 输出格式（严格按 JSON 格式输出）

{
  "title": "剧本标题",
  "publicStory": "公共背景故事（所有玩家可见，500~800字）",
  "characters": [
    {
      "name": "角色姓名",
      "gender": "性别",
      "occupation": "职业",
      "publicProfile": "公开性格与背景（其他角色可见，100~150字）",
      "privateStory": "私密背景故事（仅本角色可见，300~500字）",
      "secrets": "持有的秘密（列表形式，2~4条）",
      "hiddenGoal": "隐藏目标（游戏中需达成的目标）",
      "victoryCondition": "胜利条件（明确可判定的条件）",
      "unknownFacts": "该角色不知道的关键信息",
      "relationships": {"其他角色名": "与该角色的关系描述"},
      "isMurderer": false,
      "isVictim": false
    }
  ],
  "clueCards": [
    {
      "title": "线索名称",
      "content": "线索内容描述",
      "clueType": "PHYSICAL|TESTIMONY|TIMELINE|SPECIAL",
      "releasePhase": 1,
      "isSecret": false
    }
  ],
  "phaseConfig": [
    {
      "name": "阶段名称",
      "description": "阶段说明",
      "estimatedMinutes": 15,
      "objectives": ["本阶段目标"]
    }
  ],
  "murderSummary": "完整案情真相（仅供DM知晓，含凶手/动机/作案手法/时间线）"
}

## 创作要求
1. 每个角色的胜利条件必须清晰、可判定，不能模糊
2. 凶手必须有完整的作案动机和作案手法
3. 线索必须能指向真相，但不能过于直白
4. 各角色之间必须有合理的关联和冲突点
5. 确保信息量与难度设定一致
6. 玩家角色（角色1）按照"玩家角色身份"要求设计`;
}
```

---

## 六、游戏阶段状态机

### 6.1 状态机设计

```typescript
interface PhaseConfig {
  id: number;
  name: string;
  description: string;
  estimatedMinutes: number;

  // 推进条件（满足任一即可推进）
  advanceConditions: {
    type: 'TIME' | 'PLAYER_ACTION' | 'DM_DECISION';
    value?: any;
  }[];

  // 本阶段 DM 自动触发的动作
  dmTriggers: {
    type: 'RELEASE_CLUE' | 'PROMPT_CHARACTER' | 'BROADCAST' | 'RANDOM_EVENT';
    timing: 'START' | 'MIDDLE' | 'END' | 'STALL' | 'BORED';  // STALL=卡顿, BORED=无聊/推进过快
    config: any;
  }[];

  // 本阶段开放的交互权限
  permissions: {
    publicChat: boolean;
    privateChat: boolean;
    clueInspection: boolean;
    voting: boolean;
  };

  // 玩家节奏控制权（体验最大化关键）
  playerPaceControl: {
    canRequestHint: boolean;       // 是否可请求提示
    canSkipPhase: boolean;         // 是否可请求跳过阶段
    canRequestRecap: boolean;      // 是否可请求剧情回顾
    canFocusCharacter: boolean;    // 是否可请求角色主动接触
  };

  // 难度自适应配置
  adaptiveConfig: {
    stuckThresholdRounds: number;  // 连续几轮无进展触发卡顿干预（默认3）
    boredThresholdRounds: number;  // 连续几轮快速消耗触发无聊干预（默认2）
    extraClueOnStuck: boolean;     // 卡顿时是否自动追加线索
    hiddenEventOnBored: boolean;   // 无聊时是否触发隐藏支线事件
  };
}
```

### 6.2 各剧本类型阶段配置示例（推理本）

```typescript
const DEDUCTION_PHASES: PhaseConfig[] = [
  {
    id: 0,
    name: "阅本阶段",
    description: "玩家阅读角色剧本，熟悉背景",
    estimatedMinutes: 10,
    advanceConditions: [
      { type: 'PLAYER_ACTION', value: 'READY_CONFIRMED' },
      { type: 'TIME', value: 600 }  // 10分钟
    ],
    dmTriggers: [
      { type: 'BROADCAST', timing: 'START', config: { message: '游戏开始，请各位仔细阅读你们的角色剧本...' } }
    ],
    permissions: { publicChat: false, privateChat: false, clueInspection: false, voting: false }
  },
  {
    id: 1,
    name: "入戏自我介绍",
    description: "每个角色依次进行角色介绍",
    estimatedMinutes: 10,
    advanceConditions: [
      { type: 'PLAYER_ACTION', value: 'ALL_INTRODUCED' },
      { type: 'TIME', value: 600 }
    ],
    dmTriggers: [
      { type: 'PROMPT_CHARACTER', timing: 'START', config: { order: 'sequential' } }
    ],
    permissions: { publicChat: true, privateChat: false, clueInspection: false, voting: false }
  },
  {
    id: 2,
    name: "自由交流阶段",
    description: "自由讨论，私聊开放",
    estimatedMinutes: 20,
    advanceConditions: [
      { type: 'TIME', value: 1200 },
      { type: 'DM_DECISION' }
    ],
    dmTriggers: [
      { type: 'BROADCAST', timing: 'STALL', config: { message: '大家不妨思考一下：案发当晚，每个人究竟在哪里？' } }
    ],
    permissions: { publicChat: true, privateChat: true, clueInspection: false, voting: false }
  },
  {
    id: 3,
    name: "独立搜证阶段",
    description: "DM 发布线索卡，各方分析",
    estimatedMinutes: 20,
    advanceConditions: [
      { type: 'TIME', value: 1200 },
      { type: 'PLAYER_ACTION', value: 'CLUES_REVIEWED' }
    ],
    dmTriggers: [
      { type: 'RELEASE_CLUE', timing: 'START', config: { phase: 1, batchSize: 3 } },
      { type: 'RELEASE_CLUE', timing: 'MIDDLE', config: { phase: 1, batchSize: 2 } }
    ],
    permissions: { publicChat: true, privateChat: true, clueInspection: true, voting: false }
  },
  {
    id: 4,
    name: "公开质询阶段",
    description: "任意角色可对其他角色提出质疑",
    estimatedMinutes: 15,
    advanceConditions: [
      { type: 'TIME', value: 900 },
      { type: 'DM_DECISION' }
    ],
    dmTriggers: [
      { type: 'BROADCAST', timing: 'STALL', config: { message: '目前有几个时间点尚存疑问，大家可以重点关注...' } }
    ],
    permissions: { publicChat: true, privateChat: true, clueInspection: true, voting: false }
  },
  {
    id: 5,
    name: "最终陈词",
    description: "每个角色发表最终陈词",
    estimatedMinutes: 10,
    advanceConditions: [
      { type: 'PLAYER_ACTION', value: 'ALL_STATED' },
      { type: 'TIME', value: 600 }
    ],
    dmTriggers: [
      { type: 'PROMPT_CHARACTER', timing: 'START', config: { order: 'sequential', prompt: '请发表你的最终陈词' } }
    ],
    permissions: { publicChat: true, privateChat: false, clueInspection: true, voting: false }
  },
  {
    id: 6,
    name: "投票指凶",
    description: "提交最终投票",
    estimatedMinutes: 5,
    advanceConditions: [
      { type: 'PLAYER_ACTION', value: 'ALL_VOTED' }
    ],
    dmTriggers: [
      { type: 'BROADCAST', timing: 'START', config: { message: '投票时刻到来，请各位提交你认为的凶手...' } }
    ],
    permissions: { publicChat: false, privateChat: false, clueInspection: false, voting: true }
  },
  {
    id: 7,
    name: "复盘揭秘",
    description: "真相揭示，胜负宣判",
    estimatedMinutes: 10,
    advanceConditions: [],
    dmTriggers: [
      { type: 'BROADCAST', timing: 'START', config: { message: '现在，揭开真相的时刻到了...' } }
    ],
    permissions: { publicChat: true, privateChat: false, clueInspection: true, voting: false }
  }
];
```

---

## 七、实时通信方案

### 7.1 选型：Server-Sent Events (SSE) + Polling

**为什么不用 WebSocket**：
- Next.js + Vercel Serverless 环境下 WebSocket 支持复杂
- SSE 足够覆盖服务器→客户端的流式推送需求（AI 回复流式输出）
- 客户端→服务器用 HTTP POST，简单可靠

### 7.2 SSE 事件类型

```typescript
type GameEvent =
  | { type: 'MESSAGE_STREAM'; chunk: string; messageId: string; sender: SenderInfo }
  | { type: 'MESSAGE_COMPLETE'; messageId: string; fullContent: string }
  | { type: 'PHASE_CHANGED'; newPhase: number; phaseName: string; dmAnnouncement: string }
  | { type: 'CLUE_RELEASED'; clueCard: ClueCard; dmDescription: string }
  | { type: 'PRIVATE_CHAT_INDICATOR'; participants: string[] }  // 通知玩家有私聊发生（不透露内容）
  | { type: 'VOTE_SUBMITTED'; voterName: string }              // 告知某人已投票
  | { type: 'VOTE_RESULT'; results: VoteResult[] }
  | { type: 'GAME_COMPLETED'; outcome: GameOutcome }
  | { type: 'DM_HINT'; content: string }
```

### 7.3 SSE 接口

```
GET /api/game/[id]/stream
  - 返回 SSE 流
  - 玩家订阅此流接收所有公开事件

GET /api/game/[id]/stream/private/[channelKey]
  - 私聊频道的 SSE 流
  - 仅双方可订阅
```

---

## 八、剧本解析流程

### 8.1 上传剧本解析流程

```
用户上传文件
    │
    ▼
文件格式检测 + 转换为纯文本
    │
    ▼
Claude API 解析（结构化提取）
  Prompt: "从以下剧本文本中提取结构化信息，输出 JSON..."
    │
    ▼
解析结果返回前端
    │
    ▼
用户确认/修正界面
  - 可修改各角色信息
  - 可标注未识别内容
    │
    ▼
保存到数据库
```

### 8.2 文件解析技术

```typescript
// 支持的格式和对应解析库
const parsers = {
  'application/pdf': parsePDF,        // pdf-parse
  'text/plain': parseText,             // 直接读取
  'text/markdown': parseMarkdown,      // marked
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': parseDocx,  // mammoth
};

async function parseScriptFile(file: File): Promise<string> {
  const parser = parsers[file.type];
  if (!parser) throw new Error('Unsupported file format');
  return parser(file);
}
```

---

## 九、项目目录结构

```
aidm/
├── app/                          # Next.js App Router
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (game)/
│   │   ├── lobby/page.tsx        # 游戏大厅（选剧本/模式）
│   │   ├── setup/page.tsx        # 剧本设置（问卷/上传）
│   │   ├── game/[id]/page.tsx    # 游戏主界面
│   │   └── replay/[id]/page.tsx  # 复盘界面
│   ├── api/
│   │   ├── script/
│   │   │   ├── upload/route.ts
│   │   │   └── generate/
│   │   │       ├── start/route.ts
│   │   │       ├── answer/route.ts
│   │   │       └── confirm/route.ts
│   │   ├── game/
│   │   │   ├── create/route.ts
│   │   │   └── [id]/
│   │   │       ├── start/route.ts
│   │   │       ├── state/route.ts
│   │   │       ├── message/route.ts
│   │   │       ├── stream/route.ts
│   │   │       ├── next-phase/route.ts
│   │   │       ├── vote/route.ts
│   │   │       └── replay/route.ts
│   │   └── agent/
│   │       └── [sessionId]/
│   │           ├── [characterId]/speak/route.ts
│   │           ├── dm/action/route.ts
│   │           └── vote/route.ts
│   └── layout.tsx
│
├── components/
│   ├── game/
│   │   ├── ChatPanel.tsx         # 主聊天面板
│   │   ├── PublicChannel.tsx     # 公共频道
│   │   ├── PrivateChannel.tsx    # 私聊频道
│   │   ├── DMPanel.tsx           # DM 提示面板
│   │   ├── PhaseIndicator.tsx    # 阶段进度指示
│   │   ├── CharacterList.tsx     # 角色列表/状态
│   │   ├── ClueBoard.tsx         # 线索板
│   │   └── VotePanel.tsx         # 投票面板
│   ├── setup/
│   │   ├── ScriptUploader.tsx
│   │   ├── GenerationWizard.tsx  # 分步问卷
│   │   └── ScriptPreview.tsx
│   └── replay/
│       ├── TimelineView.tsx
│       ├── CharacterReveal.tsx
│       └── VoteResult.tsx
│
├── lib/
│   ├── agents/
│   │   ├── character-agent.ts    # 角色 Agent 核心逻辑
│   │   ├── dm-agent.ts           # DM Agent 核心逻辑
│   │   └── prompts/
│   │       ├── character.ts      # 角色 prompt 模板
│   │       ├── dm.ts             # DM prompt 模板
│   │       └── generation.ts     # 剧本生成 prompt
│   ├── game/
│   │   ├── phase-engine.ts       # 阶段状态机
│   │   ├── vote-engine.ts        # 投票汇总逻辑
│   │   └── phase-configs/        # 各类型剧本阶段配置
│   │       ├── deduction.ts
│   │       ├── hardcore.ts
│   │       ├── emotional.ts
│   │       ├── comedy.ts
│   │       ├── horror.ts
│   │       └── restoration.ts
│   ├── parsers/
│   │   ├── pdf.ts
│   │   ├── docx.ts
│   │   └── script-extractor.ts   # Claude 解析剧本
│   ├── db/
│   │   └── prisma.ts             # Prisma client singleton
│   └── anthropic.ts              # Anthropic client singleton
│
├── stores/
│   └── game-store.ts             # Zustand 游戏状态
│
├── prisma/
│   └── schema.prisma
│
├── types/
│   └── game.ts                   # 全局类型定义
│
└── .env.local
    # ANTHROPIC_API_KEY=
    # DATABASE_URL=
    # NEXT_PUBLIC_SUPABASE_URL=
    # NEXT_PUBLIC_SUPABASE_ANON_KEY=
    # UPSTASH_REDIS_URL=
```

---

## 十、关键实现注意事项

### 10.1 Agent 上下文管理

```typescript
// 角色 Agent 对话历史管理
// Claude 支持 200K token，但要控制历史长度
const MAX_HISTORY_MESSAGES = 50;

function trimHistory(messages: Message[]): Message[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  // 保留系统 prompt + 最近 N 条消息
  return messages.slice(-MAX_HISTORY_MESSAGES);
}
```

### 10.2 并发 Agent 调用

- 当需要多个 AI 角色同时响应时（如轮流自我介绍），使用 `Promise.allSettled` 并行调用
- 控制并发数量避免触发 API rate limit（建议最大并发 3 个 Agent 同时调用）
- 使用 `p-limit` 库控制并发

### 10.3 信息隔离保障

```typescript
// 关键：角色 Agent 初始化时严格隔离上下文
function initCharacterAgent(character: Character, publicStory: string) {
  // 只注入该角色自己的信息，不引入其他角色私密内容
  const systemPrompt = buildCharacterSystemPrompt({
    publicStory,
    character: {
      ...character,
      // 明确不传递其他角色信息
    }
  });
  return new AnthropicAgent({ systemPrompt });
}
```

### 10.4 剧本生成的 JSON 可靠性

- 使用 Claude 的 Tool Use / Structured Output 确保 JSON 格式正确
- 添加 JSON Schema 校验
- 生成失败时有重试逻辑（最多3次）

### 10.5 私聊的存储与权限

```typescript
// channelKey 统一格式：按 ID 字母序排列，确保双向一致
function getPrivateChannelKey(id1: string, id2: string): string {
  return [id1, id2].sort().join('-');
}

// 查询权限校验：只有频道参与者或游戏结束后才能查看私聊记录
function canViewPrivateChannel(
  requesterId: string,
  channelKey: string,
  gameStatus: GameStatus
): boolean {
  if (gameStatus === 'COMPLETED') return true;  // 复盘阶段全开放
  return channelKey.includes(requesterId);       // 仅参与者可看
}
```

---

## 十一、v1.2 新增架构设计

### 11.1 模块总览

新增能力围绕“剧本杀桌面 + DM 自动控场 + 线索卡牌化”展开。模块边界如下：

```text
app/game/[id]/GameClient.tsx
  ├─ components/game/AgentStatusRail.tsx     DM/Agent 协同状态
  ├─ components/game/DmHostPanel.tsx         DM 主持台
  ├─ components/game/ClueDeck.tsx            右侧线索牌堆
  ├─ components/game/PlayerHand.tsx          底部玩家手牌
  ├─ components/game/ScriptDrawer.tsx        常驻剧本抽屉
  └─ components/game/ActionPanel.tsx         阶段操作按钮

lib/game/
  ├─ phase-director.ts                       阶段目标、收束、自动推进
  ├─ conversation-director.ts                Agent 接话规划
  ├─ clue-director.ts                        线索可见性、打出、讨论触发
  ├─ clue-visuals.ts                         视觉圣经、线索图批次生成
  ├─ turn.ts                                 角色/DM 发言生成与落库
  └─ turn-integrity.ts                       发言完整性修复
```

### 11.2 协同状态事件模型

SSE 事件需要扩展为可表达过程状态，而不仅是最终消息：

```typescript
type AgentRuntimeStatus =
  | "IDLE"
  | "LISTENING"
  | "PLANNED"
  | "THINKING"
  | "SPEAKING"
  | "RESPONDED"
  | "WAITING_PLAYER";

type GameEvent =
  | { type: "AGENT_STATUS_CHANGED"; agentId: string; agentName: string; status: AgentRuntimeStatus; reason?: string }
  | { type: "DM_PHASE_ASSESSMENT"; status: "RUNNING" | "EVIDENCE_NEEDED" | "CONSENSUS_CHECK" | "NO_CONSENSUS" | "WAITING_PLAYER" | "CAN_CLOSE" | "CLOSING"; summary: string; checklist: PhaseChecklistItem[]; consensus?: ConsensusState }
  | { type: "DISCUSSION_MODE_CHANGED"; enabled: boolean; reason?: string }
  | { type: "MESSAGE_STREAM"; ... }
  | { type: "MESSAGE_COMPLETE"; ... };
```

第一版可不新增表结构，运行状态由后端 SSE 推送、前端内存展示；需要复盘的状态摘要写入 `GameSession.engagementSignals`。

### 11.3 Phase Director

`phase-director.ts` 负责 DM 自动控场：

```typescript
interface PhaseDirectorState {
  phase: number;
  status: "RUNNING" | "EVIDENCE_NEEDED" | "CONSENSUS_CHECK" | "NO_CONSENSUS" | "WAITING_PLAYER" | "CAN_CLOSE" | "CLOSING";
  focusTopic?: string;
  requiredEvents: PhaseEventCheck[];
  optionalEvents: PhaseEventCheck[];
  pendingPlayerAction?: PlayerActionType;
  nextAction: "CONTINUE_DISCUSSION" | "REQUEST_EVIDENCE" | "CHECK_CONSENSUS" | "WAIT_PLAYER" | "RELEASE_CLUE" | "ADVANCE_PHASE";
  consensus: ConsensusState;
}

interface ConsensusState {
  status: "NONE" | "EMERGING" | "AGREED" | "DISPUTED" | "NO_CONSENSUS";
  agreedPoints: string[];
  disputedPoints: string[];
  openQuestions: string[];
  playerConclusion?: string;
  lastCheckedAt?: string;
}

interface PhaseObjective {
  kind: "OPENING" | "EVIDENCE" | "DEBATE" | "CONSENSUS" | "PLAYER_CONCLUSION" | "DECISION";
  label: string;
  required: boolean;
  done: boolean;
}
```

输入：

- 当前会话、阶段配置、公开消息、线索释放记录、玩家操作记录。

输出：

- 是否继续自动讨论。
- 是否等待玩家。
- 是否发布/要求展示线索。
- 当前是否需要举证。
- 当前是否已经形成共识、明确分歧或需要玩家提交结论。
- 是否自动进入下一阶段。

v1.6 判定规则：

- 普通开放阶段不再仅凭 `publicMessages >= 5` 收束。
- 举证/搜证/质询/推理阶段至少需要一次线索动作进入本阶段记录，或 DM 明确判断本阶段无需新增线索。
- 如果存在 `consensus.status === "DISPUTED"` 且玩家未选择“无法达成共识”，DM 不应直接推进；应要求补充证据或点名相关角色回应。
- 如果玩家提交 `playerConclusion`，DM 应优先围绕该结论判定：支持、缺证据、偏离阶段议题或可带着分歧推进。
- `CAN_CLOSE` 的条件应改为：关键目标完成，且 `AGREED` / `NO_CONSENSUS` / `playerConclusion` 至少满足其一。

### 11.4 自动讨论循环

自动讨论不应简单无限循环，而应由 `phase-director` 与 `conversation-director` 共同控制：

```text
玩家/阶段事件
  → phase-director 判断当前阶段目标
  → conversation-director 规划 2-4 位 Agent
  → turn.ts 逐个生成并推送状态
  → TTS 队列逐条展示
  → phase-director 再判断继续/等待/推进
```

前端需要提供“自动讨论：开启/暂停”控制。默认开启，但当出现 `WAITING_PLAYER` 时自动暂停，避免 Agent 自说自话。

v1.6 自动讨论循环加入共识检查：

```text
一轮 Agent 讨论结束
  → phase-director 提取候选共识/分歧
  → 若缺少证据：状态 EVIDENCE_NEEDED，提示玩家或 Agent 举证
  → 若出现稳定共识：状态 CONSENSUS_CHECK，询问玩家是否认可
  → 若持续冲突：状态 NO_CONSENSUS，展示分歧点并给出补线索/继续质询/带着分歧推进选项
  → 若玩家提交结论：DM 判定是否 CAN_CLOSE
```

### 11.5 Clue Director 与线索卡

`clue-director.ts` 管理线索对象的可见性和交互：

```typescript
interface ClueRuntimeView {
  clueId: string;
  owner: "DM" | "PLAYER" | "PUBLIC";
  visibility: "PRIVATE" | "PUBLIC" | "REVEALED_TO_CHARACTER";
  playedAtMessageId?: string;
  targetCharacterId?: string;
  discussionStatus: "UNSEEN" | "PLAYED" | "DISCUSSED";
}
```

v1.5 需要新增结构化线索动作，而不是复用普通聊天消息：

```typescript
type ClueActionType =
  | "DM_RELEASE"
  | "PLAYER_SHOW_PUBLIC"
  | "PLAYER_QUESTION_CHARACTER"
  | "AGENT_SHOW_PUBLIC"
  | "AGENT_QUESTION_CHARACTER";

interface ClueActionPayload {
  clueId: string;
  actionType: ClueActionType;
  actorType: "DM" | "PLAYER" | "AI_CHARACTER";
  actorId: string;
  targetCharacterId?: string;
  question?: string;
  visibility: "PUBLIC" | "PRIVATE";
}

interface ClueActionResult {
  messageId: string;
  clue: ClueCardDTO;
  preferredResponderIds: string[];
  publicSummary: string;
}
```

线索打出流程：

```text
玩家点击线索
  → 选择 展示给大家 / 质询角色 / 私下展示
  → POST /api/game/[id]/clue-action
  → clue-director 校验线索已发布、动作可用、目标合法
  → 写入结构化 Message.metadata.clueAction
  → SSE 推送 CLUE_PLAYED / MESSAGE_COMPLETE
  → 公屏展示线索卡消息，而不是纯文本气泡
  → conversation-director 优先安排相关 Agent 回应
  → phase-director 记录阶段目标进度
```

Agent 主动展示线索流程：

```text
phase/conversation director 判断当前讨论卡住或某角色需要举证
  → 选择一张已公开线索
  → streamCharacterTurn 指令中要求角色拿这张线索说话
  → clue-director 写入 AGENT_SHOW_PUBLIC 或 AGENT_QUESTION_CHARACTER
  → 目标角色优先回应，其他角色可接话
```

约束：

- 未发布线索不能被玩家或 Agent 展示。
- 隐藏线索只有 DM 释放后才可进入公共线索池。
- 一张线索可重复被引用，但同一阶段内不要无意义重复展示。
- 公屏消息必须能渲染为“线索卡消息”，并携带图片、标题、摘要、展示者和目标角色。

### 11.6 线索图片批量生成

`clue-visuals.ts` 不允许单张线索独立生成互不相关的图。每个剧本先生成视觉批次：

```typescript
interface ScriptVisualBible {
  styleId: string;
  era: string;
  location: string;
  palette: string[];
  lighting: string;
  compositionRules: string;
  recurringSymbols: string[];
  negativePrompt: string;
}

interface ClueImageBatch {
  batchId: string;
  scriptId: string;
  model: string; // step-image-edit-2
  storyboard: { clueId: string; sequenceIndex: number; framePrompt: string; storyLink: string }[];
  contactSheetUrl?: string;
}
```

Step Plan 图片接口：

- 文生图路径：`POST ${STEP_BASE_URL}/images/generations`
- 图片编辑路径：`POST ${STEP_BASE_URL}/images/edits`
- 默认模型：`STEP_IMAGE_MODEL=step-image-edit-2`
- 本轮默认只使用文生图生成预置资产；图片编辑用于后续重绘/局部修正。
- 官方当前只确认图片生成/编辑接口，视频生成不作为 V1.5 运行时依赖。

生成策略：

1. 由剧本内容生成 `ScriptVisualBible`。
2. 根据线索链路生成 storyboard。
3. 优先生成一张 contact sheet，随后裁切为单张线索图。
4. 若接口每次只稳定返回单张图，则先生成“风格母版/封面图”，再用同一视觉圣经、同一 seed 策略和 storyboard 顺序生成单张图；该降级路径仍必须保留批次 ID 与统一风格约束。
5. 裁切或单张生成后的图片写入本地静态目录 `public/generated/clues/<script-slug>/`。
6. 将 `imageUrl`、`mediaType`、`visualBatchId`、`sequenceIndex` 写入 `ClueCard`。
7. 若重生成某张，必须带上同一视觉圣经和原批次上下文。

建议新增模块：

```text
lib/game/clue-director.ts
  - buildClueActionMessage()
  - resolveClueResponders()
  - pickAgentClueAction()

lib/game/clue-visuals.ts
  - buildScriptVisualBible()
  - buildClueStoryboard()
  - generateClueImageBatch()
  - ensureBuiltinClueAssets()

lib/step-image.ts
  - generateImage()
  - editImage()
  - saveGeneratedImage()

scripts/generate-clue-assets.ts
  - 为内置测试剧本预生成图片资产，写入 public/generated/clues
```

数据模型增量：

```prisma
model Script {
  visualStyle      String? // JSON: ScriptVisualBible
}

model ClueCard {
  imageUrl         String?
  mediaType        String  @default("image") // image / video / none
  videoUrl         String?
  visualBatchId    String?
  visualPrompt     String?
  sequenceIndex    Int?
  sharePolicy      String  @default("PUBLIC_AFTER_RELEASE") // JSON 或枚举字符串
}

model ClueRelease {
  releasedBy       String  @default("DM")
  releaseReason    String?
}
```

SQLite 迁移时保持本地优先，不引入外部对象存储；图片使用相对 URL 存储，便于 zip 打包。

SSE 事件增量：

```typescript
type GameEvent =
  | { type: "CLUE_RELEASED"; clueCard: ClueCardDTO; dmDescription: string }
  | { type: "CLUE_PLAYED"; clueCard: ClueCardDTO; action: ClueActionDTO; messageId: string };

interface ClueCardDTO {
  id: string;
  title: string;
  content: string;
  clueType: ClueType;
  imageUrl?: string | null;
  mediaType?: "image" | "video" | "none";
  videoUrl?: string | null;
}

interface ClueActionDTO {
  actionType: ClueActionType;
  actorType: "DM" | "PLAYER" | "AI_CHARACTER";
  actorId: string;
  actorName: string;
  targetCharacterId?: string;
  targetCharacterName?: string;
  question?: string;
  visibility: "PUBLIC" | "PRIVATE";
}
```

前端渲染增量：

- `ClueDeck`：继续负责右侧重叠牌堆，但详情页需要提供“展示给大家”“质询角色”两个动作。
- `MessageBubble` 或新增 `ClueMessageCard`：根据 `Message.metadata.clueAction` 渲染公屏线索卡。
- `PlayerHand`：玩家自己的线索卡点击后不直接发送普通文本，而是打开动作选择。
- `AgentStatusRail`：当 Agent 因线索被点名时显示“查看线索/准备回应”。

DM 多模态推进：

```text
next-phase 发布线索
  → save ClueRelease
  → save DM 摘要消息 metadata.clueRelease
  → send CLUE_RELEASED(含 imageUrl)
  → 前端右侧线索牌翻开/高亮
  → TTS 播报“发布新线索：标题 + 一句摘要”
```

公屏不再刷完整线索正文，完整内容在右侧线索区和线索卡详情中保留。

### 11.6.1 阶段举证、共识板与收束判定（v1.6）

新增 `phase-director` 子能力：

```text
lib/game/phase-director.ts
  - assessPhaseProgress()
  - extractConsensusState()
  - classifyPhaseObjectiveProgress()
  - buildPhaseCloseDecision()
```

`extractConsensusState()` 第一版可以用规则 + LLM 摘要混合：

1. 读取本阶段公开消息、线索动作、DM 发言和玩家结论。
2. 优先从结构化 `Message.metadata` 中读取：
   - `clueAction`
   - `phaseConclusion`
   - `consensusCheck`
   - `noConsensusMarker`
3. 若结构化信息不足，再调用 summarizer/DM 轻量总结，输出：
   - `agreedPoints`
   - `disputedPoints`
   - `openQuestions`
   - `recommendedNextAction`

新增消息 metadata：

```typescript
interface PhaseConclusionMetadata {
  kind: "phaseConclusion";
  conclusion: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH";
  relatedClueIds?: string[];
}

interface ConsensusCheckMetadata {
  kind: "consensusCheck";
  requestedBy: "PLAYER" | "DM";
  agreedPoints: string[];
  disputedPoints: string[];
  openQuestions: string[];
}

interface NoConsensusMetadata {
  kind: "noConsensus";
  reason: string;
  disputedPoints: string[];
}
```

`player-command` 新增命令：

```typescript
type PlayerCommand =
  | "REQUEST_CONSENSUS"
  | "SUBMIT_PHASE_CONCLUSION"
  | "MARK_NO_CONSENSUS"
  | "REQUEST_DM_CLOSE";
```

处理策略：

- `REQUEST_CONSENSUS`：DM 输出当前共识/分歧/待核查，并推送 `DM_PHASE_ASSESSMENT`。
- `SUBMIT_PHASE_CONCLUSION`：保存玩家阶段结论，DM 判定是否推进、补线索或点名质询。
- `MARK_NO_CONSENSUS`：保存分歧状态，DM 决定“补证据/继续质询/带着分歧进入下一阶段”。
- `REQUEST_DM_CLOSE`：不是强制推进；调用 `buildPhaseCloseDecision()`，由 DM 给出推进或继续行动理由。

阶段配置增量：

```typescript
interface PhaseConfig {
  phaseObjectives?: {
    kind: "EVIDENCE" | "DEBATE" | "CONSENSUS" | "PLAYER_CONCLUSION";
    label: string;
    required: boolean;
    minClueActions?: number;
    minAgentTurns?: number;
    requiresPlayerConclusion?: boolean;
  }[];
}
```

第一版可以不立刻迁移所有剧本阶段，只在运行时按阶段名称推断默认目标：

| 阶段关键词 | 默认目标 |
|------|------|
| 自由交流/讨论 | 至少一轮交锋 + 玩家参与 + 可选共识检查 |
| 搜证/线索 | 至少一次线索展示/讨论 + 玩家查看或提交线索判断 |
| 质询/对质 | 至少一次指定角色质询 + 分歧点明确 |
| 推理/时间线 | 玩家提交阶段结论或时间线片段 |
| 最终陈词 | 顺序发言完成后自动进入投票 |

前端 UI 增量：

- `DmHostPanel`：新增“阶段议题”“共识板”“分歧点”“待核查”四块。
- `AgentStatusRail`：当状态为 `EVIDENCE_NEEDED` 时显示“需要举证”，当 `CONSENSUS_CHECK` 时显示“等待确认共识”。
- `PlayerHand` 或新增 `ActionPanel`：显示 `[展示线索] [用线索质询] [请求共识检查] [提交阶段结论] [标记无法达成共识] [请求 DM 收束]`。
- 公屏只显示阶段结论摘要；共识板详情留在右侧，避免刷屏。

Prompt 增量：

- DM prompt 必须知道“收束不是总结聊天，而是判断阶段目标是否达成”。
- Character directive 在举证阶段必须围绕具体线索回应，不允许泛泛表达怀疑。
- 当角色被线索质询时，优先回应线索事实，再进行辩解、反驳或转移。

测试资产范围：

- `public/generated/clues/zero-cabin-paradox/`：为《零号舱的悖论》生成 5 张图。
- `public/generated/clues/misty-manor/`：为《雾港庄园谋杀案》生成 5-6 张图。
- 若运行环境没有 `STEP_API_KEY`，seed/内置剧本仍引用这些已生成静态图，不触发运行时生图。

### 11.7 桌面 UI 组件

新增组件职责：

| 组件 | 职责 |
|------|------|
| `AgentStatusRail` | 左侧展示 DM/Agent 状态、准备中、发言中、等待玩家 |
| `ClueDeck` | 右侧重叠线索牌堆，hover 上浮、click 详情 |
| `PlayerHand` | 底部身份卡、私密目标、玩家线索、可用行动 |
| `ScriptDrawer` | 非阻塞剧本阅读面板，不离开公屏，不阻断文字/语音输入 |
| `ActionPanel` | 按阶段展示按钮式操作 |

### 11.7.1 阅本阶段开始入口（v1.3）

`GameClient.tsx` 需要在 `currentPhase === 0` 或阶段名包含“阅本”时，在聊天主区域渲染一个主 CTA：

```tsx
<ReadingStartCard
  disabled={busy || speechActive}
  onStart={() => advancePhase()}
/>
```

约束：

- CTA 文案为“游戏开始”，位于中间主游戏区。
- 点击后走现有 `/api/game/[id]/next-phase`，不新增独立 API。
- 左侧 `StageControlPanel` 的“应急推进”继续保留，但不是阅本完成的主要入口。
- CTA 不应出现在投票、复盘或其他阶段。

### 11.7.2 非阻塞随身剧本手册（v1.3）

`ScriptDrawer` 从全屏 modal 改为 fixed dock panel：

```tsx
<div className="pointer-events-none fixed inset-0 z-40">
  <aside className="pointer-events-auto ...">
    ...
  </aside>
</div>
```

实现约束：

- 不渲染遮罩，不阻断底部 composer、麦克风按钮与发送按钮。
- 面板位置避开底部输入区与玩家手牌区：桌面 `top-16 bottom-36`，移动端也必须保留输入区可点击。
- `PlayerHand` 的卡片点击不再统一打开完整剧本，而是传入分区参数：

```ts
type ScriptReaderSection = "overview" | "profile" | "private" | "secret" | "goal" | "story";
onOpenScript(section: ScriptReaderSection): void
```

- `ScriptDrawer` 内部提供分区切换按钮；分区切换只改变阅读内容，不改聊天 tab、不清空输入、不影响 TTS/ASR。

### 11.7.3 自由讨论插话 composer（v1.3）

公共聊天 composer 的可编辑状态只由阶段权限和游戏结束状态决定：

```ts
const composerLocked = !canChat || completed;
```

`busy` 与 `speechActive` 不得禁用 textarea 或麦克风按钮。玩家发送插话时：

- 不调用 `stopTtsPlayback()`，不得打断当前角色语音。
- 暂缓当前自动续聊计时器；输入、录音、转写、pending 期间都不触发新一轮自动讨论，但不关闭 `autoDiscussionEnabled`，避免玩家发言后退回“一步一聊”。
- 将消息放入 `pendingPlayerMessage`，等待 `speechActive === false && busy === false` 后再正式提交。
- 等待期间在 composer 附近展示转圈状态，例如“等待上一位发言结束…”，并允许玩家取消待发送。

### 11.7.4 玩家待发送队列（v1.4）

`GameClient.tsx` 新增状态：

```ts
type PendingPlayerMessage = {
  id: string;
  content: string;
  createdAt: number;
  source: "text" | "asr";
};

const [pendingPlayerMessage, setPendingPlayerMessage] = useState<PendingPlayerMessage | null>(null);
const [playerSending, setPlayerSending] = useState(false);
```

发送流程：

1. `sendMessage()` 不直接 `postSse`。
2. 若 `busy || speechActive`，则写入 `pendingPlayerMessage` 并清空输入框。
3. ASR 识别成功后调用同一套 `queueOrSubmitPlayerMessage(text, "asr")`；若已有文字草稿，则合并后作为一条发言处理。
4. 一个 `useEffect` 监听 `pendingPlayerMessage / busy / speechActive`。
5. 当 `!busy && !speechActive` 时调用 `submitPlayerMessage(content)`。
6. `submitPlayerMessage` 内部才调用 `/api/game/[id]/message`，让该句成为后续 Agent 的上下文。

### 11.7.5 TTS 分段完整播放（v1.4）

`lib/step-audio.ts` 不再把文本直接 `slice(0, TTS_MAX_CHARS)` 后丢弃后文。改为：

- 新增 `splitTtsText(text, maxChars)`，按中文/英文句末标点切分。
- `/api/audio/tts` 仍一次只合成一个片段，保持接口简单。
- `components/game/tts-playback.ts` 在 `queueTtsPlayback` 内把同一消息拆为多个片段队列项。
- 同一 `messageId` 的所有片段必须连续播放；只在第一段 `onStart` 时展示消息，只在最后一段 `onFinish` 时标记发言结束。

### 11.7.6 真实模式禁用固定 mock fallback（v1.4）

`lib/anthropic.ts` 的真实 provider 行为调整：

- `PROVIDER === "mock"` 时保留 mock。
- `PROVIDER !== "mock"` 时，`complete` / `streamComplete` 失败不得返回固定角色 mock 文本。
- 流式失败且未发出任何 chunk 时抛出错误，由 `turn.ts` 生成“角色正在整理措辞”的可观测状态或重试。
- `Message.metadata` 需要记录 `provider/model/fallback/errorReason`，方便判断一句话是否真实模型生成。

### 11.7.7 角色风格卡与话题去重（v1.4）

`lib/agents/prompts/character.ts` 新增基于角色信息的语言风格卡：

- 句式长短、情绪张力、是否爱反问、是否迂回、是否锋利。
- 明确禁止“AI 总结腔”和固定开头。

`lib/game/conversation-director.ts` 新增轻量话题指纹：

```ts
fingerprint = `${speakerName}:${mentionedNames.join(",")}:${evidenceKeywords.join(",")}`;
```

最近 5 条公共发言内已出现的指纹，在选择下一位说话人和生成 directive 时应被避开或要求换角度。

### 11.8 Step Plan 模型配置

禁止在代码里强制 Step 具体模型。所有 Step 模型通过环境变量配置：

```bash
STEP_BASE_URL=https://api.stepfun.com/step_plan/v1
STEP_MODEL=step-3.5-flash-2603
STEP_TTS_MODEL=stepaudio-2.5-tts
STEP_REALTIME_AUDIO_MODEL=stepaudio-2.5-realtime
STEP_ASR_MODEL=stepaudio-2.5-asr
STEP_IMAGE_MODEL=step-image-edit-2
```

`lib/anthropic.ts` 默认使用 `step-3.5-flash-2603`，更适合本项目高频、多 Agent、短轮次的实时对话场景；同时必须继续读取 `STEP_MODEL`，允许部署者显式切换模型。Step 3.7 Flash 的特殊参数处理可以保留为“按模型名条件判断”，但不能覆盖用户配置。

语音架构：

- HTTP TTS/ASR 继续作为稳定 fallback。
- Realtime 语音新增独立模块，不替换现有 HTTP 路径。
- 前端 TTS 展示队列继续作为“文字何时沉淀到公屏”的控制层。

---

## 十二、环境变量

```bash
# Step / Step Plan
STEP_API_KEY=
STEP_BASE_URL=https://api.stepfun.com/step_plan/v1
STEP_MODEL=step-3.5-flash-2603
STEP_TTS_MODEL=stepaudio-2.5-tts
STEP_REALTIME_AUDIO_MODEL=stepaudio-2.5-realtime
STEP_ASR_MODEL=stepaudio-2.5-asr
STEP_IMAGE_MODEL=step-image-edit-2

# Anthropic fallback
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6

# Database: local-first SQLite by default
DATABASE_URL="file:./dev.db"

# Auth
AUTH_SECRET=

# Runtime
LLM_TIMEOUT_MS=40000
STEP_AUDIO_TIMEOUT_MS=60000
STEP_TTS_TIMEOUT_MS=25000
```

---

## 十三、开发优先级（v1.2 实现顺序）

```
Phase 0（文档与配置前置）
  ✦ PRD / Tech Spec 两轮更新并经用户确认
  ✦ 删除 Step 强制模型，完成模型配置化
  ✦ 更新 README / .env.example

Phase 1（协同状态可视化）
  ✦ AgentStatusRail
  ✦ 等待态与发言态
  ✦ DM 主持台协同监控
  ✦ SSE 状态事件

Phase 2（桌面布局）
  ✦ 中间公屏记录瘦身
  ✦ 右侧线索牌堆
  ✦ 底部 PlayerHand
  ✦ ScriptDrawer 常驻剧本入口

Phase 3（自动讨论与 DM 自动推进）
  ✦ phase-director
  ✦ 自动讨论默认开启
  ✦ WAITING_PLAYER / CAN_CLOSE 阶段状态
  ✦ 应急推进弱化为 fallback

Phase 4（线索卡交互）
  ✦ clue-director
  ✦ 线索打出到公屏
  ✦ 指定角色质询
  ✦ Agent 感知已展示线索

Phase 5（多模态线索图）
  ✦ 视觉圣经
  ✦ storyboard
  ✦ contact sheet 批量生成
  ✦ 裁切与线索绑定

Phase 6（Realtime 语音）
  ✦ stepaudio-2.5-realtime 独立通道
  ✦ HTTP TTS fallback
  ✦ 多角色连续播报优化
```
