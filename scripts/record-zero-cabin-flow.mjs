import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ARTIFACT_DIR = path.resolve("artifacts");
const VIDEO_DIR = path.join(ARTIFACT_DIR, "videos");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const finalVideoPath = path.join(ARTIFACT_DIR, `zero-cabin-full-flow-${stamp}.webm`);
const reportPath = path.join(ARTIFACT_DIR, `zero-cabin-full-flow-${stamp}.json`);

const errors = [];
const notes = [];

const QIN_LINES = {
  intro:
    "我是秦砚，零号舱量子算法负责人。我的工作不是操控人，而是让系统在极端条件下仍然给出最优解。如果各位觉得算法冷冰冰，我承认，它确实比人更诚实。",
  probe:
    "我建议先别急着谈动机。先把时间线拆开：谁在什么时候进入过零号舱，谁接触过主控台，谁有权限改写日志。谎言可以编，但系统调用记录不会陪你演戏。",
  private:
    "我不关心你有没有说谎，我只关心你说谎的成本。你告诉我真实时间线，我可以帮你判断哪些部分还能解释；否则等日志全部恢复，你就没有修正空间了。",
  clue:
    "这个线索不像自然故障，更像人为制造的合理异常。有人想让我们相信系统失控，但真正的问题是，谁最希望系统替他背锅？",
  reasoning:
    "阶段性推理：死亡时间可能被系统日志延后了。两点后的三条指令如果是脚本回放，那么真正死亡点应该落在日志空白之前。我们需要核对冷却液、药柜权限和量子时钟写入权限。",
  reasoningB:
    "第二轮推理：药柜身份卡和摄像头矛盾说明取药记录可能被借权伪造；冷却液缓存的一点十七分激增，比两点零六分指令更接近真实死亡时间。",
  final:
    "我的结论很简单：这不是一次意外，也不是单纯的系统故障。有人利用了所有人对算法不会撒谎的信任，把自己的选择伪装成机器判断。真正暴露他的，正是那条被他以为已经抹掉的逻辑链。",
};

function log(message) {
  console.log(message);
  notes.push({ at: new Date().toISOString(), message });
}

async function main() {
  await fs.mkdir(VIDEO_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    slowMo: 120,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    permissions: ["microphone"],
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1440, height: 980 },
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text().slice(0, 400)}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${(err.message || String(err)).slice(0, 400)}`));
  page.on("response", async (response) => {
    if (response.status() >= 500) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });

  const video = page.video();
  let outcome = "unknown";

  try {
    await step(page, "打开大厅，进入内置剧本库");
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByText("内置剧本库").first().click();
    await page.waitForURL("**/library");

    await step(page, "选择《零号舱的悖论》，展开简介与选角");
    const scriptCard = page.locator(".script-card").filter({ hasText: "零号舱的悖论" }).first();
    await scriptCard.scrollIntoViewIfNeeded();
    await scriptCard.getByRole("button", { name: /查看简介与选角/ }).click();
    await page.waitForSelector("text=剧本初步介绍");

    await step(page, "确认角色扮演模式高亮，选择秦砚");
    const roleModeClass = await page.getByRole("button", { name: /角色扮演模式/ }).first().getAttribute("class");
    if (!roleModeClass?.includes("border-primary")) {
      errors.push("角色扮演模式未默认高亮");
    }
    await page.getByRole("button", { name: /秦砚/ }).first().click();
    await page.getByRole("button", { name: /^开始游戏$/ }).click();
    await page.waitForURL("**/game/**");

    await step(page, "查看 DM 开场悬浮卡，测试 TTS 朗读按钮");
    await page.waitForSelector("text=公共大厅");
    await page.waitForSelector("text=/欢迎来到|零号舱/");
    await closeNotice(page);
    await clickIfVisible(page.getByTitle("朗读这条消息").first(), 12_000, page);
    await page.waitForTimeout(1800);

    await step(page, "打开我的剧本，确认秦砚私密剧本与目标");
    await page.getByRole("button", { name: /我的剧本/ }).click();
    await page.waitForSelector("text=秦砚");
    await page.waitForTimeout(1200);

    await step(page, "回到公共大厅，进入入戏自我介绍阶段");
    await page.getByRole("button", { name: /公共大厅/ }).click();
    await closeNotice(page);
    await clickNextPhase(page);
    await page.waitForSelector("text=/许辰|苏砚|伊芙|秦砚/", { timeout: 120_000 });

    await step(page, "用秦砚人设发自我介绍");
    await sendPublic(page, QIN_LINES.intro);
    await page.waitForTimeout(6000);

    await step(page, "测试语音输入 ASR 控件（假麦克风录音）");
    await clickIfVisible(page.getByTitle("语音输入"), 5_000, page);
    await page.waitForTimeout(1600);
    await clickIfVisible(page.getByTitle("停止录音并识别"), 5_000, page);
    await page.waitForTimeout(3500);

    await step(page, "推进到第一轮自由交流+搜证，触发线索浮层");
    await closeNotice(page);
    await clickNextPhase(page);
    await page.waitForTimeout(5000);
    await closeNotice(page);

    await step(page, "公共频道发出技术试探，并让大家讨论一轮");
    await sendPublic(page, QIN_LINES.probe);
    await page.waitForTimeout(4000);
    await clickIfVisible(page.getByRole("button", { name: /让大家讨论一轮/ }), 5_000, page);
    await page.waitForTimeout(8000);

    await step(page, "查看线索板，阅读已释放线索");
    await page.getByRole("button", { name: /线索板/ }).click();
    await page.waitForTimeout(1800);

    await step(page, "进入私聊，选择许辰并套取时间线");
    await page.getByRole("button", { name: /私聊/ }).click();
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: /许辰/ }).first().click();
    await page.waitForSelector("text=/与 .* 私聊|与 许辰 私聊/");
    await sendCurrentTextarea(page, QIN_LINES.private);
    await page.waitForTimeout(9000);

    await step(page, "回公共频道，请求提示与回顾剧情");
    await page.getByRole("button", { name: /公共大厅/ }).click();
    await closeNotice(page);
    await clickIfVisible(page.getByRole("button", { name: /我需要提示/ }), 5_000, page);
    await page.waitForTimeout(3500);
    await closeNotice(page);
    await clickIfVisible(page.getByRole("button", { name: /回顾剧情/ }), 5_000, page);
    await page.waitForTimeout(4500);
    await closeNotice(page);

    await step(page, "提交阶段性推理，覆盖中间推理节点");
    await clickNextPhase(page);
    await page.waitForTimeout(2000);
    await sendPublic(page, QIN_LINES.reasoning);
    await page.waitForTimeout(5000);

    await step(page, "推进到第二轮深度搜证，查看更深层线索");
    await closeNotice(page);
    await clickNextPhase(page);
    await page.waitForTimeout(5000);
    await closeNotice(page);
    await page.getByRole("button", { name: /线索板/ }).click();
    await page.waitForTimeout(1800);

    await step(page, "中间推理节点 B：再次提交推理");
    await page.getByRole("button", { name: /公共大厅/ }).click();
    await closeNotice(page);
    await clickNextPhase(page);
    await page.waitForTimeout(2000);
    await sendPublic(page, QIN_LINES.reasoningB);
    await page.waitForTimeout(5000);

    await step(page, "公开质询阶段：围绕系统背锅发言");
    await page.getByRole("button", { name: /公共大厅/ }).click();
    await closeNotice(page);
    await clickNextPhase(page);
    await page.waitForTimeout(2000);
    await sendPublic(page, QIN_LINES.clue);
    await page.waitForTimeout(5000);

    await step(page, "最终陈词阶段：发送秦砚最终陈词");
    await closeNotice(page);
    await clickNextPhase(page);
    await page.waitForTimeout(2000);
    await sendPublic(page, QIN_LINES.final);
    await page.waitForTimeout(5000);

    await step(page, "进入投票页，作为秦砚投给许辰测试投票流程");
    await closeNotice(page);
    await clickNextPhase(page);
    await openVoteTab(page);
    await page.waitForTimeout(1000);
    const voteXu = page.getByRole("button", { name: /投给 许辰/ });
    if ((await voteXu.count()) > 0) {
      await voteXu.first().click();
    } else {
      await page.getByRole("button", { name: /^投给 / }).first().click();
    }
    await page.waitForTimeout(12_000);

    await step(page, "进入复盘页，查看真相与回放");
    const replayBtn = page.getByRole("button", { name: /复盘/ });
    for (let i = 0; i < 35; i++) {
      if ((await replayBtn.count()) > 0) {
        await replayBtn.first().click();
        break;
      }
      await page.waitForTimeout(2000);
    }
    await page.waitForURL("**/replay/**", { timeout: 30_000 }).catch(() => {});
    await page.waitForSelector("text=/真相|复盘|秦砚/", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const pageText = await page.textContent("body");
    if (/(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[-*+]\s|\*\*/m.test(pageText ?? "")) {
      errors.push("最终页面仍出现裸 Markdown 标记");
    }
    outcome = "completed";
  } catch (error) {
    outcome = "failed";
    errors.push(`script-error: ${error?.message || String(error)}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, `zero-cabin-flow-error-${stamp}.png`), fullPage: true }).catch(() => {});
  } finally {
    await step(page, "录制结束，保存视频与报告").catch(() => {});
    await context.close();
    await browser.close();

    const rawVideoPath = await video.path();
    await fs.rename(rawVideoPath, finalVideoPath);
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          outcome,
          video: finalVideoPath,
          report: reportPath,
          errors,
          notes,
        },
        null,
        2
      )
    );

    console.log(JSON.stringify({ outcome, video: finalVideoPath, report: reportPath, errors }, null, 2));
    if (outcome !== "completed") process.exitCode = 1;
  }
}

async function step(page, message) {
  log(`▶ ${message}`);
  await page
    .evaluate((text) => {
      let el = document.getElementById("playwright-step-label");
      if (!el) {
        el = document.createElement("div");
        el.id = "playwright-step-label";
        el.style.cssText = [
          "position:fixed",
          "left:18px",
          "bottom:18px",
          "z-index:2147483647",
          "max-width:680px",
          "padding:12px 14px",
          "border-radius:8px",
          "background:rgba(2,6,23,.88)",
          "color:#f8fafc",
          "font:600 15px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          "box-shadow:0 18px 45px rgba(0,0,0,.32)",
          "pointer-events:none",
        ].join(";");
        document.body.appendChild(el);
      }
      el.textContent = text;
    }, message)
    .catch(() => {});
  await page.waitForTimeout(900).catch(() => {});
}

async function closeNotice(page) {
  const closeBtn = page.getByTitle("关闭浮层");
  if ((await closeBtn.count().catch(() => 0)) > 0 && (await closeBtn.first().isVisible().catch(() => false))) {
    await closeBtn.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(350);
  }
  const continueBtn = page.getByRole("button", { name: "继续游戏" });
  if ((await continueBtn.count()) > 0 && (await continueBtn.first().isVisible().catch(() => false))) {
    await continueBtn.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function clickIfVisible(locator, timeout = 3000, page = null) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (page) await closeNotice(page);
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.first().isVisible().catch(() => false))) {
      if (await locator.first().isEnabled().catch(() => true)) {
        try {
          await locator.first().click();
          return true;
        } catch {
          if (page) {
            await closeNotice(page);
            await locator.first().click({ force: true });
            return true;
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function clickNextPhase(page) {
  await closeNotice(page);
  const before = await getGameState(page).catch(() => null);
  const nextButton = page.getByRole("button", { name: "进入下一阶段" });
  for (let i = 0; i < 90; i++) {
    if ((await nextButton.count()) > 0 && (await nextButton.first().isEnabled().catch(() => false))) {
      await nextButton.first().click();
      if (before?.currentPhase !== undefined) {
        await waitForPhaseAfter(page, before.currentPhase);
      } else {
        await page.waitForTimeout(3000);
      }
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("进入下一阶段按钮长时间不可用");
}

async function openVoteTab(page) {
  for (let i = 0; i < 90; i++) {
    const voteButtons = page.locator("button").filter({ hasText: "投票" });
    const count = await voteButtons.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const button = voteButtons.nth(index);
      if ((await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => true))) {
        await button.click();
        return;
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("投票入口长时间未出现");
}

async function getGameState(page) {
  const sessionId = new URL(page.url()).pathname.match(/\/game\/([^/]+)/)?.[1];
  if (!sessionId) throw new Error("当前页面不是游戏页，无法读取游戏状态");
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/game/${id}/state`, { cache: "no-store" });
    if (!res.ok) throw new Error(`state ${res.status}`);
    return res.json();
  }, sessionId);
}

async function waitForPhaseAfter(page, previousPhase) {
  for (let i = 0; i < 180; i++) {
    const state = await getGameState(page).catch(() => null);
    if (state && (state.currentPhase > previousPhase || state.status === "COMPLETED")) {
      await page.waitForTimeout(1200);
      return state;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`阶段推进超时：仍未超过 ${previousPhase}`);
}

async function sendPublic(page, text) {
  await page.getByRole("button", { name: /公共大厅/ }).click().catch(() => {});
  await sendCurrentTextarea(page, text);
}

async function sendCurrentTextarea(page, text) {
  const textarea = page.locator("textarea").first();
  for (let i = 0; i < 40; i++) {
    if ((await textarea.count()) > 0 && (await textarea.isEnabled().catch(() => false))) {
      await textarea.fill(text);
      await page.keyboard.press("Enter");
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("输入框未开放，无法发送话术");
}

await main();
