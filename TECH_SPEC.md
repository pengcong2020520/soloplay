# AI 单人剧本杀游戏 — 技术规格文档 (Tech Spec)

**版本**: v1.0
**日期**: 2026-06-07
**配套文档**: PRD v1.0

---

## 一、技术栈选型

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

## 十一、环境变量

```bash
# .env.local

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Database
DATABASE_URL=postgresql://...

# Upstash Redis（可选，用于游戏状态缓存）
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Next.js
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
```

---

## 十二、开发优先级（V1 实现顺序）

```
Phase 1（核心骨架）
  ✦ 数据库 schema + Prisma 初始化（含 UserPreferences 结构化模型）
  ✦ Supabase Auth 接入
  ✦ 体验意图引导 + AI 剧本生成问卷流程（含第零步体验意图）
  ✦ DM + 角色 Agent 基础调用（含 playerMode 注入）

Phase 2（游戏主流程 — 两种核心体验路径同步跑通）
  ✦ 游戏会话创建与启动
  ✦ 公共频道聊天（SSE 流式输出）
  ✦ DM 阶段推进 + 体验自适应基础版（卡顿检测 + 提示）
  ✦ 推理本完整流程跑通（角色扮演模式）
  ✦ 侦探模式完整流程跑通（侦探模式是核心体验路径之一，不可推迟）
  ✦ 玩家节奏控制指令（HINT / PAUSE / RECAP）

Phase 3（完整功能）
  ✦ 私聊频道（玩家↔角色 / 角色↔角色）
  ✦ 线索板
  ✦ 结局判定模块（含差异化判定逻辑）
  ✦ 复盘系统（含私聊回放、胜负分析）
  ✦ 游戏后体验反馈模块
  ✦ 上传剧本解析

Phase 4（剧本类型扩展）
  ✦ 剩余5种剧本类型阶段配置（情感/欢乐/硬核/恐怖/还原）
  ✦ 特殊机制（恐怖事件/随机事件/情感触发事件）
  ✦ DM 体验自适应完整版（无聊检测 + 隐藏事件触发）

Phase 5（个性化与打磨）
  ✦ 体验偏好档案自动构建
  ✦ 下次游戏推荐系统
  ✦ 历史记录管理 + 体验标签
  ✦ 性能优化（Agent 并发 / 上下文压缩）
  ✦ 错误处理完善 + 体验质量监控指标
```
