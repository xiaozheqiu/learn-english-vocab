/**
 * 学习交互回归（新词两档 / 弱词直达 / 状态左栏）。
 *
 * 为什么单独一套：
 * 这三项都需要「库里有特定状态的数据」——弱词需要旧词、左栏需要多种状态。
 * 放进 flow.mjs 会和前面的用例互相污染（前面跑完一轮队列就空了），
 * 而且前置数据要靠注入，独立套件可以每次都从干净状态出发。
 *
 * 规则见 lib/harness.mjs 顶部：不绕过被测行为、不按文案断言。
 *
 * 运行：node e2e/learning.mjs [BASE_URL]
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
  until,
} from "./lib/harness.mjs";

const report = createReport();
const browser = await launch();

/** 写入一张「已学过、今天到期」的卡，让复习队列里出现旧词 */
async function seedDueCard(page, key) {
  await page.evaluate(async (cardKey) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open("ox5000", 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const now = Date.now();
    await new Promise((res, rej) => {
      const tx = db.transaction("srs", "readwrite");
      tx.objectStore("srs").put({
        key: cardKey,
        due: now - 86_400_000,
        stability: 3,
        difficulty: 5,
        elapsed_days: 1,
        scheduled_days: 1,
        learning_steps: 0,
        reps: 2,
        lapses: 0,
        state: 2,
        last_review: now - 4 * 86_400_000,
        right: 2,
        wrong: 0,
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, key);
}

/** 写入一条「已掌握」标记，用于左栏的 mastered 状态 */
async function seedMastered(page, key) {
  await page.evaluate(async (cardKey) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open("ox5000", 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction("mastery", "readwrite");
      tx.objectStore("mastery").put({ key: cardKey, at: Date.now() });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, key);
}

try {
  const page = await newPage(browser, VIEWPORTS.mobile);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await completeSetup(page);
  await page.waitForTimeout(1200);

  /* ── 1. 新词只给两个动作 ─────────────────────────────────── */
  await nav.review(page).click();
  await until(
    page,
    async () =>
      page
        .locator('[data-testid="review-running"]')
        .isVisible()
        .catch(() => false),
    { label: "review visible" },
  );
  const running = page.locator('[data-testid="review-running"]');
  await running
    .getByRole("button", { name: /显示释义/ })
    .first()
    .click();
  await page.waitForTimeout(350);

  report.check(
    "newWord.hasKnowAction",
    (await running.getByRole("button", { name: /我早就会/ }).count()) > 0,
  );
  report.check(
    "newWord.hasLearnAction",
    (await running.getByRole("button", { name: /开始学/ }).count()) > 0,
  );
  report.check(
    "newWord.hidesRatingBar",
    (await running.locator("button[data-grade]").count()) === 0,
  );

  /* ── 2. 旧词有四档评分，且没有「我早就会」 ───────────────── */
  await seedDueCard(page, "A1|the|definite article");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await nav.review(page).click();
  await until(
    page,
    async () =>
      page
        .locator('[data-testid="review-running"]')
        .isVisible()
        .catch(() => false),
    { label: "review visible 2" },
  );
  const running2 = page.locator('[data-testid="review-running"]');
  // 队列按到期优先，the 应在最前
  const firstWord = await running2.locator(".word-serif").first().textContent();
  report.check("oldWord.isDueFirst", firstWord?.trim() === "the", `first=${firstWord}`);
  await running2
    .getByRole("button", { name: /显示释义/ })
    .first()
    .click();
  await until(page, async () => (await running2.locator('button[data-grade="1"]').count()) > 0, {
    label: "rating bar",
  });
  report.check(
    "oldWord.hasFourGrades",
    (await running2.locator("button[data-grade]").count()) === 4,
  );
  report.check(
    "oldWord.hasNoKnowAction",
    (await running2.getByRole("button", { name: /我早就会/ }).count()) === 0,
  );

  /* ── 3. 判错 → 结果页出现弱词区块 → 只练这几个 ───────────── */
  await running2.locator('button[data-grade="1"]').click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^退出$/ }).click();
  await until(
    page,
    async () =>
      page
        .locator('[data-testid="review-done"]')
        .isVisible()
        .catch(() => false),
    { label: "review done" },
  );
  const weakSection = page.locator('section[aria-labelledby="weak-title"]');
  report.check("weak.sectionShown", (await weakSection.count()) > 0);
  if ((await weakSection.count()) > 0) {
    const entry = page.getByRole("button", { name: /只练这 \d+ 个/ });
    report.check("weak.practiceEntry", (await entry.count()) > 0);
    await entry.first().click();
    await until(page, async () => page.url().endsWith("#/quiz"), { label: "weak→quiz" });
    await page.waitForTimeout(900);
    const q = page.locator('[data-testid="quiz-question"]');
    const empty = page.locator('[data-testid="quiz-empty"]');
    const qVisible = await q.isVisible().catch(() => false);
    const eVisible = await empty.isVisible().catch(() => false);
    report.check(
      "weak.practiceIsFocused",
      qVisible || eVisible,
      `question=${qVisible} empty=${eVisible}`,
    );
    if (qVisible) {
      const total = Number(await q.getAttribute("data-total"));
      report.check("weak.practiceHasQuestions", total >= 1, `total=${total}`);
    }
  }

  /* ── 4. 状态左栏：三档绿必须靠宽度/形状分开 ─────────────── */
  await seedDueCard(page, "A1|about|prep., adv.");
  await seedMastered(page, "A1|above|prep., adv.");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await nav.list(page).click();
  await page.waitForTimeout(700);

  const rails = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('[role="row"][data-key]')) {
      const m = (el.className || "").match(/rail-(\w+)/);
      if (!m) continue;
      const before = getComputedStyle(el, "::before");
      const after = getComputedStyle(el, "::after");
      out[m[1]] = { width: before.width, dotWidth: after.width };
    }
    return out;
  });
  const kinds = Object.keys(rails);
  report.check("rail.hasMultipleStates", kinds.length >= 2, JSON.stringify(rails));
  if (kinds.length >= 2) {
    // 宽度或形状至少有一项不同，才谈得上「可区分」
    const widths = new Set(kinds.map((k) => rails[k].width));
    const dots = new Set(kinds.map((k) => rails[k].dotWidth));
    report.check(
      "rail.statesDistinguishable",
      widths.size > 1 || dots.size > 1,
      `widths=${JSON.stringify([...widths])} dots=${JSON.stringify([...dots])}`,
    );
  }
  // due 与 mastered 的宽度必须不同（这两种最容易混）
  if (rails.due && rails.mastered) {
    report.check(
      "rail.dueVsMasteredDiffer",
      rails.due.width !== rails.mastered.width,
      `due=${rails.due.width} mastered=${rails.mastered.width}`,
    );
  }

  await closePage(page);
} catch (error) {
  report.fail("learning.crashed", String(error).slice(0, 400));
} finally {
  await browser.close();
}

const summary = report.summary();
console.log(JSON.stringify(summary, null, 1));
if (!summary.ok) process.exitCode = 1;
