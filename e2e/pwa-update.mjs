/**
 * PWA 更新链路回归：前台检查 → 发现新版本 → 弹框 → 手动更新 → 页面变新。
 *
 * 这条链路没法用单测覆盖：registerType 的 waiting 语义、workbox-window 的
 * controlling 事件、以及 SW 换了之后页面是否真的重载，全都在浏览器里才成立。
 *
 * 做法：同一个端口上跑一个可切换根目录的静态服务器。
 *   1. 打开构建 A，等 SW 接管并走完首次设置；
 *   2. 把服务器根目录换成构建 B（sw.js 内容不同 → 浏览器认为是新版）；
 *   3. 触发 visibilitychange（等价于用户从后台切回 App）；
 *   4. 断言弹框出现；点「稍后」验证不重载、不重复打扰、重开再来；
 *   5. 点「立即更新」，断言页面重载并变成构建 B 的内容。
 *
 * 用法：node e2e/pwa-update.mjs
 * 前置：dist/ 已构建（npm run build）。两个夹具由脚本自己从 dist 复制生成。
 */
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { createReport, completeSetup, VIEWPORTS } from "./lib/harness.mjs";

const BASE_PATH = "/learn-english-vocab/";
const PORT = Number(process.env.PWA_PORT ?? 4178);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DIST = new URL("../dist", import.meta.url).pathname;

/**
 * 造两个夹具：
 *   A = dist 原样
 *   B = dist 的副本，但 index.html 的 <title> 换掉、sw.js 里 index.html 的
 *       revision 改掉 —— SW 内容变了，浏览器才会认成「有新版本」。
 */
async function buildFixtures() {
  const base = await mkdtemp(join(tmpdir(), "pwa-update-"));
  const dirA = join(base, "a");
  const dirB = join(base, "b");
  await cp(DIST, dirA, { recursive: true });
  await cp(DIST, dirB, { recursive: true });

  const htmlB = await readFile(join(dirB, "index.html"), "utf8");
  await writeFile(join(dirB, "index.html"), htmlB.replace(/<title>[^<]*<\/title>/, "<title>BUILD-B</title>"));

  const swB = await readFile(join(dirB, "sw.js"), "utf8");
  await writeFile(join(dirB, "sw.js"), swB.replace(/(index\.html",revision:")[a-f0-9]{32}/, "$1ffffffffffffffffffffffffffffffff"));

  return { base, dirA, dirB };
}

const { base: FIXTURE_ROOT, dirA, dirB } = await buildFixtures();
const pointerFile = join(FIXTURE_ROOT, "root");
await writeFile(pointerFile, dirA);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** 每次请求都重读指针文件，切换构建不需要重启服务器 */
async function currentRoot() {
  return (await readFile(pointerFile, "utf8")).trim();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    const path = url.pathname;
    if (!path.startsWith(BASE_PATH)) {
      res.writeHead(404).end("outside scope");
      return;
    }
    let rel = path.slice(BASE_PATH.length);
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = join(await currentRoot(), rel);
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      // 与 GitHub Pages 接近：SW 走短缓存，资源可以长缓存
      "cache-control": rel === "sw.js" ? "max-age=0, must-revalidate" : "max-age=60",
      "service-worker-allowed": BASE_PATH,
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((done) => server.listen(PORT, "127.0.0.1", done));

const report = createReport();
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ??
    "/Users/zheqiu/Library/Caches/ms-playwright/chromium_headless_shell-1232/chrome-headless-shell-mac-arm64/chrome-headless-shell",
});

const context = await browser.newContext({
  viewport: VIEWPORTS.mobile,
  locale: "zh-CN",
  hasTouch: true,
  serviceWorkers: "allow",
});
const page = await context.newPage();
page.on("pageerror", (e) => report.errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(`console: ${m.text()}`);
});

try {
  /* ── 1. 构建 A：安装并接管 ─────────────────────────────── */
  await page.goto(`${ORIGIN}${BASE_PATH}`, { waitUntil: "load" });

  const controlled = await page
    .waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  report.check("sw.controlled", controlled);

  const titleA = await page.title();
  report.note("titleA", titleA);

  /*
   * 先走完首次设置进主壳。
   * 更新提示只挂在主壳上（锁屏/向导期间不弹，免得抢 PIN 键盘焦点），
   * 停在向导页时弹框本来就不该出现 —— 不初始化就测这条链路，测的是假象。
   */
  await completeSetup(page);
  report.check("app.inMainShell", (await page.locator("nav").count()) > 0);

  // 弹框不该在没有任何新版本时冒出来
  const dialogBefore = await page.locator('[role="dialog"]').count();
  report.check("update.silentWhenNoUpdate", dialogBefore === 0, `dialog=${dialogBefore}`);

  /* ── 2. 服务器换到构建 B ───────────────────────────────── */
  await writeFile(pointerFile, dirB);

  /* ── 3. 模拟「用户切回前台」 ───────────────────────────── */
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  /* ── 4. 弹框应当出现 ──────────────────────────────────── */
  const dialog = page.locator('[role="dialog"]');
  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  report.check("update.promptAppears", appeared);

  if (appeared) {
    const text = (await dialog.innerText()).replace(/\s+/g, " ").trim();
    report.note("dialogText", text);
    report.check("update.hasApplyButton", await dialog.getByRole("button", { name: "立即更新" }).isVisible());
    report.check("update.hasLaterButton", await dialog.getByRole("button", { name: "稍后" }).isVisible());

    /* ── 4.5 先验「稍后」：弹框关掉，页面不重载 ───────────── */
    await dialog.getByRole("button", { name: "稍后" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => null);
    const dismissedGone = (await dialog.count()) === 0;
    report.check("update.dismissClosesDialog", dismissedGone);
    report.check("update.dismissKeepsOldPage", (await page.title()) === titleA);

    // 稍后之后同一会话不再重复打扰
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(1200);
    report.check("update.noSecondNudge", (await page.locator('[role="dialog"]').count()) === 0);

    // 重新打开一次，弹框应再次出现（新 SW 仍在 waiting）
    await page.reload({ waitUntil: "load" });
    const dialog2 = page.locator('[role="dialog"]');
    const reappeared = await dialog2
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    report.check("update.promptReturnsAfterReload", reappeared);

    /* ── 5. 点「立即更新」→ 重载 → 内容变新 ──────────────── */
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 20000 }).catch(() => null),
      page.locator('[role="dialog"]').getByRole("button", { name: "立即更新" }).click(),
    ]);

    const reloaded = await page
      .waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    report.check("update.afterApplyControlled", reloaded);

    const titleB = await page.title();
    report.note("titleB", titleB);
    report.check("update.pageBecameNew", titleB !== titleA, `${titleA} → ${titleB}`);

    const dialogAfter = await page.locator('[role="dialog"]').count();
    report.check("update.dialogGoneAfterApply", dialogAfter === 0, `dialog=${dialogAfter}`);
  }
} finally {
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  server.close();
}

const summary = report.summary();
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
