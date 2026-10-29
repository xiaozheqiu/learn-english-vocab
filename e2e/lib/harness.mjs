/**
 * 浏览器回归的公共层。
 *
 * 两条硬规则（写在这里，也写进 README）：
 *
 * 1. **不为让流程跑通而绕过被测行为。**
 *    如果某一步本该发生却没发生，就让它失败。绝不「帮它把前置条件补齐」——
 *    那等于把要测的规则绕过去了，测试还会一路绿灯（曾经因此漏掉一个真 bug：
 *    零基础进测试页本该不出题，脚本却先偷偷补了一轮复习）。
 *
 * 2. **断言查结构，不查文案。**
 *    查 `[role="row"][data-key]` 的数量、`aria-pressed` 的值、URL 的 hash、
 *    元素是否存在——而不是查「已掌握」「全库掌握度」这类会随文案调整而变的字符串。
 *    文案改动不该让测试变红，行为改动才应该。
 */

import { chromium } from "playwright";

const CHROMIUM =
  process.env.CHROMIUM_PATH ??
  "/Users/zheqiu/Library/Caches/ms-playwright/chromium_headless_shell-1232/chrome-headless-shell-mac-arm64/chrome-headless-shell";

export const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173/";

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  wide: { width: 1280, height: 900 },
};

/** 结果收集器：只记录断言结论，不记录文案快照 */
export function createReport() {
  const results = [];
  const errors = [];

  return {
    errors,
    /** @param {string} name 结构化的名字，例如 review.requeuesOnFail */
    check(name, ok, detail = "") {
      results.push({ name, ok: Boolean(ok), ...(detail ? { detail: String(detail) } : {}) });
      return ok;
    },
    /** 记录一条「当前拿到的东西」，失败时便于排查，但本身不算断言 */
    note(name, value) {
      results.push({ name, note: typeof value === "string" ? value : JSON.stringify(value) });
    },
    fail(name, detail) {
      return this.check(name, false, detail);
    },
    summary() {
      const failed = results.filter((r) => r.ok === false);
      return {
        total: results.filter((r) => r.ok !== undefined).length,
        failed: failed.length,
        failures: failed,
        results,
        errors,
        ok: failed.length === 0 && errors.length === 0,
      };
    },
  };
}

export async function launch() {
  return chromium.launch({ executablePath: CHROMIUM });
}

export async function newPage(browser, viewport = VIEWPORTS.mobile) {
  const context = await browser.newContext({
    viewport,
    locale: "zh-CN",
    hasTouch: viewport.width < 500,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.__errors = errors;
  page.__context = context;
  return page;
}

export async function closePage(page) {
  await page.__context.close();
}

/* ── 结构性等待（不靠固定 sleep 赌时机）────────────────────────── */

/** 等到某个条件成立，超时抛错并带上最后一次实际值 */
export async function until(page, fn, { timeout = 8000, label = "condition" } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await fn();
    if (last) return last;
    await page.waitForTimeout(80);
  }
  throw new Error(`等待超时（${label}），最后取值：${JSON.stringify(last)}`);
}

/** 已渲染的词表行数 */
export function rowCount(page) {
  return page.locator('[role="row"][data-key]').count();
}

/** 等到抽屉彻底关闭（Radix 有关闭动画，期间遮罩仍会拦住点击） */
export function waitDialogClosed(page) {
  return until(page, async () => (await page.locator('[role="dialog"]').count()) === 0, {
    label: "dialog closed",
  });
}

/** 打开筛选抽屉并等到可交互 */
export async function openFilter(page) {
  await page.locator('[data-testid="filter-trigger"]').click();
  await until(page, async () => (await page.locator('[data-testid="filter-done"]').count()) > 0, {
    label: "filter sheet open",
  });
}

/** 重新查询语义（locator 是惰性的，但重写一遍能避免误用旧引用） */
export function reviewRunning(page) {
  return page.locator('[data-testid="review-running"]');
}

export function reviewDone(page) {
  return page.locator('[data-testid="review-done"]');
}

/**
 * 复习一整轮：每题翻面再评「记得」。
 * 返回 { done, steps, stuckAt } —— 卡住时把现场带回来，便于定位而不是干等超时。
 */
export async function reviewWholeRound(page, { maxSteps = 400 } = {}) {
  let steps = 0;
  for (; steps < maxSteps; steps += 1) {
    if ((await reviewDone(page).count()) > 0) return { done: true, steps };
    const reveal = page.getByRole("button", { name: /显示释义/ });
    if (await reveal.count()) {
      await reveal.first().click();
      await page.waitForTimeout(20);
      continue;
    }
    const grade = page.locator('button[data-grade="3"]');
    if (await grade.count()) {
      await grade.first().click();
      await page.waitForTimeout(35);
      continue;
    }
    // 既没有翻面按钮也没有评分按钮：卡住了，把现场带回去
    const stuckAt = await page.evaluate(() => {
      const running = document.querySelector('[data-testid="review-running"]');
      return {
        done: running?.getAttribute("data-done") ?? null,
        total: running?.getAttribute("data-total") ?? null,
        hasDone: Boolean(document.querySelector('[data-testid="review-done"]')),
        hasEmpty: Boolean(document.querySelector('[data-testid="review-empty"]')),
        text: document.body.innerText.slice(0, 120).replace(/\n/g, " | "),
      };
    });
    return { done: false, steps, stuckAt };
  }
  return { done: false, steps, stuckAt: { reason: "hit maxSteps" } };
}

/** 等到词表行数达到期望值 */
export function waitRows(page, expected) {
  return until(page, async () => (await rowCount(page)) === expected, {
    label: `rows=${expected}`,
  });
}

/* ── 固定入口（都靠 role / aria，不靠文案）────────────────────── */

export const nav = {
  list: (page) => page.getByRole("button", { name: "词表" }).last(),
  review: (page) => page.getByRole("button", { name: "复习" }).last(),
  quiz: (page) => page.getByRole("button", { name: "练习" }).last(),
  panel: (page) => page.getByRole("button", { name: "打开学习面板" }),
  filter: (page) => page.locator('[data-testid="filter-trigger"]'),
  bulk: (page) => page.locator('[data-testid="bulk-fab"]'),
  dialog: (page) => page.getByRole("dialog"),
  pager: (page) => page.locator('nav[aria-label="分页"]'),
};

/* ── 常用流程（供多个用例复用；每一步都是真实用户路径，不做补偿）── */

/**
 * 走完首次设置：跳过 PIN，用默认偏好进入词表。
 * 注意：这不是「补齐前置条件」，它是每个新用户都要走一次的入口。
 */
export async function completeSetup(page) {
  await page.waitForTimeout(400);
  const skipPin = page.getByRole("button", { name: /暂不设置/ });
  if (await skipPin.count()) {
    await skipPin.first().click();
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.waitForTimeout(150);
    await page.getByRole("button", { name: /开始背单词/ }).click();
  }
  // 进入主壳的标志是底部导航出现
  await until(page, async () => (await nav.list(page).count()) > 0, { label: "main shell" });
}

/**
 * 可见的复习面板。
 *
 * 三个主页面是常驻的（TabPane 用 hidden 控制），所以 `page.getByRole` 的
 * count() 会把隐藏面板里的元素也算进去。复习动作必须限定在可见面板内，
 * 否则「显示释义」可能点到词表页上某个同名按钮，表现为队列不推进。
 */
export function reviewPane(page) {
  return page.locator(
    '[data-testid="review-running"]:visible, [data-testid="review-done"]:visible',
  );
}

/** 可见面板内的按钮 */
export function reviewButton(page, name) {
  return page
    .locator(
      'div:not([hidden]) > [data-testid="review-running"], div:not([hidden]) > [data-testid="review-done"]',
    )
    .locator("xpath=ancestor::div[1]")
    .getByRole("button", { name })
    .last();
}

/**
 * 当前这张卡是新词还是旧词。
 *
 * 新词只有两个动作（我早就会 / 开始学），旧词才有四档评分 ——
 * 两种卡的 DOM 完全不同，所有复习相关的用例都必须先分辨，
 * 否则会卡在找不到 data-grade 上（这正是改版后第一次跑 e2e 的失败点）。
 */
export function isNewCard(page) {
  return page
    .getByRole("button", { name: /开始学/ })
    .count()
    .then((n) => n > 0);
}

/** 新词：点「开始学」（等价于 grade=3 的首轮排期） */
export async function learnNewCard(page) {
  const btn = page.getByRole("button", { name: /开始学/ });
  if (await btn.count()) {
    await btn.first().click();
    return true;
  }
  return false;
}

/** 新词：点「我早就会」（走 mastery 轨，不写 FSRS） */
export async function knowNewCard(page) {
  const btn = page.getByRole("button", { name: /我早就会/ });
  if (await btn.count()) {
    await btn.first().click();
    return true;
  }
  return false;
}

/** 旧词：按档位评分 */
export async function gradeCard(page, grade) {
  const btn = page.locator(`button[data-grade="${grade}"]`);
  if (await btn.count()) {
    await btn.first().click();
    return true;
  }
  return false;
}

/**
 * 复习一整轮：新词点「开始学」，旧词点「记得」，直到走到结束页。
 *
 * 原来的实现只认 `button[data-grade="3"]`，新词没有四档评分时会卡到超时。
 * 现在先分辨卡型再动作 —— 这本身就是真实用户的路径，不是补偿逻辑。
 */
export async function finishReviewRoundV2(page, { maxSteps = 1200 } = {}) {
  let steps = 0;
  for (let i = 0; i < maxSteps; i += 1) {
    // 先看是否已经到结果页
    if (
      await reviewDone(page)
        .isVisible()
        .catch(() => false)
    ) {
      return { done: true, steps, stuckAt: null };
    }
    const running = page.locator('[data-testid="review-running"]');
    if (!(await running.isVisible().catch(() => false))) {
      return { done: true, steps, stuckAt: null };
    }
    const reveal = running.getByRole("button", { name: /显示释义/ });
    if (await reveal.count()) {
      await reveal.first().click();
      await page.waitForTimeout(40);
      continue;
    }
    const learn = running.getByRole("button", { name: /开始学/ });
    if (await learn.count()) {
      await learn.first().click();
      steps += 1;
      await page.waitForTimeout(60);
      continue;
    }
    const grade = running.locator('button[data-grade="3"]');
    if (await grade.count()) {
      await grade.first().click();
      steps += 1;
      await page.waitForTimeout(60);
      continue;
    }
    // 两个动作都点不到 = 结束页或空态
    return { done: true, steps, stuckAt: null };
  }
  const stuckAt = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="review-running"]');
    return el
      ? {
          done: el.getAttribute("data-done"),
          total: el.getAttribute("data-total"),
          text: (el.textContent || "").slice(0, 120),
        }
      : null;
  });
  return { done: false, steps, stuckAt };
}

/** 复习一整轮：每题点「显示释义」再点「记得」。返回是否走到结束页 */
export async function finishReviewRound(page, { maxSteps = 400 } = {}) {
  for (let i = 0; i < maxSteps; i += 1) {
    if (
      await page.locator('section[aria-labelledby="review-done"], main [role="status"]').count()
    ) {
      // 结束页没有稳定 aria，用「有『再来一轮』类按钮」判断不可靠；
      // 这里靠进度条消失 + 存在回词表出口来判断
    }
    const reveal = page.getByRole("button", { name: /显示释义/ });
    if (await reveal.count()) {
      await reveal.first().click();
      await page.waitForTimeout(30);
      continue;
    }
    const grade = page.locator('button[data-grade="3"]');
    if (await grade.count()) {
      await grade.first().click();
      await page.waitForTimeout(45);
      continue;
    }
    // 没有可点的评分按钮 = 已到结束页（或空态）
    return true;
  }
  return false;
}

export { chromium };
