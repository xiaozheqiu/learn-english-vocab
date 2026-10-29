/**
 * 核心流程回归（结构断言版）。
 *
 * 规则见 lib/harness.mjs 顶部：不绕过被测行为、不按文案断言。
 * 覆盖：词表渲染、掌握切换、筛选抽屉（草稿 → 确定生效）、板块进度、
 * 批量标记、分页跳转、跨等级搜索、面板三个分区、以及「已移除功能不得回来」。
 *
 * 运行：node e2e/flow.mjs [BASE_URL]
 */

import {
  BASE,
  VIEWPORTS,
  closePage,
  createReport,
  launch,
  nav,
  newPage,
  openFilter,
  rowCount,
  until,
  waitDialogClosed,
  waitMainShell,
  waitRows,
} from "./lib/harness.mjs";

const report = createReport();
const browser = await launch();

try {
  const page = await newPage(browser, VIEWPORTS.mobile);

  /* ── 1. 打开即词表（没有锁屏、没有首次向导）───────────────── */
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitMainShell(page);
  report.check(
    "shell.noSetupWizard",
    (await page.getByRole("button", { name: /下一步/ }).count()) === 0,
  );
  report.check("shell.noPinPad", (await page.locator('[aria-label="数字键盘"]').count()) === 0);
  // 没有 hash 也是词表：地址栏保持干净，不强行写一个 "#/"
  const initialHash = await page.evaluate(() => location.hash);
  report.check("shell.landsOnList", initialHash === "" || initialHash === "#/", initialHash);

  /* ── 2. 词表 ─────────────────────────────────────────────── */
  await waitRows(page, 20);
  report.check("list.rendersPage", (await rowCount(page)) === 20);
  report.check(
    "list.defaultScopeIsA1",
    (await page.locator('[role="row"][data-key]').first().getAttribute("data-key")).startsWith(
      "A1|",
    ),
  );

  // 每行两个动作：勾选框 + 掌握药丸（不能出现第三个语义重复的开关）
  const rowButtons = await page.locator('[role="row"][data-key]').first().locator("button").count();
  report.check("list.rowHasTwoActions", rowButtons === 2, `buttons=${rowButtons}`);

  // 掌握切换：按 aria-pressed 判断，不读文案
  const masteryBtn = page
    .locator('[role="row"][data-key]')
    .first()
    .locator("button")
    .filter({ hasNot: page.locator('[role="checkbox"]') })
    .last();
  const before = await masteryBtn.getAttribute("aria-pressed");
  await masteryBtn.click();
  await until(page, async () => (await masteryBtn.getAttribute("aria-pressed")) !== before, {
    label: "mastery toggled",
  });
  report.check("list.masteryToggles", (await masteryBtn.getAttribute("aria-pressed")) === "true");
  await masteryBtn.click();
  await page.waitForTimeout(200);

  /*
   * 「难度（CEFR）」筛选已移除：它和等级在 5323 条里 5280 条完全一致，
   * 等于同一个轴做了两遍。这组断言盯住它不得回到抽屉里。
   */
  await openFilter(page);
  report.check(
    "filter.noCefrAxis",
    (await page.locator('[data-testid="filter-cefr"]').count()) === 0 &&
      !(await nav.dialog(page).innerText()).includes("CEFR"),
  );
  const filterSections = await page
    .locator('[role="dialog"] [data-testid^="filter-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  report.check(
    "filter.sectionsAreLevelTierOxfordModeSize",
    ["filter-level", "filter-tier", "filter-oxford", "filter-mode", "filter-size"].every((id) =>
      filterSections.includes(id),
    ),
    filterSections.join(","),
  );
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

  /* ── 3. 筛选（抽屉，确定后才生效）────────────────────────── */
  const filterBar = page.locator('section[aria-label="词表筛选"]');
  const barHeightBefore = (await filterBar.boundingBox()).height;
  await openFilter(page);
  const barHeightDuring = (await filterBar.boundingBox()).height;
  report.check(
    "filter.noLayoutShift",
    Math.abs(barHeightBefore - barHeightDuring) < 2,
    `${barHeightBefore} → ${barHeightDuring}`,
  );

  // 选「已掌握」→ 刚才那行已被取消标记，应当为空态
  await nav.dialog(page).locator('[data-testid="filter-mode"]').getByRole("button").nth(2).click();
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await until(page, async () => (await rowCount(page)) === 0, { label: "empty after filter" });
  report.check("filter.applies", (await rowCount(page)) === 0);

  // 清空筛选回到 20 行
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-reset"]').click();
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await waitRows(page, 20);
  report.check("filter.resets", (await rowCount(page)) === 20);

  /* ── 3b. 抽屉里改条件不即时生效 ──────────────────────────── */
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-level"]').getByRole("button").nth(1).click(); // A2
  await page.waitForTimeout(300);
  report.check(
    "filter.draftDoesNotApply",
    (await rowCount(page)) === 20 &&
      (await page.locator('[role="row"][data-key]').first().getAttribute("data-key")).startsWith(
        "A1|",
      ) &&
      (await page.locator('[data-testid="filter-preview"]').getAttribute("data-pending")) === "1",
  );
  // 关掉（Esc）= 丢弃草稿
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);
  report.check(
    "filter.discardsDraftOnClose",
    !(await page.locator('[data-testid="filter-trigger"]').innerText()).includes("A2"),
  );

  // 再选一次并确定，这次必须生效
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-level"]').getByRole("button").nth(1).click();
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await until(
    page,
    async () =>
      (await page.locator('[role="row"][data-key]').first().getAttribute("data-key"))?.startsWith(
        "A2|",
      ),
    { label: "filter applied after confirm" },
  );
  report.check(
    "filter.appliesOnConfirm",
    (await page.locator('[data-testid="filter-trigger"]').innerText()).includes("A2"),
  );

  /* ── 3c. 板块进度：跟着板块走，标记已掌握后 +1 ─────────────── */
  const scopeEl = page.locator('[data-testid="scope-progress"]');
  const scopeOf = async () => ({
    scope: await scopeEl.getAttribute("data-scope"),
    mastered: Number(await scopeEl.getAttribute("data-mastered")),
    total: Number(await scopeEl.getAttribute("data-total")),
  });
  const a2Before = await scopeOf();
  report.check(
    "scope.followsLevel",
    a2Before.scope === "A2" && a2Before.total > 0 && a2Before.mastered === 0,
    JSON.stringify(a2Before),
  );
  const markBtn = page
    .locator('[role="row"][data-key]')
    .first()
    .locator("button")
    .filter({ hasNot: page.locator('[role="checkbox"]') })
    .last();
  await markBtn.click();
  await until(page, async () => (await scopeOf()).mastered === a2Before.mastered + 1, {
    label: "scope mastery +1",
  });
  report.check("scope.countsMastery", true);
  // 恢复：取消标记 + 回到全库
  await markBtn.click();
  await until(page, async () => (await scopeOf()).mastered === a2Before.mastered, {
    label: "scope mastery restored",
  });
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-reset"]').click();
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await waitRows(page, 20);
  report.check("scope.resetToAllLevels", (await scopeOf()).scope === "ALL");

  /* ── 4. 批量（浮动按钮 + 抽屉）──────────────────────────── */
  const fab = nav.bulk(page);
  report.check("bulk.fabIsIconOnly", (await fab.innerText()).trim() === "");
  const fabBox = await fab.boundingBox();
  report.check("bulk.fabIsSquare", Math.abs(fabBox.width - fabBox.height) < 2);

  await fab.click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "bulk sheet" });
  const selectAll = nav.dialog(page).getByRole("button", { name: /全选/ }).first();
  report.check("bulk.selectAllVisibleWithoutExpand", await selectAll.isVisible());
  await selectAll.click();
  await waitDialogClosed(page);
  await until(
    page,
    async () => {
      const label = await fab.getAttribute("aria-label");
      return label && /\d/.test(label);
    },
    { label: "fab shows count" },
  );
  report.check("bulk.countOnFab", /\d/.test(await fab.getAttribute("aria-label")));

  // 批量标记已掌握：抽屉里的动作执行完要关掉，并且真的落到行上
  await fab.click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "bulk sheet 2" });
  await nav.dialog(page).locator('[data-testid="bulk-mark"]').click();
  await waitDialogClosed(page);
  report.check(
    "bulk.batchActionClosesSheet",
    (await page.locator('[data-testid="bulk-sheet"]').count()) === 0,
  );
  const pressedCount = await page
    .locator('[role="row"][data-key]')
    .evaluateAll(
      (rows) =>
        rows.filter((row) =>
          [...row.querySelectorAll("button")].some(
            (b) => b.getAttribute("aria-pressed") === "true",
          ),
        ).length,
    );
  report.check("bulk.batchActionApplied", pressedCount === 20, `pressed=${pressedCount}`);

  /*
   * 撤销这批标记，避免影响后续用例。
   *
   * 批量动作执行完会清空选中集合（抽屉里的按钮随之禁用），
   * 所以要先重新全选本页，再点「取消已掌握」—— 这是真实用户路径，不是补偿。
   */
  await fab.click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "bulk sheet 3" });
  await nav.dialog(page).getByRole("button", { name: /全选/ }).first().click();
  await waitDialogClosed(page);
  await fab.click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "bulk sheet 4" });
  await nav.dialog(page).locator('[data-testid="bulk-unmark"]').click();
  await waitDialogClosed(page);
  const stillPressed = await page
    .locator('[role="row"][data-key]')
    .evaluateAll((rows) =>
      rows.some((row) =>
        [...row.querySelectorAll("button")].some((b) => b.getAttribute("aria-pressed") === "true"),
      ),
    );
  report.check("bulk.batchUnmarkApplied", !stillPressed);

  /* ── 5. 分页跳转 ────────────────────────────────────────── */
  const pageJump = page.locator("#page-jump");
  await pageJump.fill("3");
  await pageJump.press("Enter");
  await page.waitForTimeout(400);
  const firstIndex = await page
    .locator('[role="row"][data-key]')
    .first()
    .locator("[data-row-index]")
    .getAttribute("data-row-index");
  report.check("pager.jumpsToPage", Number(firstIndex) === 41, `first=${firstIndex}`);
  await pageJump.fill("1");
  await pageJump.press("Enter");
  await waitRows(page, 20);

  /* ── 6. 搜索：跨全部等级、不服从等级筛选 ─────────────────── */
  const search = page.locator("#word-search");
  // 快捷键只在「焦点不在输入框」时生效：先点到空白处再按 /
  await page.locator("main").click({ position: { x: 4, y: 240 } });
  await page.waitForTimeout(120);
  await page.keyboard.press("/");
  await page.waitForTimeout(200);
  report.check(
    "search.slashFocusesInput",
    (await page.evaluate(() => document.activeElement?.id)) === "word-search",
  );
  // abandon 是 B2 词，默认筛选 A1：必须仍能搜到
  await search.fill("abandon");
  await until(page, async () => (await rowCount(page)) > 0, { label: "search hit" });
  const hit = await page.locator('[role="row"][data-key] a').first().innerText();
  report.check("search.crossesLevels", hit.toLowerCase().includes("abandon"), hit);
  await search.fill("");
  await waitRows(page, 20);

  /* ── 7. 已移除的功能不得留入口 ──────────────────────────── */
  report.check("gone.noReviewTab", (await page.getByRole("tab", { name: "复习" }).count()) === 0);
  report.check("gone.noQuizTab", (await page.getByRole("tab", { name: "练习" }).count()) === 0);
  report.check(
    "gone.noBottomNavOnMobile",
    (await page.locator('nav[aria-label="主导航"]').count()) === 0,
  );
  // 旧深链（复习 / 测试 / 锁屏）回落到词表，不留死页
  for (const gone of ["#/review", "#/quiz", "#/lock", "#/leech"]) {
    await page.goto(`${BASE}${gone}`, { waitUntil: "networkidle" });
    await waitMainShell(page);
    report.check(
      `gone.legacyHashFallsBack${gone}`,
      (await page.evaluate(() => location.hash)) === "#/",
      await page.evaluate(() => location.hash),
    );
  }
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitRows(page, 20);

  /* ── 8. 学习面板：只有数据 / 设置 / 关于 ─────────────────── */
  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel" });
  const dialog = nav.dialog(page);
  report.check("panel.tabCount", (await page.getByRole("tab").count()) === 3);
  report.check(
    "panel.hasNoCoverageCard",
    (await dialog.locator('[data-testid="coverage-card"]').count()) === 0,
  );
  report.check(
    "panel.hasNoReviewSize",
    (await dialog.locator('[data-testid="review-size-group"]').count()) === 0,
  );
  report.check(
    "panel.hasNoQuizSize",
    (await dialog.locator('[data-testid="quiz-size-group"]').count()) === 0,
  );
  report.check(
    "panel.hasNoQuizTypes",
    (await dialog.locator('[data-testid="quiz-type-group"]').count()) === 0,
  );

  // 数据分区：导出 / 导入 / 清空三件套还在
  const dataPane = await dialog.innerText();
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
        .filter({ hasText: /确认清空/ })
        .count()) > 0,
    { label: "wipe confirm" },
  );
  report.check("data.wipeNeedsConfirm", true);
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

  /* ── 9. 设置分区：只剩词表偏好，没有学习节奏与锁屏 ───────── */
  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel 2" });
  await page.getByRole("tab").filter({ hasText: /设置/ }).click();
  const settingsPane = await page.locator('[role="dialog"]').innerText();
  report.check("settings.hasPageSize", /每页条数/.test(settingsPane));
  report.check("settings.hasDefaultLevel", /默认等级/.test(settingsPane));
  report.check("settings.noRetention", !/留存率/.test(settingsPane));
  report.check("settings.noAutoLock", !/自动锁定/.test(settingsPane));
  report.check("settings.noPin", !/PIN/.test(settingsPane));
  report.check("settings.noNewWordsQuota", (await page.locator("#pref-new-per-day").count()) === 0);
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

  /* ── 10. 词性对照：面板入口进入，返回后词表状态还在 ───────── */
  await openFilter(page);
  // 等级按钮顺序：A1 / A2 / B1 / B2 / C1 / 全部
  await nav.dialog(page).locator('[data-testid="filter-level"]').getByRole("button").nth(2).click();
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await until(
    page,
    async () =>
      (await page.locator('[role="row"][data-key]').first().getAttribute("data-key"))?.startsWith(
        "B1|",
      ),
    { label: "B1 applied" },
  );

  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel 3" });
  await page.getByRole("tab").filter({ hasText: /关于/ }).click();
  await page.getByRole("button", { name: /打开词性对照表/ }).click();
  await waitDialogClosed(page);
  await until(page, async () => (await page.evaluate(() => location.hash)) === "#/guide", {
    label: "guide route",
  });
  const guideText = await page.locator("main").innerText();
  report.check("guide.renders", guideText.length > 50, `${guideText.length} chars`);

  await page.getByRole("button", { name: /返回词表/ }).click();
  await until(page, async () => (await page.evaluate(() => location.hash)) === "#/", {
    label: "back to list",
  });
  await waitRows(page, 20);
  report.check(
    "guide.backKeepsListState",
    (await page.locator('[role="row"][data-key]').first().getAttribute("data-key"))?.startsWith(
      "B1|",
    ),
  );

  report.errors.push(...page.__errors);
  await closePage(page);

  /* ── 11. 桌面：tablist 两根页签，直接切词性对照 ─────────────── */
  const desktop = await newPage(browser, VIEWPORTS.wide);
  await desktop.goto(BASE, { waitUntil: "networkidle" });
  await waitRows(desktop, 20);
  report.check("desktop.hasTablist", (await desktop.locator('[role="tablist"]').count()) === 1);
  await nav.guide(desktop).click();
  await until(desktop, async () => (await desktop.evaluate(() => location.hash)) === "#/guide", {
    label: "desktop guide route",
  });
  // 词性对照是懒挂载 + Markdown 渲染，等正文真的出来再断言（不靠固定 sleep）
  const guideChars = await until(
    desktop,
    async () => {
      const text = (await desktop.locator("main").innerText()).trim();
      return text.length > 50 ? text.length : 0;
    },
    { label: "desktop guide rendered" },
  );
  report.check("desktop.guideTabWorks", guideChars > 50, `${guideChars} chars`);
  report.errors.push(...desktop.__errors);
  await closePage(desktop);
} catch (error) {
  report.errors.push(`flow crashed: ${error.message}`);
} finally {
  await browser.close();
}

const summary = report.summary();
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
