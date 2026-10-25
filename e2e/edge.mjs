/**
 * 边界与持久化回归（结构断言版）。
 *
 * 覆盖：深链、搜索、分页、数据面板、题型开关、锁屏、词性对照。
 * 规则同 flow.mjs：不绕过被测行为，不按文案断言。
 *
 * 运行：node e2e/edge.mjs [BASE_URL]
 */

import {
  BASE,
  closePage,
  completeSetup,
  createReport,
  launch,
  nav,
  newPage,
  rowCount,
  until,
  waitDialogClosed,
  waitRows,
} from "./lib/harness.mjs";

const report = createReport();
const browser = await launch();

try {
  const page = await newPage(browser);

  /* ── 深链：直接落到 review ───────────────────────────────── */
  await page.goto(`${BASE}#/review`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await completeSetup(page);
  await page.waitForTimeout(600);
  // 首次设置完成后应回到词表（守卫会改写 lock/setup 路由）
  report.check("route.setupLandsOnList", (await page.evaluate(() => location.hash)) === "#/");

  /* ── 未知 hash 会被纠正 ──────────────────────────────────── */
  await page.goto(`${BASE}#/nonsense`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  report.check(
    "route.unknownHashCanonicalised",
    (await page.evaluate(() => location.hash)) === "#/",
    await page.evaluate(() => location.hash),
  );
  await waitRows(page, 20);
  report.check("route.unknownHashShowsList", (await rowCount(page)) > 0);

  /* ── 深链刷新到 quiz 仍渲染 ─────────────────────────────── */
  await page.goto(`${BASE}#/quiz`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  report.check("route.quizDeepLinkKept", (await page.evaluate(() => location.hash)) === "#/quiz");
  const quizPaneReady = await page
    .locator('[data-testid="quiz-empty"], [data-testid="quiz-question"]')
    .count();
  report.check("route.quizDeepLinkRenders", quizPaneReady > 0);

  await nav.list(page).click();
  await waitRows(page, 20);

  /* ── 搜索：跨全部等级、不服从等级筛选 ───────────────────── */
  const search = page.locator("#word-search");
  // 快捷键只在「焦点不在输入框」时生效：先点到空白处再按 /
  await page.locator("main").click({ position: { x: 4, y: 240 } });
  await page.waitForTimeout(120);
  await page.keyboard.press("/");
  await until(
    page,
    async () => (await page.evaluate(() => document.activeElement?.id)) === "word-search",
    { label: "slash focuses search", timeout: 3000 },
  ).catch(() => null);
  report.check(
    "search.slashFocusesInput",
    (await page.evaluate(() => document.activeElement?.id)) === "word-search",
  );
  // abandon 是 B2 词，默认筛选 A1：必须仍能搜到
  await search.fill("abandon");
  await until(page, async () => (await rowCount(page)) === 1, { label: "search hit" });
  const hit = await page.locator('[role="row"][data-key] a').first().innerText();
  report.check("search.crossesLevels", hit.toLowerCase().includes("abandon"), hit);
  await search.fill("");
  await waitRows(page, 20);

  /* ── 分页跳转 ────────────────────────────────────────────── */
  const pageJump = page.locator("#page-jump");
  await pageJump.fill("3");
  await page.waitForTimeout(400);
  const firstIndex = await page
    .locator('[role="row"][data-key]')
    .first()
    .locator("[data-row-index]")
    .getAttribute("data-row-index");
  report.check("pager.jumpsToPage", Number(firstIndex) === 41, `first=${firstIndex}`);

  /* ── 每页条数只在筛选抽屉里改 ────────────────────────────── */
  report.check(
    "pager.hasNoPageSizeControl",
    (await page.locator('nav[aria-label="分页"] select').count()) === 0,
  );

  /* ── 数据面板：导出 / 导入 / 清空三个入口 ────────────────── */
  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel" });
  await page.getByRole("tab").filter({ hasText: /数据/ }).click();
  const dataPane = await page.locator('[role="dialog"]').innerText();
  report.check("data.hasExport", /导出/.test(dataPane));
  report.check("data.hasImport", /导入/.test(dataPane));
  report.check("data.hasWipe", /清空/.test(dataPane));

  // 清空需要二次确认：点开确认区，再取消（不真的清）
  await page.getByRole("button", { name: /清空进度/ }).click();
  await until(
    page,
    async () =>
      (await page
        .locator('[role="dialog"] button')
        .filter({ hasText: /确认|真的/ })
        .count()) > 0,
    { label: "wipe confirm" },
  );
  report.check("data.wipeNeedsConfirm", true);
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

  /* ── 题型开关：至少保留一种 ──────────────────────────────── */
  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel 2" });
  await page.getByRole("tab").filter({ hasText: /学习/ }).click();
  const typeGroup = page.locator('[data-testid="quiz-type-group"]');
  report.check("panel.quizTypeGroupExists", (await typeGroup.count()) === 1);
  const typeButtons = typeGroup.getByRole("button");
  const typeCount = await typeButtons.count();
  report.check("panel.quizTypeHasThree", typeCount === 3, `n=${typeCount}`);
  // 关掉前两个，第三个应当变成不可再关
  if (typeCount === 3) {
    await typeButtons.nth(0).click();
    await page.waitForTimeout(150);
    await typeButtons.nth(1).click();
    await page.waitForTimeout(150);
    const pressedLeft = await typeGroup.locator('button[aria-pressed="true"]').count();
    report.check("panel.quizTypeKeepsOne", pressedLeft === 1, `left=${pressedLeft}`);
    const disabled = await typeButtons.nth(2).isDisabled();
    report.check("panel.lastQuizTypeLocked", disabled);
    // 恢复，避免影响后续用例
    await typeButtons.nth(0).click();
    await typeButtons.nth(1).click();
    await page.waitForTimeout(150);
  }
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

  /* ── 学习面板不再有新词配额 ──────────────────────────────── */
  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel 3" });
  await page.getByRole("tab").filter({ hasText: /学习/ }).click();
  report.check("panel.noNewWordsQuota", (await page.locator("#pref-new-per-day").count()) === 0);
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

  /* ── 锁屏：立即锁定 → 未解锁时看不到主界面 ───────────────── */
  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel 4" });
  await page.getByRole("tab").filter({ hasText: /设置/ }).click();
  // 这个会话没设过 PIN，所以没有「立即锁定」；有则点
  const lockNow = page.getByRole("button", { name: /立即锁定/ });
  if ((await lockNow.count()) > 0) {
    await lockNow.click();
    await until(page, async () => (await page.locator('[aria-label="数字键盘"]').count()) > 0, {
      label: "lockscreen",
    });
    report.check("lock.hidesMainShell", (await nav.list(page).count()) === 0);
  } else {
    report.note("lock.hidesMainShell", "skipped: 本会话未启用锁屏（未设 PIN）");
  }

  /* ── 词性对照：独立路由，返回后主界面仍在 ────────────────── */
  await page.goto(`${BASE}#/guide`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  report.check("guide.route", (await page.evaluate(() => location.hash)) === "#/guide");
  const guideMain = await page.locator("main").innerText();
  report.check("guide.renders", guideMain.length > 50, `${guideMain.length} chars`);
  await page.goto(`${BASE}#/`, { waitUntil: "networkidle" });
  await waitRows(page, 20);
  report.check("guide.backToList", (await rowCount(page)) > 0);

  report.errors.push(...page.__errors);
  await closePage(page);
} catch (error) {
  report.errors.push(`edge crashed: ${error.message}`);
} finally {
  await browser.close();
}

const summary = report.summary();
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
