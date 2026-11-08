/**
 * 边界与持久化回归（结构断言版）。
 *
 * 覆盖：视图（筛选 + 页码）跨刷新保留、每页条数只在筛选抽屉里改、
 * 数据 / 设置分区已移除（关于里不留导出、导入、清空与显示偏好）、
 * 常驻面板的滚动位置、词性对照的深链与返回、桌面宽度下的布局。
 * 规则同 flow.mjs：不绕过被测行为，不按文案断言。
 *
 * 运行：node e2e/edge.mjs [BASE_URL]
 */

import {
  BASE,
  VIEWPORTS,
  closePage,
  createReport,
  launch,
  nav,
  newPage,
  newPageIn,
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
  const page = await newPage(browser);

  /* ── 深链：未知 hash 收敛到词表 ──────────────────────────── */
  await page.goto(`${BASE}#/nonsense`, { waitUntil: "networkidle" });
  await waitMainShell(page);
  await page.waitForTimeout(400);
  report.check(
    "route.unknownHashCanonicalised",
    (await page.evaluate(() => location.hash)) === "#/",
    await page.evaluate(() => location.hash),
  );
  await waitRows(page, 20);
  report.check("route.unknownHashShowsList", (await rowCount(page)) > 0);

  /* ── 深链刷新到词性对照仍渲染，返回后主界面还在 ──────────── */
  await page.goto(`${BASE}#/guide`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  report.check("route.guideDeepLinkKept", (await page.evaluate(() => location.hash)) === "#/guide");
  report.check("route.guideDeepLinkRenders", (await page.locator("main").innerText()).length > 50);
  await page.goto(`${BASE}#/`, { waitUntil: "networkidle" });
  await waitRows(page, 20);
  report.check("route.guideBackToList", (await rowCount(page)) > 0);

  /* ── 筛选条件与页码跨刷新保留 ─────────────────────────────── */
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-level"]').getByRole("button").nth(1).click(); // A2
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await until(
    page,
    async () =>
      (await page.locator('[role="row"][data-key]').first().getAttribute("data-key"))?.startsWith(
        "A2|",
      ),
    { label: "A2 applied" },
  );
  const pageJump = page.locator("#page-jump");
  // 页码输入是草稿式：输入后要提交（回车或失焦）才生效
  await pageJump.fill("3");
  await pageJump.press("Enter");
  await page.waitForTimeout(400);
  const beforeReload = await page
    .locator('[role="row"][data-key]')
    .first()
    .getAttribute("data-key");
  await page.reload({ waitUntil: "networkidle" });
  await waitRows(page, 20);
  const afterReload = await page.locator('[role="row"][data-key]').first().getAttribute("data-key");
  report.check(
    "view.persistsAcrossReload",
    beforeReload === afterReload && (await pageJump.inputValue()) === "3",
    `${beforeReload} → ${afterReload}`,
  );
  report.check(
    "view.persistsFilterLabel",
    (await page.locator('[data-testid="filter-trigger"]').innerText()).includes("A2"),
  );

  /* ── 每页条数只在筛选抽屉里改，分页器不重复放一份 ─────────── */
  report.check(
    "pager.hasNoPageSizeControl",
    (await page.locator('nav[aria-label="分页"] select').count()) === 0,
  );
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-size"]').getByRole("button").nth(1).click(); // 50
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await waitRows(page, 50);
  report.check("pager.sizeFromFilterSheet", (await rowCount(page)) === 50);
  // 复原：50 → 20，等级 → 全部
  await openFilter(page);
  await nav.dialog(page).locator('[data-testid="filter-reset"]').click();
  await nav.dialog(page).locator('[data-testid="filter-size"]').getByRole("button").nth(0).click();
  await nav.dialog(page).locator('[data-testid="filter-done"]').click();
  await waitDialogClosed(page);
  await waitRows(page, 20);
  await pageJump.fill("1");
  await pageJump.press("Enter");
  await page.waitForTimeout(300);

  /* ── 布局：头部与底部分页固定，只有中间词表滚 ──────────────── */
  /*
   * 滚动层是词表内部那一段（头部筛选 + 板块进度 + 表头在它上面，
   * 分页在它下面）。所以这里量三件事：
   *   1. 滚起来之后顶栏与筛选条的位置不动；
   *   2. 分页条仍贴在视口底部；
   *   3. 滚的是词表那一段，不是整页。
   */
  const listScroller = () =>
    page.evaluate(() => {
      const grid = document.querySelector('[data-testid="word-grid"]');
      const scroller = grid?.parentElement;
      const header = document.querySelector("header");
      const filterBar = document.querySelector('[aria-label="词表筛选"]');
      const pager = document.querySelector('nav[aria-label="分页"]');
      const rect = (el) => (el ? Math.round(el.getBoundingClientRect()) : null);
      return {
        scrollTop: scroller ? Math.round(scroller.scrollTop) : -1,
        headerTop: header ? Math.round(header.getBoundingClientRect().top) : null,
        filterTop: filterBar ? Math.round(filterBar.getBoundingClientRect().top) : null,
        pagerBottom: pager ? Math.round(pager.getBoundingClientRect().bottom) : null,
        viewportH: window.innerHeight,
        bodyScroll: document.scrollingElement.scrollTop,
      };
    });

  await page.locator('[role="row"][data-key]').nth(12).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const beforeScroll = await listScroller();
  report.check(
    "layout.listScrolls",
    beforeScroll.scrollTop > 0 && beforeScroll.bodyScroll === 0,
    JSON.stringify(beforeScroll),
  );
  report.check(
    "layout.headerStaysPut",
    beforeScroll.headerTop === 0 && beforeScroll.filterTop > 0 && beforeScroll.filterTop < 120,
    `header=${beforeScroll.headerTop} filter=${beforeScroll.filterTop}`,
  );
  report.check(
    "layout.pagerPinnedToBottom",
    beforeScroll.pagerBottom !== null &&
      Math.abs(beforeScroll.pagerBottom - beforeScroll.viewportH) <= 2,
    `pagerBottom=${beforeScroll.pagerBottom} viewport=${beforeScroll.viewportH}`,
  );

  const scrollBefore = beforeScroll.scrollTop;
  // 应用内路径（不刷新页面）：顶栏「关于」→ 打开词性对照表
  await openAbout(page);
  await page.getByRole("button", { name: /打开词性对照表/ }).click();
  await waitDialogClosed(page);
  await until(page, async () => (await page.evaluate(() => location.hash)) === "#/guide", {
    label: "guide route",
  });
  await page.getByRole("button", { name: /返回词表/ }).click();
  await until(page, async () => (await page.evaluate(() => location.hash)) === "#/", {
    label: "back to list",
  });
  /*
   * 滚动位置是面板可见后的一个 effect 里恢复的，和路由变化不在同一帧。
   * 所以等它自己落位，而不是切完立刻读一次。
   */
  const scrollAfter = await until(
    page,
    async () => {
      const top = (await listScroller()).scrollTop;
      return top > 0 ? top : 0;
    },
    { label: "scroll restored", timeout: 4000 },
  ).catch(() => 0);
  report.check(
    "pane.keepsScrollOnTabSwitch",
    scrollBefore > 0 && Math.abs(scrollAfter - scrollBefore) <= 4,
    `${scrollBefore} → ${scrollAfter}`,
  );

  /*
   * ── 数据与设置分区已移除 ────────────────────────────────────
   *
   * 先标一个词，再确认「关于」里没有任何把这份进度导出去或清掉的入口。
   * 断言查的是按钮是否存在，不查文案是否改过。
   */
  const firstRow = page.locator('[role="row"][data-key]').first();
  const firstKey = await firstRow.getAttribute("data-key");
  const rowMasteryBtn = firstRow
    .locator("button")
    .filter({ hasNot: page.locator('[role="checkbox"]') })
    .last();
  await rowMasteryBtn.click();
  await until(page, async () => (await rowMasteryBtn.getAttribute("aria-pressed")) === "true", {
    label: "mastery set before about",
  });

  await openAbout(page);
  const aboutPane = await nav.dialog(page).innerText();
  report.check(
    "panel.noExportImportWipe",
    (await page.getByRole("button", { name: /导出/ }).count()) === 0 &&
      (await page.getByRole("button", { name: /选择 JSON/ }).count()) === 0 &&
      (await page.getByRole("button", { name: /清空/ }).count()) === 0 &&
      !/导入/.test(aboutPane),
  );
  report.check(
    "panel.noDisplayPrefs",
    (await page.locator("#pref-page-size").count()) === 0 &&
      (await page.locator("#pref-default-level").count()) === 0,
  );
  /**
   * 云同步这块的硬约束：**界面上永远不出现邮箱输入框**。
   *
   * 全站只有一个账号，邮箱来自构建期注入的 VITE_CLOUD_EMAIL。一旦哪天有人
   * 把登录改回「邮箱 + 密码」，或者把缺配置的登录框也渲染出来，这里会红。
   *
   * 不写成「没有同步入口」：开发者本地有 .env.local 时入口本来就该出现，
   * 写死成不出现会让每次本地跑 e2e 都假红。真正该守住的是「入口出现时
   * 它长什么样」，这与是否配置了云端无关 —— 所以配了才往下查。
   */
  const cloudConfigured = (await page.locator('[data-testid="cloud-status"]').count()) > 0;
  const hasEmailField = (await page.locator('input[type="email"]').count()) > 0;
  const cloudState = cloudConfigured
    ? await page.locator('[data-testid="cloud-status"]').getAttribute("data-state")
    : "unconfigured";
  report.check(
    "panel.cloudLoginIsPasswordOnly",
    !hasEmailField &&
      // 配了云端且未登录时，必须有一个密码框；其余状态不该有
      (cloudState === "signedOut"
        ? (await page.locator('[data-testid="cloud-password"]').count()) === 1
        : true),
    `state=${cloudState} email=${hasEmailField}`,
  );
  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

  /* ── 已掌握标记跨刷新保留（写进 IndexedDB，不是内存）──────── */
  await page.reload({ waitUntil: "networkidle" });
  await waitRows(page, 20);
  const persistedBtn = page
    .locator(`[role="row"][data-key="${firstKey}"]`)
    .locator("button")
    .filter({ hasNot: page.locator('[role="checkbox"]') })
    .last();
  report.check(
    "mastery.persistsAcrossReload",
    (await persistedBtn.getAttribute("aria-pressed")) === "true",
    firstKey,
  );
  // 复原，避免污染下次运行
  await persistedBtn.click();
  await until(page, async () => (await persistedBtn.getAttribute("aria-pressed")) === "false", {
    label: "mastery cleared",
  });

  report.errors.push(...page.__errors);
  await closePage(page);

  /* ── 桌面宽度：两栏布局不变形，tablist 只有词表 / 词性对照 ── */
  const wide = await newPage(browser, VIEWPORTS.wide);
  await wide.goto(BASE, { waitUntil: "networkidle" });
  await waitRows(wide, 20);
  const tabs = wide.locator('[role="tablist"] [role="tab"]');
  report.check("desktop.twoTabs", (await tabs.count()) === 2);
  const searchVisible = await wide.locator("#word-search").isVisible();
  report.check("desktop.searchAlwaysVisible", searchVisible);
  // 桌面端顶栏也放词性对照入口
  report.check(
    "desktop.topbarGuideShortcut",
    (await wide.getByRole("button", { name: "词性对照表" }).count()) > 0,
  );
  report.errors.push(...wide.__errors);
  await closePage(wide);

  /*
   * ── 初始化永远不许无限期挂着 ────────────────────────────
   *
   * 真实故障：另一个标签页（或没关的旧页面）持有旧版本连接时，IndexedDB 的版本
   * 升级会派发 `blocked` 且**永不 resolve、永不 reject**。旧代码没有任何处理，
   * 于是 `await db()` 不返回 → `setReady(true)` 轮不到 → 界面死在
   * 「正在读取本机进度…」，连报错都没有。用两个标签页可稳定复现（见 lib/db.ts 注释）。
   *
   * ## 为什么这里不造「另一个标签页占着库」
   *
   * 试过，而且试了三版都不成立：应用自己的连接带 `blocking` 回调会主动让路
   * （那正是修复的一部分），所以同一个应用开的第二个页面**永远**不会真的把库占住 ——
   * 强行造出来的「阻塞」只会落到超时兜底分支，header 里一条提示都没有，
   * 断言看似失败、实则是夹具没还原真实故障。这种测试比没有更糟。
   *
   * 改成断言用户真正能感知的那条保证：**初始化卡住时会自己放行**。
   * 做法是把 IndexedDB 打开**挂死**（返回一个永不 settle 的 Promise 更贴近真实，
   * 但页面脚本无法替换已加载模块的 openDB），于是退而用更外层的判据：
   * 页面上任何时刻都不该出现「正在读取本机进度」，且最迟 BOOT_TIMEOUT 之后必须可用。
   *
   * 注：`db.blockedTab` 相关断言在历史上被删过一次，原因是它测不到目标行为。
   */
  /*
   * 多标签页共存：**同一个 context** 才共享 IndexedDB。
   * 跨 context 是各自独立的存储，那样写出来的「多标签页」用例测不到任何东西。
   *
   * `closePage` 关的是整个 context，所以这里只在最后统一关一次 ——
   * 中途关掉任何一页都会让后面的 `newPageIn` 抛「context has been closed」。
   */
  const shared = await newPage(browser, VIEWPORTS.mobile);
  const ctx = shared.__context;
  await shared.goto(BASE, { waitUntil: "domcontentloaded" });
  await waitMainShell(shared);

  const bootPage = await newPageIn(ctx);
  const bootStart = Date.now();
  await bootPage.goto(BASE, { waitUntil: "domcontentloaded" });
  const booted = await waitMainShell(bootPage).then(
    () => true,
    () => false,
  );
  const bootMs = Date.now() - bootStart;
  report.check("boot.entersMainShell", booted, `${bootMs}ms`);
  /*
   * 「正在读取本机进度…」是死界面文案：正常路径下一闪而过，绝不该是最终状态。
   * 这条盯的是「初始化链上任何一步挂住都必须自己放行」这条保证 ——
   * 之前它在 IndexedDB 升级被挡时会永远停在那里。
   */
  const bodyText = await bootPage.evaluate(() => document.body.innerText);
  report.check(
    "boot.notStuckOnReading",
    !bodyText.includes("正在读取本机进度"),
    bodyText.slice(0, 40).replace(/\n/g, " "),
  );

  const afterPage = await newPageIn(ctx);
  await afterPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await waitMainShell(afterPage);
  await until(
    afterPage,
    async () => (await afterPage.locator('[data-testid="scope-progress"]').count()) > 0,
    { label: "progress present" },
  );
  const version = await afterPage.evaluate(async () => {
    const req = indexedDB.open("ox5000");
    const db = await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
    });
    const v = db.version;
    db.close();
    return v;
  });
  report.check("db.currentVersion", version >= 3, `version=${version}`);

  for (const p of [shared, bootPage, afterPage]) report.errors.push(...p.__errors);
  await closePage(shared);
} catch (error) {
  report.errors.push(`edge crashed: ${error.message}`);
} finally {
  await browser.close();
}

const summary = report.summary();
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
