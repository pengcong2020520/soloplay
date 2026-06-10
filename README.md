# SoloPlay · AI 单人剧本杀

SoloPlay 是一个本地优先的 AI 单人剧本杀应用：DM Agent 主持全局节奏，多位 NPC 由独立角色 Agent 扮演，玩家可以用「角色扮演」或「侦探」模式完成一局完整剧本杀。项目重点不是普通聊天，而是把剧本杀桌面的关键体验搬到单人 AI 场景里：阅本、入戏、公共讨论、私聊、举证、质询、共识收敛、投票和复盘。

> 实现自 [PRD.md](./PRD.md) 与 [TECH_SPEC.md](./TECH_SPEC.md)。当前版本已跑通从体验意图引导、内置/上传/AI 生成剧本、个人选角、多 Agent 公共/私聊、Step TTS/ASR、线索证据卡、阶段共识板、投票到复盘的完整本地闭环。

建议 GitHub 仓库描述：

> Local-first AI solo jubensha game with Step-powered DM, NPC agents, TTS/ASR, evidence cards, consensus tracking, private chat, voting, and replay.

## 功能亮点

- **完整单人剧本杀闭环**：选剧本、选模式/角色、DM 开场、阶段推进、公共讨论、私聊、搜证、投票、复盘。
- **多 Agent 信息隔离**：每个 NPC 只看到公共剧本和自己的私密剧本，避免全知视角污染。
- **Step 优先接入**：默认推荐 `step-3.5-flash-2603`，适合高频 Agent 对话；没有 API Key 时以明确 Mock 模式跑通流程。
- **TTS / ASR 全局贯穿**：DM、NPC、私聊、线索提示进入统一播放队列；玩家语音经 Step ASR 转文字后复用同一套发言队列。
- **线索证据卡**：线索卡带统一风格图片，可在公屏举证或指定角色质询；公屏渲染证据卡，右侧沉淀完整线索牌堆。
- **阶段共识板**：DM 监听阶段进展，右侧展示“已形成 / 分歧点 / 待核查”，玩家可提交阶段结论或标记无共识。
- **沉浸式 UI**：剧本视觉主题、角色头像、Agent 状态可视化、随身剧本册、富文本聊天渲染。
- **内置剧本库**：包含「雾港庄园谋杀案」「零号舱的悖论」等 6 个预置剧本，并预置 32 张本地线索图资产。

## 技术栈

- **Next.js 14**（App Router）+ TypeScript
- **Tailwind CSS** + shadcn 风格组件
- **Prisma** + **SQLite**（本地优先；可平滑切换 Supabase Postgres）
- **Step / Anthropic / Mock 多后端**，默认优先 Step Plan `step-3.5-flash-2603`，适配高频 Agent 对话，流式输出 + 结构化 JSON 生成
- **Step TTS / ASR**，支持 DM/角色消息朗读与玩家语音输入
- **SSE** 流式推送 Agent 回复

## 本地优先设计 ⚡

**没有模型 API Key 也能完整跑通。** 未配置密钥时，LLM 调用使用明确标记的 mock 模式，整套流程可玩。配置 `STEP_API_KEY` 后，剧本生成、DM、角色 Agent、TTS 与 ASR 切换为真实 Step 调用，无需改代码。线索图资产已预生成在 `public/generated/clues/`，不会在运行时强制依赖图片模型。

> 安全提醒：真实 `.env`、SQLite 本地数据库、构建产物、依赖目录、录屏文件都已在 `.gitignore` 中排除，不应提交到 GitHub。

## 快速开始

```bash
cp .env.example .env    # 可选：填 STEP_API_KEY；不填也能 mock 运行
npm install            # 安装依赖（postinstall 自动 prisma generate）
npm run db:push        # 创建 SQLite 数据库（prisma/dev.db）
npm run db:seed        # 写入本地用户（可选，运行时也会自动创建）
npm run dev            # 启动，默认 http://localhost:3000
```

打开首页 →「内置剧本库」挑预置剧本直接开玩；「快速开局」用样例剧本；「AI 定制剧本」走完整问卷生成。

需要重新生成内置剧本线索图时执行：

```bash
npm run assets:clues
```

### 换电脑运行交付包

解压 zip 后在项目根目录执行：

```bash
cp .env.example .env    # 填入 STEP_API_KEY；不填则走 mock
npm install
npm run db:push
npm run db:seed
npm run dev
```

交付包不会包含 `.env`、`node_modules`、`.next` 或本机 SQLite 数据库；这些内容都应在目标电脑上重新生成。

完整部署步骤、生产启动、Postgres 切换和故障排查见 [部署手册](./docs/DEPLOYMENT.md)。

## 常用命令

```bash
npm run dev              # 本地开发
npm run build            # 生产构建检查
npm run assets:clues     # 重新生成内置剧本本地线索图
npm run e2e              # Playwright 主流程冒烟
node scripts/record-zero-cabin-flow.mjs  # 录制零号舱全链路体验视频
```

### 端到端冒烟测试（Playwright）

真实浏览器驱动跑通主流程（首页 → 剧本库 → 开局 → 游戏页 → AI 发言 → 推进阶段 → 投票 → 复盘），并捕获 console/page 报错：

```bash
npm run dev      # 另开终端先启动应用
npm run e2e      # 跑 Playwright 主流程冒烟（脚本：scripts/e2e-smoke.mjs）
HEADED=1 npm run e2e   # 有头模式，可肉眼看浏览器操作
```

配了真实 LLM key 时，E2E 会跑真实模型（较慢，脚本已用轮询等待）；未配置则走 mock，更快。

### 接入真实 LLM（可选）

支持多后端，**按优先级自动选择**：Step（阶跃星辰）> Anthropic Claude > mock。模型选择完全由 `.env` 配置决定，代码不会强制覆盖；编辑 `.env` 任填其一：

```bash
# 方式 A：Step 阶跃星辰（OpenAI 兼容）
STEP_API_KEY=...
STEP_BASE_URL=https://api.stepfun.com/step_plan/v1
STEP_MODEL=step-3.5-flash-2603    # 推荐用于当前高频 Agent 场景，也可按需换成其他 Step Chat 模型

# 可选：Step TTS / ASR
STEP_REALTIME_AUDIO_MODEL=stepaudio-2.5-realtime
STEP_TTS_MODEL=stepaudio-2.5-tts
STEP_TTS_VOICE=cixingnansheng
STEP_TTS_DM_VOICE=boyinnansheng
STEP_TTS_MALE_VOICES=cixingnansheng,ruyananshi,wenrougongzi,shenchennanyin,zhengpaiqingnian,yuanqinansheng,boyinnansheng,shuangkuainansheng
STEP_TTS_FEMALE_VOICES=wenrounvsheng,ganliannvsheng,jingdiannvsheng,tianmeinvsheng,qingchunshaonv,linjiajiejie,huolinvsheng,qinhenvsheng
STEP_ASR_MODEL=stepaudio-2.5-asr
STEP_IMAGE_MODEL=step-image-edit-2

# 方式 B：Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6

# 可选：单次调用超时
LLM_TIMEOUT_MS=40000
```

TTS 现在默认全局自动朗读新消息：DM、NPC 公共发言、私聊回复和线索提示都会进入同一条播放队列；角色音色按姓名稳定分配，男角使用男声池、女角使用女声池，并通过 Step TTS `instruction` 注入职业与人设风格。

> ⚠️ 默认推荐 `step-3.5-flash-2603`，更适合当前多 Agent 高频接话场景。如果你将 `STEP_MODEL` 配置为 `step-3.7-flash`，项目仍会保留该模型的空输出与低 `max_tokens` 兜底处理。

真实路径已做健壮性加固：流式发言中途报错时已产出内容不丢、不中断整条 SSE；瞬时错误（429/5xx/超时）指数退避重试，4xx 立即放弃；Claude 后端启用 prompt caching 降本、Step 后端用 `response_format: json_object` 保证结构化输出；`completeJson` 检测输出截断后提高上限重试而非空转。

### 登录与多用户（可选）

支持邮箱+密码注册登录（`/auth`），登录后剧本与游戏会话按账号隔离，互不可见；**不登录仍可游客身份直接游玩**（数据挂在内置 `local-user` 下，与旧版行为一致）。会话用 HMAC 签名的 HttpOnly cookie 承载，无新增依赖（Node 内置 `crypto` scrypt 哈希）。生产环境务必设置：

```bash
AUTH_SECRET=<随机长字符串>
```

### 切换到 Supabase Postgres（可选）

1. `prisma/schema.prisma` 中 `datasource db` 的 `provider` 改为 `postgresql`
2. `.env` 设 `DATABASE_URL=postgresql://...`
3. 重新 `npm run db:push`

（SQLite 不支持原生 enum / 数组，schema 已用「字符串 + JSON 字段」兼容两端，取值集中在 [lib/constants.ts](./lib/constants.ts)。）

## 已实现功能

| 模块 | 说明 |
|------|------|
| 体验意图入口 | 首页按「想要什么感觉」推荐剧本类型；老玩家显示个性化推荐横幅 |
| AI 剧本生成 | 分步问卷 → Claude 生成完整剧本（公共故事 / 角色私密剧本 / 线索卡 / 阶段 / 真相） |
| 上传剧本解析 | TXT / Markdown 原生支持，PDF / DOCX 需装可选依赖；Claude 结构化提取 + 差异化校验告警 |
| 两种玩家模式 | 角色扮演（持有私密剧本+胜利条件）/ 侦探（无身份，自由审讯） |
| 我的剧本面板 | 角色扮演显示「玩法指引 + 公开身份 + 私密背景/秘密/目标/胜利条件」整本剧本（每段附说明）；侦探模式提供专属「玩法指引」tab |
| 角色 Agent | 信息隔离：每个角色只看公共剧本 + 自己的私密剧本；流式发言；私聊时明确针对玩家发问直接作答（区分公聊/私聊上下文） |
| DM Agent | 阶段推进、线索发布、引导提示、投票汇总、结局判定、体验自适应 |
| 6 种剧本类型流程 | 推理 / 硬核（含中间推理节点）/ 情感 / 欢乐 / 恐怖（生存判定）/ 还原，各有差异化阶段状态机 |
| 公共 + 私聊频道 | 玩家↔角色 1:1 私聊（直接回应玩家）；DM 协调的角色↔角色密谈（进行中玩家不可见，复盘公开） |
| 多人自由讨论 | 自由交流阶段 AI 角色在公共频道彼此你来我往（接话/质疑/附和），进入该阶段自动开聊；玩家可点「让大家讨论一轮」或随时插话，不再一问一答 |
| 线索证据卡 | DM 发放线索时右侧沉淀图片卡，玩家可公开举证或用线索质询角色；公屏按证据卡渲染，Agent 可围绕线索回应 |
| 阶段共识板 | DM 阶段评估输出共识/分歧/待核查；玩家可请求共识检查、提交阶段结论、标记无共识、请求 DM 收束 |
| 特殊机制 | 欢乐随机事件卡 / 恐怖事件 / 情感触发事件 / 硬核·恐怖阶段判定 |
| 玩家节奏控制 | 提示 / 回顾 / 降难度 / 跳过阶段 / 关注某角色 / 让大家讨论一轮 / 暂停退出（可恢复） |
| 投票与差异化结局 | AI 模拟投票 + 玩家投票；按剧本类型差异化判定（投凶/还原/情感达成/欢乐/存活） |
| 复盘揭秘 | 真相、全角色私密剧本、对话回放（含私聊）、投票记录、胜负分析 |
| 体验反馈 + 推荐 | 复盘后评分/喜好/难度反馈 → 自动构建偏好档案 → 生成下次推荐与体验标签 |
| 历史记录 | 历史游戏列表，可继续未完成/暂停的局或查看复盘 |

## GitHub 协作规范

提交、分支、PR、Issue 和 Markdown 格式请参考：

- [GitHub 格式规范](./docs/GITHUB_FORMAT_GUIDE.md)

## 目录结构

```
app/
  api/                 # API Routes（auth / script / game / message / vote / command / feedback / recommend / replay / upload）
  auth/                # 登录 / 注册页
  setup/               # 剧本生成问卷 + 模式选择
  upload/              # 上传剧本 + 解析预览
  game/[id]/           # 游戏主界面（公共聊天 / 私聊 / 我的剧本 / 线索板 / 投票 / 节奏控制 / 阶段倒计时）
  replay/[id]/         # 复盘揭秘 + 穿帮检测 + 体验反馈 + 推荐
  history/             # 历史游戏列表
lib/
  anthropic.ts         # Claude 客户端封装（流式 / JSON / mock 兜底 + 重试/超时/缓存加固）
  auth/                # 密码哈希(scrypt) / 签名 cookie 会话 / 当前用户解析 + 归属校验
  agents/              # 角色 / DM / 投票 / 角色间私聊 / 生成 / 摘要 / 穿帮检测 Agent + prompt 模板 + mock 数据
  game/                # 会话加载、阶段状态机、turn 编排、线索 director、共识/阶段 director、投票、结局、反馈、推荐
  parsers/             # 上传文件文本提取 + Claude 结构化解析
  client/sse-client.ts # 前端 SSE 消费
components/            # AuthWidget + game/（聊天气泡 / 阶段指示 / 私聊 / DM 主持台 / 线索牌堆 / TTS 队列）
public/generated/      # 内置剧本本地线索图资产
prisma/schema.prisma   # 数据模型（User.passwordHash / GameSession.phaseStartedAt）
types/game.ts          # 全局类型
```

## 上传 PDF / Word（可选）

TXT / Markdown 开箱即用。要解析 PDF / DOCX，安装可选依赖即可（构建时已用 `IgnorePlugin` 容忍其缺失）：

```bash
npm i mammoth pdf-parse
```

## 与 Tech Spec 的差异（务实取舍）

- **DB**：本地用 SQLite 替代 Supabase Postgres（schema 兼容，可一键切换）。
- **枚举/数组**：SQLite 用字符串 + JSON 字段承载，取值集中在 `lib/constants.ts`。
- **认证**：V1 单用户、免登录，固定一个本地用户（`local-user`）。Supabase Auth 留待接入。
- **实时通信**：用「POST 返回 SSE 流」实现流式 Agent 回复，未引入独立的订阅式 stream 端点 / Redis。
- **结局判定**：还原本的"时间线还原准确度评分"、恐怖本的"行为路径分支"做了合理简化（指认正确/做出抉择即达成），核心闭环完整。

## V2 已落地

- **多用户认证 + 数据隔离**：邮箱登录、签名 cookie 会话、剧本/会话按账号隔离，越权访问返回 403/404（游客 `local-user` 仍可免登录游玩）。
- **阶段超时自动推进**：按 phase-config 的 TIME 条件，前端以服务端 `phaseStartedAt` 为权威基准倒计时；到点不硬切，进入宽限期可"再停留"，归零后自动推进（`next-phase` 用 CAS 幂等防 timer/手动/SKIP 并发重复）。
- **上下文压缩**：每个 AI 角色在阶段边界生成滚动摘要写入 `agentContext`，发言时以"摘要 + 最近 N 条原始消息"替代硬截断 50 条；严格信息隔离、失败静默回退。
- **角色前后矛盾检测**：角色公共发言后由校验 agent 判断是否与其私密剧本设定 / 自己先前发言"穿帮"（区分策略性说谎），结果写入消息 metadata，复盘新增「穿帮检测」面板展示。

## V3 已落地

- **内置剧本库**：精选预置剧本（推理「雾港庄园」/ 情感 / 欢乐），归属系统账号 `builtin-library`、`source=BUILTIN` 对所有用户共享；首页「内置剧本库」入口（`/library`）一键开局，无需生成。首次访问惰性 seed，`npm run db:seed` 也会写入。
- **会话吊销 / 多设备管理**：签名 cookie 内嵌 `tokenVersion` 并与 DB 对账，"登出全部设备"（`/api/auth/logout-all`）bump 版本号即让该用户所有已签发会话立即失效。
- **游客数据认领迁移**：游客（`local-user`）积累的剧本与对局，在注册新账号后可一键认领到自己名下（注册流程自动检测并询问，`/api/auth/claim-guest`）。

## V4 已落地

- **TTS/ASR 全局语音链路**：Step TTS 按角色性别与人设分配音色，消息按队列播放；玩家 ASR 结果进入同一套 pending 发言流程，不打断当前角色发言。
- **多 Agent 公屏协同**：顺序自我介绍阶段玩家最后发言，后续阶段 Agent 可自然接话、点名回应、邀请玩家加入讨论；自动讨论在玩家输入/录音/待发送时暂缓。
- **线索多模态证据卡**：内置剧本预置统一风格 SVG 线索图，`ClueCard` 持久化媒体字段；DM 发线索、公屏举证、右侧牌堆共用同一份结构化线索数据。
- **阶段共识与收束**：`phase-director` 根据举证、讨论、玩家结论和分歧标记判断阶段状态，右侧共识板持续沉淀当前局势。

## 尚未实现（更远规划）

- 多人 / CP 本
- 切换到 Supabase Postgres + Supabase Auth 的生产级部署
- 服务端会话表（当前为无状态签名 cookie + tokenVersion 吊销，不记录每个设备的独立会话明细）
