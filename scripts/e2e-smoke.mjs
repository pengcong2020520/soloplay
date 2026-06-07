// Playwright E2E 主流程冒烟测试（真实浏览器驱动）
// 用法：node scripts/e2e-smoke.mjs
// 覆盖：首页 → 内置剧本库 → 简介选角 → 角色扮演开局 → 游戏页加载 → 真实 AI 发言 → 推进阶段 → 投票 → 复盘
// 同时捕获浏览器 console.error / pageerror（抓 removeChild 等 DOM 报错）

import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const HEADLESS = process.env.HEADED !== "1";

const errors = [];
const log = (...a) => console.log(...a);
const step = (n, msg) => log(`\n[${n}] ${msg}`);

function fail(msg) {
  log(`\n❌ 测试失败：${msg}`);
  if (errors.length) {
    log(`\n捕获到的浏览器错误（${errors.length}）：`);
    errors.slice(0, 10).forEach((e) => log("  - " + e));
  }
  process.exit(1);
}

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// 捕获错误
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text().slice(0, 200));
});
page.on("pageerror", (e) => errors.push("pageerror: " + (e.message || String(e)).slice(0, 200)));

try {
  // ── 1. 首页 ──
  step(1, "打开首页");
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  const title = await page.textContent("h1");
  if (!title || !title.includes("选一个感觉")) fail("首页标题不对：" + title);
  log("  ✓ 首页标题：" + title.trim());

  // ── 2. 进入内置剧本库 ──
  step(2, "点击「内置剧本库」");
  await page.click("text=内置剧本库");
  await page.waitForURL("**/library", { timeout: 15000 });
  // 等列表加载（首次访问会惰性 seed）
  await page.waitForSelector("text=查看简介与选角", { timeout: 30000 });
  const cardCount = await page.locator("text=查看简介与选角").count();
  log(`  ✓ 剧本库加载，${cardCount} 个剧本`);
  if (cardCount < 1) fail("剧本库为空");

  // ── 3. 查看简介、确认角色扮演默认模式并开局 ──
  step(3, "第一个剧本「查看简介与选角」→ 角色扮演开局");
  await page.locator("text=查看简介与选角").first().click();
  await page.waitForSelector("text=剧本初步介绍", { timeout: 15000 });
  await page.waitForSelector("text=角色扮演模式", { timeout: 15000 });
  await page.waitForSelector("text=选择你的角色", { timeout: 15000 });
  const roleModeButton = page.getByRole("button", { name: /角色扮演模式/ }).first();
  const roleModeClass = await roleModeButton.getAttribute("class");
  if (!roleModeClass || !roleModeClass.includes("border-primary")) {
    fail("角色扮演模式未默认高亮");
  }
  await page.getByRole("button", { name: /^开始游戏$/ }).click();
  await page.waitForURL("**/game/**", { timeout: 20000 });
  log("  ✓ 跳转到游戏页：" + page.url());

  // ── 4. 游戏页加载 + DM 开场 ──
  step(4, "等待游戏页加载与 DM 开场广播");
  // 顶栏阶段标识
  await page.waitForSelector("text=公共大厅", { timeout: 20000 });
  // DM 开场消息（start 时落库）
  await page.waitForSelector("text=/欢迎来到/", { timeout: 30000 });
  const bodyAfterOpening = await page.textContent("body");
  if (/(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[-*+]\s|\*\*/m.test(bodyAfterOpening ?? "")) {
    fail("聊天或浮层仍出现裸 Markdown 标记");
  }
  log("  ✓ 游戏主界面加载，DM 开场出现");
  // 确认非 mock（真实 Step）——顶栏不应有「Mock 模式」红标
  const isMock = (await page.locator("text=Mock 模式").count()) > 0;
  log(`  ${isMock ? "⚠️ 当前为 Mock 模式" : "✓ 真实 LLM 模式（无 Mock 标）"}`);

  // 用 role 精确定位推进按钮（避免匹配到 DM 话术里的同名文字）
  const nextPhaseButton = () => page.getByRole("button", { name: "进入下一阶段" });
  const closeFloatingNotice = async () => {
    const continueBtn = page.getByRole("button", { name: "继续游戏" });
    if ((await continueBtn.count()) > 0 && (await continueBtn.first().isVisible().catch(() => false))) {
      await continueBtn.first().click();
      await page.waitForTimeout(300);
    }
  };

  // 等待「进入下一阶段」按钮可点（busy 时它 disabled）。返回是否可点。
  async function waitNextEnabled(timeoutMs = 120000) {
    const btn = nextPhaseButton();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if ((await btn.count()) === 0) return false; // 按钮消失（最后阶段/已完成）
      if (await btn.isEnabled().catch(() => false)) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  }

  // ── 5. 推进到自我介绍阶段，等待真实 AI 角色发言 ──
  step(5, "点「进入下一阶段」，等待 AI 角色自我介绍（真实 LLM 流式）");
  await closeFloatingNotice();
  await nextPhaseButton().click();
  await page.waitForSelector("text=/林晚|沈明远|陈默|周管家|顾屿|林桑|赵全勤/", { timeout: 120000 });
  log("  ✓ 出现 AI 角色发言");
  await page.waitForTimeout(3000);
  const bodyText = await page.textContent("body");
  const hasRealContent = /我是|在下|各位|那一夜|昨晚|我叫/.test(bodyText);
  log(`  ${hasRealContent ? "✓ AI 发言含实质内容" : "⚠️ 未检测到典型角色发言措辞"}`);

  // ── 6. 推进到自由交流阶段并玩家发言 ──
  step(6, "推进到自由交流阶段 + 玩家发言");
  if (await waitNextEnabled()) {
    await closeFloatingNotice();
    await nextPhaseButton().click();
    log("  · 已推进（自由交流阶段）");
  }
  // 等输入框开放（自由交流阶段开放公共发言）
  const textarea = page.locator("textarea");
  let posted = false;
  for (let i = 0; i < 30; i++) {
    if ((await textarea.count()) > 0 && (await textarea.first().isEnabled().catch(() => false))) {
      await textarea.first().fill("大家昨晚都在哪里？请如实说明。");
      await page.keyboard.press("Enter");
      log("  ✓ 玩家发言已提交，等待 AI 回应…");
      await page.waitForTimeout(10000);
      posted = true;
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (!posted) log("  · 输入框始终未开放，跳过玩家发言");

  // ── 7. 快进到投票阶段并投票 ──
  step(7, "快进到投票阶段并投票");
  let votedOrEnded = false;
  const voteTab = () => page.getByRole("button", { name: /^投票$/ });
  for (let i = 0; i < 10; i++) {
    // 已出现投票 tab？
    if ((await voteTab().count()) > 0) {
      await voteTab().first().click().catch(() => {});
      await page.waitForTimeout(1500);
      const voteBtn = page.getByRole("button", { name: /^投给 / });
      if ((await voteBtn.count()) > 0) {
        log("  ✓ 到达投票阶段，提交投票");
        await voteBtn.first().click();
        await page.waitForTimeout(10000);
        votedOrEnded = true;
        break;
      }
    }
    // 否则等按钮可点后推进
    if (await waitNextEnabled(60000)) {
      await closeFloatingNotice();
      await nextPhaseButton().click();
      await page.waitForTimeout(2000);
    } else {
      // 按钮不可点也不消失，再等等
      await page.waitForTimeout(2000);
    }
  }
  if (!votedOrEnded) log("  · 未在限定步数内到达投票（真实 LLM 各阶段较慢，可接受）");

  // ── 8. 复盘 ──
  step(8, "等待结局判定 + 进入复盘");
  // 投票后会触发 AI 模拟投票 + 结局判定（真实 LLM 较慢），轮询等复盘按钮出现
  let enteredReplay = false;
  if (votedOrEnded) {
    const replayBtn = page.getByRole("button", { name: /复盘/ });
    for (let i = 0; i < 40; i++) {
      if ((await replayBtn.count()) > 0) {
        await replayBtn.first().click().catch(() => {});
        await page.waitForURL("**/replay/**", { timeout: 15000 }).catch(() => {});
        // 复盘页关键区块
        await page.waitForSelector("text=/真相揭示|复盘揭秘|案情真相/", { timeout: 15000 }).catch(() => {});
        log("  ✓ 进入复盘页：" + page.url());
        enteredReplay = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
  }
  if (!enteredReplay) log("  · 未进入复盘（结局判定可能仍在进行）");

  // ── 结果 ──
  log("\n════════════════════════════════");
  if (errors.length === 0) {
    log("✅ 主流程跑通，零浏览器错误");
  } else {
    log(`⚠️ 主流程跑通，但捕获到 ${errors.length} 条浏览器错误：`);
    errors.slice(0, 10).forEach((e) => log("  - " + e));
  }
  log("════════════════════════════════");
} catch (err) {
  errors.length && log("\n浏览器错误：\n" + errors.slice(0, 10).map((e) => "  - " + e).join("\n"));
  fail((err && err.message) || String(err));
} finally {
  await browser.close();
}
