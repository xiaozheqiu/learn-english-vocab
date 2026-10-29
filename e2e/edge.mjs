/**
 * 边界与持久化回归（结构断言版）。
 *
 * 覆盖：视图（筛选 + 页码）跨刷新保留、每页条数只在筛选抽屉里改、
 * 数据面板的导出下载与清空二次确认、常驻面板的滚动位置、
 * 词性对照的深链与返回、桌面宽度下的布局。
 * 规则同 flow.mjs：不绕过被测行为，不按文案断言。
 *
 * 运行：node e2e/edge.mjs [BASE_URL]
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  // 应用内路径（不刷新页面）：面板 → 关于 → 打开词性对照表
  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel 0" });
  await page.getByRole("tab").filter({ hasText: /关于/ }).click();
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

  /* ── 数据面板：导出的 JSON 只带 mastery / prefs ─────────────── */
  // 先标一个词，导出的文件里必须看得到它（不靠「导出成功」这种自我声明）
  const firstRow = page.locator('[role="row"][data-key]').first();
  const firstKey = await firstRow.getAttribute("data-key");
  const rowMasteryBtn = firstRow
    .locator("button")
    .filter({ hasNot: page.locator('[role="checkbox"]') })
    .last();
  await rowMasteryBtn.click();
  await until(page, async () => (await rowMasteryBtn.getAttribute("aria-pressed")) === "true", {
    label: "mastery set for export",
  });

  await nav.panel(page).click();
  await until(page, async () => (await nav.dialog(page).count()) > 0, { label: "panel" });
  await page.getByRole("tab").filter({ hasText: /数据/ }).click();

  const downloadDir = await mkdtemp(join(tmpdir(), "ox5000-download-"));
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await page.getByRole("button", { name: /导出 JSON/ }).click();
  const download = await downloadPromise;
  const file = join(downloadDir, download.suggestedFilename());
  await download.saveAs(file);
  const payload = JSON.parse(await readFile(file, "utf8"));
  report.check(
    "data.exportCarriesMarkedWord",
    Array.isArray(payload.mastery) && payload.mastery.includes(firstKey),
    `${download.suggestedFilename()} mastery=${payload.mastery?.length}`,
  );
  report.check("data.exportOmitsRemovedStores", !("srs" in payload) && !("days" in payload));

  // 清空：先点开确认区，再取消（不真的清）
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
  await page.getByRole("button", { name: /取消/ }).click();
  await page.waitForTimeout(150);
  report.check(
    "data.wipeCancelRestores",
    (await page
      .locator('[role="dialog"] button')
      .filter({ hasText: /确认清空/ })
      .count()) === 0,
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
} catch (error) {
  report.errors.push(`edge crashed: ${error.message}`);
} finally {
  await browser.close();
}

const summary = report.summary();
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
