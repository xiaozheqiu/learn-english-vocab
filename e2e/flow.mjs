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
  openAbout,
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
    "filter.sectionsAreLevelTierOxfordPosInitialModeSize",
    [
      "filter-level",
      "filter-tier",
      "filter-oxford",
      "filter-pos",
      "filter-initial",
      "filter-mode",
      "filter-size",
    ].every((id) => filterSections.includes(id)),
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

  /* ── 3b-2. 词性与首字母 ─────────────────────────────────────── */
  /*
   * 两条都按结构断言：词性看每行的 data-pos 是否都含目标大类，
   * 字母看 data-key 里的单词首字符。不查按钮文案。
   *
   * 词性先清回「全部等级」，否则 A1 里没有 modal v. 之类会让人怀疑筛选坏了。
   */
  const rowPos = () =>
    page.locator('[role="row"][data-key]').evaluateAll((els) => els.map((el) => el.dataset.pos));
  const rowWords = () =>
    page
      .locator('[role="row"][data-key]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-key").split("|")[1]));

  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-reset"]').click();
  await nav
    .dialog(page)
    .locator('[data-testid="filter-pos"]')
    .getByRole("button", { name: "动词" })
    .click();
  const verbPreview = await page
    .locator('[data-testid="filter-preview"]')
    .getAttribute("data-count");
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await until(page, async () => (await rowCount(page)) > 0, { label: "verb rows" });
  const verbs = await rowPos();
  report.check(
    "filter.posMatchesEveryRow",
    verbs.length > 0 && verbs.every((pos) => /(^|[,/]\s*)(modal |auxiliary )?v\./.test(pos)),
    verbs.slice(0, 3).join(" / "),
  );
  report.check(
    "filter.previewCountsBeforeApply",
    Number(verbPreview) ===
      Number(await page.locator('[data-testid="word-grid"]').getAttribute("aria-rowcount")),
    `${verbPreview}`,
  );

  // 叠加首字母：剩下的每一行都必须以该字母开头
  await openFilter(page);
  await nav
    .dialog(page)
    .locator('[data-testid="filter-initial"]')
    .getByRole("button", { name: "S 开头" })
    .click();
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await until(page, async () => (await rowCount(page)) > 0, { label: "verb + s rows" });
  const verbS = await rowWords();
  report.check(
    "filter.initialCombinesWithPos",
    verbS.length > 0 && verbS.every((word) => word.toLowerCase().startsWith("s")),
    verbS.slice(0, 5).join(","),
  );

  /*
   * 首字母是普通筛选条件：在当前等级内生效，不得把用户拉离他设的等级。
   *
   * 这条曾经做反过 —— 选字母就悄悄跳到全库，停在 A1 的人会被莫名带走。
   * 所以这里钉两条：停在 A1 选 S 仍全部是 A1（A1 里有 96 条 s 开头，
   * 不会退化成空态，断言才有力）；把等级改成「全部」后同一个 S 才跨等级。
   */
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-reset"]').click();
  // 只选等级 A1，字母仍留在「全部」
  await nav.dialog(page).locator('[data-testid="filter-level"]').getByRole("button").nth(0).click();
  await nav
    .dialog(page)
    .locator('[data-testid="filter-initial"]')
    .getByRole("button", { name: "S 开头" })
    .click();
  const a1Preview = await page.locator('[data-testid="filter-preview"]').getAttribute("data-count");
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await until(page, async () => (await rowCount(page)) > 0, { label: "A1 s rows" });
  const a1s = await page
    .locator('[role="row"][data-key]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-key").split("|")[0]));
  // 非空 + 全是 A1 + 总数远少于全库的 603（A1 里只有 96 条），三条缺一不可
  report.check(
    "filter.initialStaysInsideLevel",
    a1s.length > 0 &&
      a1s.every((level) => level === "A1") &&
      Number(a1Preview) === 96 &&
      Number(await page.locator('[data-testid="word-grid"]').getAttribute("aria-rowcount")) === 96,
    `preview=${a1Preview} levels=${[...new Set(a1s)].join(",")}`,
  );

  // 同一个 Z，等级改成「全部」才跨等级 —— 「跨不跨」由等级条件说了算
  await openFilter(page);
  await nav
    .dialog(page)
    .locator('[data-testid="filter-level"]')
    .getByRole("button", { name: "全部", exact: true })
    .click();
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await until(page, async () => (await rowCount(page)) > 0, { label: "s rows across levels" });
  const allS = await page.locator('[data-testid="word-grid"]').getAttribute("aria-rowcount");
  const sLevels = await page
    .locator('[role="row"][data-key]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-key").split("|")[0]));
  /*
   * 断言的是总数从 96 涨到 603，不是「第一页混着多个等级」——
   * 词表按 A1→C1 顺序平铺，第一页本来就全是 A1 的词，拿页内等级分布
   * 判断跨没跨等级是错的（头一版就这么写错了一次）。
   */
  report.check(
    "filter.initialCrossLevelsOnlyWhenLevelIsAll",
    Number(allS) === 603,
    `total=${allS}（A1 单独只有 96）`,
  );

  // 复原：回到全部等级、无词性、无字母
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-reset"]').click();
  const resetPreview = await page
    .locator('[data-testid="filter-preview"]')
    .getAttribute("data-count");
  report.check("filter.resetClearsNewDimensions", Number(resetPreview) === 5323, resetPreview);
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await waitRows(page, 20);

  /* ── 3b-3. 抽屉操作条固定，不随条件列表滚出视口 ──────────── */
  await openFilter(page);
  // 抽屉是从底部滑上来的（200ms），测量要等它落位，否则读到动画中间帧
  await page.waitForTimeout(400);
  const doneBox = await page.locator('[data-testid="filter-done"]').boundingBox();
  const viewport = page.viewportSize();
  report.check(
    "filter.doneButtonStaysVisible",
    doneBox !== null && doneBox.y + doneBox.height <= viewport.height + 1,
    `y=${doneBox?.y} h=${doneBox?.height} vh=${viewport.height}`,
  );
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

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

  /*
   * ── 8. 顶栏只剩一个「关于」入口 ────────────────────────────
   *
   * 面板收成单页：数据分区（导出 / 导入 / 清空）与设置分区（每页条数 / 默认等级）
   * 都移除。这里钉住三件事，防止它们偷偷回来：
   *   1. 顶栏入口只有「关于」，没有齿轮；
   *   2. 面板里没有任何 tab 分区；
   *   3. 导出的 JSON 与「清空进度」在界面上彻底不存在。
   */
  report.check(
    "panel.singleAboutEntry",
    (await page.locator('button[aria-label="关于"]').count()) === 1 &&
      (await page.getByRole("button", { name: "打开学习面板" }).count()) === 0,
  );

  await openAbout(page);
  const dialog = nav.dialog(page);
  report.check("panel.noTabs", (await page.getByRole("tab").count()) === 0);
  const aboutText = await dialog.innerText();
  report.check("panel.keepsAbout", /关于/.test(aboutText) && /5323/.test(aboutText));
  report.check(
    "panel.noDataSection",
    (await page.getByRole("button", { name: /导出 JSON/ }).count()) === 0 &&
      (await page.getByRole("button", { name: /选择 JSON 文件/ }).count()) === 0 &&
      (await page.getByRole("button", { name: /清空进度/ }).count()) === 0 &&
      !/导入备份/.test(aboutText),
  );
  report.check(
    "panel.noSettingsSection",
    (await page.locator("#pref-page-size").count()) === 0 &&
      (await page.locator("#pref-default-level").count()) === 0 &&
      !/每页条数/.test(aboutText),
  );
  // 关于里还留着两个真正有用的动作：检查更新、打开词性对照
  report.check(
    "panel.keepsUpdateCheck",
    (await page.locator('[data-testid="check-update"]').count()) === 1,
  );
  report.check(
    "panel.keepsGuideEntry",
    (await page.getByRole("button", { name: /打开词性对照表/ }).count()) === 1,
  );
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

  await openAbout(page);
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

  /*
   * 桌面抽屉（side=center）也必须限高：条件加到 7 组后内容 1217px，
   * 不限高会被撑出视口、上下裁掉，「确定」直接点不到。
   * 这里量的是「按钮完整落在视口内 + 能点到」，不是查样式类名。
   */
  await openFilter(desktop);
  await desktop.waitForTimeout(400);
  const dDone = await desktop.locator('[data-testid="filter-done"]').boundingBox();
  const dView = desktop.viewportSize();
  const dDialog = await desktop.locator('[role="dialog"]').boundingBox();
  report.check(
    "desktop.filterSheetFitsViewport",
    dDialog !== null &&
      dDialog.y >= 0 &&
      dDialog.y + dDialog.height <= dView.height + 1 &&
      dDone !== null &&
      dDone.y + dDone.height <= dView.height + 1,
    `dialog y=${dDialog?.y} h=${dDialog?.height} doneBottom=${dDone && dDone.y + dDone.height} vh=${dView.height}`,
  );
  await desktop.locator('[data-testid="filter-done"]').click({ timeout: 4000 });
  // Radix 关闭有 200ms 退场动画，元素不会立刻卸载
  await waitDialogClosed(desktop);
  report.check(
    "desktop.filterDoneClickable",
    (await desktop.locator('[data-testid="filter-done"]').count()) === 0,
  );
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
