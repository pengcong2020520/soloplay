# SoloPlay 部署手册

本文说明如何把本项目交付到另一台电脑或服务器运行。交付包是源码包，不包含 `.env`、本地 SQLite 数据库、`node_modules`、`.next`、Git 历史、测试录屏或缓存文件。

## 1. 环境要求

- Node.js 20 LTS 或更高版本
- npm 10 或更高版本
- 可访问外网，用于安装 npm 依赖和调用 Step API
- 可选：Step API Key，用于真实 AI、TTS、ASR；不配置也能以 mock 模式跑通主流程

检查版本：

```bash
node -v
npm -v
```

## 2. 解压交付包

```bash
unzip soloplay-deploy-*.zip
cd soloplay
```

如果解压出来的目录不是 `soloplay`，进入实际项目根目录即可。根目录应包含 `package.json`、`prisma/schema.prisma`、`app/`、`lib/` 等文件。

## 3. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

最小可运行配置：

```bash
DATABASE_URL="file:./dev.db"
AUTH_SECRET=<换成一段随机长字符串>
```

启用真实 Step 能力：

```bash
STEP_API_KEY=<你的 Step API Key>
STEP_MODEL=step-3.5-flash-2603
```

语音能力可选，默认值已在代码中设置；需要显式覆盖时再写入：

```bash
STEP_TTS_MODEL=stepaudio-2.5-tts
STEP_ASR_MODEL=stepaudio-2.5-asr
```

生成 `AUTH_SECRET` 的一种方式：

```bash
openssl rand -base64 32
```

注意：不要把真实 `.env` 发给别人，也不要提交到代码仓库。

## 4. 安装依赖与初始化数据库

```bash
npm install
npm run db:push
npm run db:seed
```

说明：

- `npm install` 后会自动执行 `prisma generate`。
- `npm run db:push` 会根据 `prisma/schema.prisma` 创建本地 SQLite 数据库 `prisma/dev.db`。
- `npm run db:seed` 会写入本地默认用户；即使不执行，运行时也会自动创建基础用户，但建议部署时执行一次。

## 5. 本地开发运行

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

如果 3000 端口被占用，可以指定其他端口：

```bash
npm run dev -- -p 3001
```

## 6. 生产模式运行

先构建：

```bash
npm run build
```

再启动：

```bash
npm run start
```

指定端口：

```bash
npm run start -- -p 3001
```

生产部署到服务器时，建议使用进程管理器，例如 pm2：

```bash
npm install -g pm2
npm run build
pm2 start npm --name soloplay -- run start
pm2 save
```

## 7. 数据库切换到 Postgres

默认使用 SQLite，适合本机演示或单机部署。如果部署到长期在线服务器，建议改用 Postgres。

步骤：

1. 打开 `prisma/schema.prisma`
2. 将 datasource provider 从 `sqlite` 改为 `postgresql`
3. 在 `.env` 中设置：

```bash
DATABASE_URL=postgresql://user:password@host:5432/database
```

4. 执行：

```bash
npm run db:push
npm run db:seed
```

## 8. 验证部署

基础检查：

```bash
npx tsc --noEmit
npm run build
```

应用检查：

1. 打开首页
2. 进入「内置剧本库」
3. 选择一个剧本并开局
4. 确认 DM 开场出现
5. 推进到自我介绍阶段，确认 AI 角色先发言、玩家最后发言后 DM 自动推进

如果需要跑 Playwright 冒烟测试：

```bash
npm run dev
npm run e2e
```

`npm run e2e` 会打开真实浏览器自动走主流程。配置真实 Step key 时速度会更慢，也可能受 API 限流影响。

## 9. 常见问题

### 页面显示 Mock 模式

说明没有读取到真实模型 key。检查 `.env` 是否存在，是否写了：

```bash
STEP_API_KEY=...
```

修改 `.env` 后需要重启服务。

### TTS 或 ASR 不工作

先确认：

- `.env` 已配置 `STEP_API_KEY`
- 浏览器允许麦克风权限
- 浏览器已经有一次用户点击交互，自动播放音频才会被允许

TTS 使用 `stepaudio-2.5-tts`，ASR 使用 `stepaudio-2.5-asr`。二者都通过 Step API 调用。

### Prisma 提示数据库不存在

执行：

```bash
npm run db:push
```

SQLite 模式下会生成 `prisma/dev.db`。

### 端口被占用

查看占用：

```bash
lsof -iTCP:3000 -sTCP:LISTEN -n -P
```

换端口启动：

```bash
npm run dev -- -p 3001
```

### npm install 失败

确认 Node.js 版本为 20 LTS 或以上，并尝试清理后重装：

```bash
rm -rf node_modules package-lock.json
npm install
```

如果希望严格使用交付包内的锁文件，不要删除 `package-lock.json`，改用：

```bash
npm ci
```

## 10. 交付包不包含的内容

以下内容不会随 zip 分发，需要在目标机器重新生成或自行配置：

- `.env`
- `node_modules/`
- `.next/`
- `prisma/dev.db`
- `.git/`
- `artifacts/`
- `test-results/`
- `playwright-report/`
- `*.tsbuildinfo`
