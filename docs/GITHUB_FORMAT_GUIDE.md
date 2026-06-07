# GitHub 格式规范

本文档用于统一 SoloPlay 仓库在 GitHub 上的提交、分支、Issue、PR 与 Markdown 写法，方便后续协作、回滚和发布。

## 仓库描述

推荐在 GitHub About 中使用：

```text
Local-first AI solo jubensha game with Step-powered DM, NPC agents, TTS/ASR, clues, private chat, voting, and replay.
```

推荐 Topics：

```text
nextjs, typescript, prisma, sqlite, ai-agents, stepfun, tts, asr, playwright, game
```

## 分支命名

分支名使用小写英文、数字和短横线，格式为：

```text
<type>/<short-scope>
```

常用类型：

- `feature/`：新增功能，例如 `feature/voice-input`
- `fix/`：修复缺陷，例如 `fix/dm-floating-card`
- `docs/`：文档更新，例如 `docs/readme-setup`
- `test/`：测试脚本或测试覆盖，例如 `test/e2e-zero-cabin`
- `chore/`：依赖、配置、构建脚本等维护，例如 `chore/gitignore-cleanup`

## Commit 格式

使用简洁的 Conventional Commits：

```text
<type>(<scope>): <summary>
```

示例：

```text
feat(game): add DM floating clue cards
fix(chat): render rich text without raw markdown markers
docs(readme): update setup instructions for Step models
test(e2e): cover zero cabin role-play flow
chore(repo): initialize git ignore rules
```

规则：

- `summary` 使用英文或中文均可，但要具体。
- 首行建议不超过 72 个字符。
- 一个 commit 只表达一类变化。
- 不提交 `.env`、数据库、录屏、构建产物、依赖目录。

## Pull Request 格式

PR 标题沿用 Commit 格式，例如：

```text
feat(audio): add Step TTS and ASR controls
```

PR 描述建议包含：

```markdown
## Summary
- What changed
- Why it changed

## Verification
- [ ] npm run build
- [ ] npm run e2e
- [ ] Manual browser check

## Notes
- API keys are not included
- Known limitations or follow-up work
```

如果是 UI/体验改动，建议附截图或录屏路径；不要上传包含密钥、真实用户数据或本地数据库的文件。

## Issue 格式

Bug issue 建议包含：

```markdown
## Problem
Describe what happened.

## Steps To Reproduce
1. Open ...
2. Click ...
3. See ...

## Expected
Describe expected behavior.

## Environment
- Browser:
- Node:
- Model mode: Step / Anthropic / Mock

## Logs / Screenshots
Paste safe logs only. Do not include secrets.
```

Feature issue 建议包含：

```markdown
## Goal
What user outcome should this enable?

## Scope
What is included?

## Out Of Scope
What should not be changed?

## Acceptance Criteria
- [ ] ...
```

## Markdown 书写规范

- 标题从 `#`、`##`、`###` 逐级递进，不跳级。
- 命令、路径、环境变量用反引号，例如 `npm run dev`、`.env`、`STEP_API_KEY`。
- 多行命令使用 fenced code block，并注明语言：

```bash
npm install
npm run db:push
npm run dev
```

- 列表项保持短句，避免一条 bullet 写成很长段落。
- 链接使用描述性文本，例如 `[README](../README.md)`，不要写“点这里”。
- 涉及密钥、数据库、用户信息时只写变量名，不写真实值。

## 发布前检查

提交到 GitHub 前至少确认：

```bash
npm run build
git status --short
git check-ignore .env prisma/dev.db .next node_modules artifacts
```

推荐再跑：

```bash
npm run e2e
```

如果要录制零号舱体验视频：

```bash
node scripts/record-zero-cabin-flow.mjs
```

录屏会生成到 `artifacts/`，该目录默认不会提交。
