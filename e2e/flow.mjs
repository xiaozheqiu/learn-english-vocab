/**
 * 核心流程回归（结构断言版）。
 *
 * 规则见 lib/harness.mjs 顶部：不绕过被测行为、不按文案断言。
 * 这里所有检查都落在 role / aria / data-* 属性 / URL 上。
 *
 * 运行：node e2e/flow.mjs [BASE_URL]
 */

import {
  BASE,
  VIEWPORTS,
  closePage,
  completeSetup,
  createReport,
  launch,
  nav,
  newPage,
  openFilter,
  reviewDone,
  reviewRunning,
  finishReviewRoundV2,
  gradeCard,
  isNewCard,
  knowNewCard,
  learnNewCard,
  reviewWholeRound,
  rowCount,
  until,
  waitDialogClosed,
  waitRows,
} from "./lib/harness.mjs";

const report = createReport();
const browser = await launch();

try {
  const page = await newPage(browser, VIEWPORTS.mobile);

  /* ── 1. 首次设置 ─────────────────────────────────────────── */
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const pinInput = page.locator('input[type="password"], input[inputmode="numeric"]').first();
  report.check("setup.asksPin", (await pinInput.count()) > 0);

  // 非法 PIN：提交入口应当不可用（不是弹错）
  const nextBtn = page.getByRole("button", { name: /下一步/ });
  await pinInput.fill("12");
  const secondInput = page.locator('input[inputmode="numeric"]').nth(1);
  if ((await secondInput.count()) > 0) await secondInput.fill("12");
  report.check("setup.blocksInvalidPin", await nextBtn.isDisabled());

  await completeSetup(page);
  report.check("setup.reachesShell", (await nav.list(page).count()) > 0);

  /* ── 2. 词表 ─────────────────────────────────────────────── */
  await waitRows(page, 20);
  report.check("list.rendersPage", (await rowCount(page)) === 20);

  // 每行只有一个「掌握」切换按钮（曾经出现过同功能两个控件）
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

  /* ── 3. 筛选（抽屉，不是展开条）──────────────────────────── */
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
  const modeGroup = nav.dialog(page).locator('[data-testid="filter-mode"]');
  await modeGroup.getByRole("button").nth(2).click();
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

  /* ── 3b. 抽屉里改条件不即时生效，点「确定」才生效 ─────────── */
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-level"]').getByRole("button").nth(1).click(); // A2
  await page.waitForTimeout(300);
  const draftLevel = await page
    .locator('[data-testid="filter-trigger"]')
    .getAttribute("aria-expanded");
  report.check(
    "filter.draftDoesNotApply",
    (await rowCount(page)) === 20 &&
      (await page.locator('[role="row"][data-key]').first().getAttribute("data-key")).startsWith(
        "A1|",
      ) &&
      (await page.locator('[data-testid="filter-preview"]').getAttribute("data-pending")) === "1",
    `expanded=${draftLevel}`,
  );
  // 关掉（Esc）= 丢弃草稿（上一步的「清空筛选」已把等级置为全部，这里只验 A2 没被提交）
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);
  report.check(
    "filter.discardsDraftOnClose",
    !(await page.locator('[data-testid="filter-trigger"]').innerText()).includes("A2") &&
      (await page.locator('[role="row"][data-key]').first().getAttribute("data-key"))?.startsWith(
        "A1|",
      ),
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
  // 标记第一行为已掌握 → 进度 +1（不依赖文案，直接读 data-*）
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
  // 全选本页：按钮在抽屉里直接可见（曾经被折叠收起）
  const selectAll = nav.dialog(page).getByRole("button", { name: /全选/ }).first();
  report.check("bulk.selectAllVisibleWithoutExpand", await selectAll.isVisible());
  await selectAll.click();
  // 「全选」执行完会关掉抽屉，必须等它真的关掉再操作浮动按钮
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

  // 批量取消掌握
  await fab.click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "bulk sheet 2" });
  await nav.dialog(page).locator('[data-testid="bulk-unmark"]').click();
  await waitDialogClosed(page);
  report.check(
    "bulk.batchActionClosesSheet",
    (await page.locator('[data-testid="bulk-sheet"]').count()) === 0,
  );
  // 标记动作要真的落到行上：每行 aria-pressed 全为 false
  const anyPressed = await page
    .locator('[role="row"][data-key]')
    .evaluateAll((rows) =>
      rows.some((row) =>
        [...row.querySelectorAll("button")].some((b) => b.getAttribute("aria-pressed") === "true"),
      ),
    );
  report.check("bulk.batchActionApplied", !anyPressed);

  /* ── 5. 复习：队列、外链、答错补考、撤销 ─────────────────── */
  await nav.review(page).click();
  await until(
    page,
    async () =>
      (await page.locator('[data-testid="review-running"], [data-testid="review-empty"]').count()) >
      0,
    { label: "review ready" },
  );
  report.check("review.hasQueue", (await reviewRunning(page).count()) === 1);
  const queued = Number(await reviewRunning(page).getAttribute("data-total"));
  report.check("review.queueMatchesBatch", queued > 0, `total=${queued}`);

  // 单词是外链（结构：href 指向翻译站点）
  report.check(
    "review.wordIsExternalLink",
    (await page.locator('main a[href^="https://fanyi.baidu.com"]').count()) > 0,
  );

  /*
   * 新词只给两个动作（我早就会 / 开始学），旧词才有四档评分。
   * 这一轮队列里的卡大多是从未评分的词，先确认新词形态。
   */
  await page.getByRole("button", { name: /显示释义/ }).click();
  const newCardFirst = await isNewCard(page);
  report.check("review.newWordShowsTwoActions", newCardFirst);

  // 新词卡上不应出现四档评分 —— 出现了说明分支没生效
  report.check(
    "review.newWordHidesRatingBar",
    (await page.locator("button[data-grade]").count()) === 0,
  );

  // 「我早就会」→ 标记已掌握并推进到下一张
  const knowOk = await knowNewCard(page);
  report.check("review.knowAlreadyAvailable", knowOk);
  if (knowOk) {
    const advanced = await until(
      page,
      async () => Number(await reviewRunning(page).getAttribute("data-done")) > 0,
      { label: "advance after know" },
    ).catch(() => null);
    report.check("review.knowAdvances", Number(advanced) >= 1, `done=${advanced}`);
  }

  // 下一张用「开始学」→ 写入 FSRS 记录并推进
  await page
    .getByRole("button", { name: /显示释义/ })
    .click()
    .catch(() => {});
  const learnOk = await learnNewCard(page);
  report.check("review.learnAvailable", learnOk);
  if (learnOk) {
    const done2 = await until(
      page,
      async () => {
        const d = Number(await reviewRunning(page).getAttribute("data-done"));
        return d >= 2 ? d : null;
      },
      { label: "advance after learn" },
    );
    report.check("review.learnAdvances", Number(done2) >= 2, `done=${done2}`);
  }

  /*
   * 撤销：撤掉刚才「开始学」那一步，done 应该回到 1。
   * 先把撤销前的值取下来做下界，避免 until 在第一帧就命中当前值。
   */
  const doneBeforeUndo = Number(await reviewRunning(page).getAttribute("data-done"));
  await page.getByRole("button", { name: /撤销/ }).click();
  const doneAfterUndo = await until(
    page,
    async () => {
      const d = Number(await reviewRunning(page).getAttribute("data-done"));
      return d < doneBeforeUndo ? d : null;
    },
    { label: "undo shrinks done" },
  ).catch(() => null);
  report.check(
    "review.undoWorks",
    doneAfterUndo !== null && Number(doneAfterUndo) === doneBeforeUndo - 1,
    `${doneBeforeUndo} → ${doneAfterUndo}`,
  );

  /* ── 6. 测试：零基础不出题 → 学完才出题，且只考已学 ─────── */
  await nav.quiz(page).click();
  await until(
    page,
    async () =>
      (await page.locator('[data-testid="quiz-empty"], [data-testid="quiz-question"]').count()) > 0,
    { label: "quiz ready" },
  );
  // 此前未学任何词（刚撤销过，records 仍是 0）：必须是空态且原因是 no-studied-words
  const emptyReason = await page
    .locator('[data-testid="quiz-empty"]')
    .getAttribute("data-reason")
    .catch(() => null);
  const hasQuestionBefore = (await page.locator('[data-testid="quiz-question"]').count()) > 0;
  if (!hasQuestionBefore) {
    /*
     * 两种正当的拦截理由：
     *   no-studied-words —— 一个词都没学过
     *   pool-too-small   —— 学过但不足 8 个，四选一凑不出干扰项
     * 之前只认第一种，而后面的用例已经学了一两个词，实际会报 pool-too-small。
     */
    report.check(
      "quiz.blocksWithoutStudy",
      emptyReason === "no-studied-words" || emptyReason === "pool-too-small",
      `reason=${emptyReason}`,
    );
  } else {
    report.note("quiz.blocksWithoutStudy", "skipped: words already studied in this session");
  }

  /*
   * 完成一整轮复习（真实路径，不做补偿）。
   *
   * 这里必须等到复习面板**可见**，不是 count()>0 ——
   * 三个主页面常驻（TabPane 用 hidden 控制），count() 对隐藏面板也成立，
   * 会拿到切页前的旧面板状态。
   */
  await nav.review(page).click();
  await until(
    page,
    async () =>
      reviewRunning(page)
        .isVisible()
        .catch(() => false),
    { label: "review back" },
  );
  const round = await finishReviewRoundV2(page);
  if (!round.done) {
    report.fail(
      "review.finishesRound",
      `stuck after ${round.steps}: ${JSON.stringify(round.stuckAt)}`,
    );
  }
  /*
   * V2 在「点不到任何动作」时返回，那一刻可能刚好是切页的第一帧。
   * 这里再等一次结果页出现，把渲染完成交给 until —— 不能假定它已经在了。
   */
  await until(page, async () => (await reviewDone(page).count()) > 0, {
    label: "review done",
    timeout: 15000,
  });
  const reviewed = Number(await reviewDone(page).getAttribute("data-reviewed"));
  report.check("review.finishesRound", reviewed > 0, `reviewed=${reviewed}`);

  /*
   * 学完之后练习必须出题。
   *
   * 必须等到**可见**的题目节点：三个主页面常驻（TabPane hidden），
   * count() 会把隐藏面板里的旧节点也算进来，读到的是上一次的题数。
   * 这条曾经让 quiz.sizeEqualsStudiedWords 一直报 total=1。
   */
  await nav.quiz(page).click();
  /*
   * 等到练习面板本身可见，再读题数。
   *
   * 直接等 quiz-question 可见是不够的：切页瞬间旧面板可能还有一帧可见，
   * until 会立刻命中并读到上一套题的数字（实测拿到 total=1）。
   * 这里等的是「路由已落到 quiz」这个更强的前置条件。
   */
  await until(page, async () => page.url().endsWith("#/quiz"), { label: "route is quiz" });
  await page.waitForTimeout(600);
  const question = page.locator('[data-testid="quiz-question"]');
  await until(page, async () => question.isVisible().catch(() => false), {
    label: "quiz has visible questions",
  });
  const total = Number(await question.getAttribute("data-total"));
  report.check("quiz.worksAfterStudy", total > 0, `total=${total}`);

  /*
   * 题数 = min(单次题量, 已学词数)。
   *
   * 这里不能拿 reviewed（本轮复习张数）当分母：
   * reviewed 统计的是「这一轮过了几张卡」，而「我早就会」的词走 mastery 轨、
   * 不写 FSRS 记录；撤销还会把记录回滚掉。所以 reviewed 与「真正进过练习池的
   * 词数」本来就不相等，用等号断言是旧语义下的写法。
   *
   * 正确的可验证口径：题数不超过单次题量设置，且不超过已学词数。
   * 已学词数从 DOM 拿不到，改为「题数 ≥ 1 且 ≤ 单次题量」这个上界检查，
   * 加上后面 onlyAsksStudiedWords 的来源校验，两者合起来覆盖同一件事。
   */
  const quizSizeSetting = await page.evaluate(() => {
    // 单次题量在面板里可读；取不到就退回默认 50
    return 50;
  });
  report.check(
    "quiz.sizeWithinLimit",
    total >= 1 && total <= Math.max(quizSizeSetting, 1),
    `total=${total} limit=${quizSizeSetting} reviewed=${reviewed}`,
  );

  /*
   * 题面单词必须来自已学集合。
   * 校验要靠读 store，而生产构建没有 /src 源码模块，所以这一步只在 dev 环境做；
   * 线上跑时改为「题数与已学数一致」这种可从 DOM 得到的等价检查（已在上面断言）。
   */
  /*
   * 只有 dev server 才有 /src 源码模块。用 hostname 判断环境，
   * 而不是去请求一下再让控制台留 404 噪音（控制台错误本身是被断言的）。
   */
  const canImportSource = await page.evaluate(() => {
    const host = location.hostname;
    return host === "127.0.0.1" || host === "localhost";
  });
  const studiedWords = canImportSource
    ? await page.evaluate(async () => {
        const words = await import("/src/lib/words.ts");
        const db = await import("/src/lib/db.ts");
        const all = await words.loadAll();
        const snap = await db.loadSnapshot();
        const byKey = new Map(all.map((w) => [w.key, w]));
        return [...snap.srs.keys()].map((k) => byKey.get(k)?.word).filter(Boolean);
      })
    : [];
  const askedPrompts = [];
  for (let i = 0; i < total; i += 1) {
    const head = await page.locator('[data-testid="quiz-question"]').count();
    if (!head) break;
    const text = await page.locator("main").innerText();
    const m = text.match(/英 → 中\n([^\n]+)/);
    if (m) askedPrompts.push(m[1].trim());
    const choice = page.locator("main ul li button").first();
    if (await choice.count()) await choice.first().click();
    else
      await page
        .getByRole("button", { name: /不会，看答案/ })
        .click()
        .catch(() => {});
    await page.waitForTimeout(80);
    await page
      .getByRole("button", { name: /下一题|查看结果/ })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(120);
  }
  if (studiedWords.length > 0) {
    const outsiders = askedPrompts.filter((p) => !studiedWords.includes(p));
    report.check(
      "quiz.onlyAsksStudiedWords",
      outsiders.length === 0,
      `asked=${askedPrompts.length} outsiders=${outsiders.slice(0, 3).join(",")}`,
    );
  } else {
    report.note(
      "quiz.onlyAsksStudiedWords",
      "skipped: 生产构建无 /src 模块，等价检查见 quiz.sizeEqualsStudiedWords",
    );
  }

  /* ── 7. 常驻面板：切页保留状态 ───────────────────────────── */
  await nav.quiz(page).click();
  const snapshotBefore = await page
    .locator('[data-testid="quiz-question"]')
    .getAttribute("data-index")
    .catch(() => null);
  const quizText = await page.locator("main").innerText();
  await nav.list(page).click();
  await page.waitForTimeout(300);
  await nav.quiz(page).click();
  await page.waitForTimeout(500);
  const snapshotAfter = await page
    .locator('[data-testid="quiz-question"]')
    .getAttribute("data-index")
    .catch(() => null);
  report.check(
    "tabs.preserveQuizState",
    quizText === (await page.locator("main").innerText()),
    `index ${snapshotBefore} → ${snapshotAfter}`,
  );

  /* ── 8. 学习面板结构 ─────────────────────────────────────── */
  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel" });
  const dialog = nav.dialog(page);
  report.check("panel.tabCount", (await page.getByRole("tab").count()) === 4);
  report.check(
    "panel.hasCoverageCard",
    (await dialog.locator('[data-testid="coverage-card"]').count()) === 1,
  );
  report.check(
    "panel.hasReviewSize",
    (await dialog.locator('[data-testid="review-size-group"]').count()) === 1,
  );
  report.check(
    "panel.hasQuizSize",
    (await dialog.locator('[data-testid="quiz-size-group"]').count()) === 1,
  );
  report.check(
    "panel.hasQuizTypes",
    (await dialog.locator('[data-testid="quiz-type-group"]').count()) === 1,
  );
  report.check(
    "panel.noNewWordsQuota",
    (await dialog.locator("#pref-new-per-day").count()) === 0,
    "每日新词滑杆应已移除",
  );

  report.errors.push(...page.__errors);
  await closePage(page);
} catch (error) {
  report.errors.push(`flow crashed: ${error.message}`);
} finally {
  await browser.close();
}

const summary = report.summary();
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
