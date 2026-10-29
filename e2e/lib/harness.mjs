/**
 * 浏览器回归的公共层。
 *
 * 两条硬规则（写在这里，也写进 README）：
 *
 * 1. **不为让流程跑通而绕过被测行为。**
 *    如果某一步本该发生却没发生，就让它失败。绝不「帮它把前置条件补齐」——
 *    那等于把要测的规则绕过去了，测试还会一路绿灯。
 *
 * 2. **断言查结构，不查文案。**
 *    查 `[role="row"][data-key]` 的数量、`aria-pressed` 的值、URL 的 hash、
 *    `data-*` 属性——而不是查「已掌握」「全库掌握度」这类会随文案调整而变的字符串。
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
    /** @param {string} name 结构化的名字，例如 list.masteryToggles */
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

/** 等到词表行数达到期望值 */
export function waitRows(page, expected) {
  return until(page, async () => (await rowCount(page)) === expected, {
    label: `rows=${expected}`,
  });
}

/**
 * 进入主壳。
 *
 * 应用现在没有锁屏也没有首次向导：打开就是词表，
 * 「主壳就绪」的结构标志是词表网格出现且已渲染出第一批行。
 */
export async function waitMainShell(page) {
  await until(page, async () => (await page.locator('[data-testid="word-grid"]').count()) > 0, {
    label: "main shell",
  });
}

/* ── 固定入口（都靠 role / aria，不靠文案）────────────────────── */

export const nav = {
  list: (page) => page.getByRole("tab", { name: "词表" }).last(),
  guide: (page) => page.getByRole("tab", { name: "词性对照" }).last(),
  panel: (page) => page.getByRole("button", { name: "打开学习面板" }),
  filter: (page) => page.locator('[data-testid="filter-trigger"]'),
  bulk: (page) => page.locator('[data-testid="bulk-fab"]'),
  dialog: (page) => page.getByRole("dialog"),
  pager: (page) => page.locator('nav[aria-label="分页"]'),
};

export { chromium };
