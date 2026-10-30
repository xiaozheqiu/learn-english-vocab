/**
 * PWA 更新链路回归：前台检查 → 发现新版本 → 自动接管 → 页面自己变新。
 *
 * 这条链路没法用单测覆盖：registerType 的 waiting 语义、workbox-window 的
 * controlling 事件、以及 SW 换了之后页面是否真的重载，全都在浏览器里才成立。
 *
 * 做法：同一个端口上跑一个可切换根目录的静态服务器。
 *   1. 打开构建 A，等 SW 接管并走完首次设置；
 *   2. 手动点「检查更新」，断言没有新版时报「已经是最新版本」；
 *   3. 把服务器根目录换成构建 B（sw.js 内容不同 → 浏览器认为是新版）；
 *   4. 触发 visibilitychange（等价于用户从后台切回 App）；
 *   5. 断言页面**自己**换成了构建 B —— 没有按钮可点、没有确认可给，
 *      这是强制更新的核心判据。
 *
 * 用法：node e2e/pwa-update.mjs
 * 前置：dist/ 已构建（npm run build）。两个夹具由脚本自己从 dist 复制生成。
 */
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { createReport, waitDialogClosed, waitMainShell, VIEWPORTS } from "./lib/harness.mjs";

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
  await writeFile(
    join(dirB, "index.html"),
    htmlB.replace(/<title>[^<]*<\/title>/, "<title>BUILD-B</title>"),
  );

  const swB = await readFile(join(dirB, "sw.js"), "utf8");
  await writeFile(
    join(dirB, "sw.js"),
    swB.replace(/(index\.html",revision:")[a-f0-9]{32}/, "$1ffffffffffffffffffffffffffffffff"),
  );

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
   * 先等主壳就绪（词表网格渲染出来）。
   * 更新提示只挂在主壳上：还没进入应用就弹框属于假象，
   * 所以这条链路必须在真实页面上验证。
   */
  await waitMainShell(page);
  report.check("app.inMainShell", (await page.locator('[data-testid="word-grid"]').count()) > 0);

  // 弹框不该在没有任何新版本时冒出来
  const dialogBefore = await page.locator('[role="dialog"]').count();
  report.check("update.silentWhenNoUpdate", dialogBefore === 0, `dialog=${dialogBefore}`);

  /* ── 2. 服务器换到构建 B：模拟「切回前台」自动检查 ─────── */
  /*
   * 必须先做这一步再做手动检查：手动检查会把 lastCheck 推到当下，
   * 30 秒节流内的自动检查就变成 no-op，测不到自动更新。
   */
  await writeFile(pointerFile, dirB);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  /*
   * ── 3. 强制更新：没有任何可点的东西，页面自己换掉 ────────
   *
   * 等待条件只能是「标题变了」，不能等按钮 —— autoUpdate 下不存在等待
   * 用户确认的 waiting 状态，插件在 activated 时直接 location.reload()。
   * 这一条就是「强制」的核心判据。
   */
  const becameNew = await page
    .waitForFunction((prev) => document.title !== prev, titleA, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  report.check("update.autoReloadsWithoutPrompt", becameNew);

  const titleB = await page.title();
  report.note("titleB", titleB);
  report.check("update.pageBecameNew", titleB !== titleA, `${titleA} \u2192 ${titleB}`);

  const reloaded = await page
    .waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  report.check("update.afterReloadControlled", reloaded);

  /*
   * 重载后不该留任何需要用户处理的更新界面。
   * 这是「强制」的另一半：没有稍后、没有立即更新、没有关不掉的框。
   */
  await waitMainShell(page);
  const dialogAfter = await page.locator('[role="dialog"]').count();
  report.check("update.noBlockingPromptLeft", dialogAfter === 0, `dialog=${dialogAfter}`);
  report.check(
    "update.noApplyOrLaterButtons",
    (await page.getByRole("button", { name: /立即更新|稍后/ }).count()) === 0,
  );

  /* ── 4. 手动检查：已经在新版上时必须给「已经是最新版本」 ── */
  // 面板收成单页「关于」之后，检查更新就在这一页上，不用再切 tab
  await page.locator('button[aria-label="关于"]').click();
  const checkBtn = page.locator('[data-testid="check-update"]');
  report.check("settings.hasCheckUpdate", await checkBtn.isVisible());

  await checkBtn.click();
  await page
    .waitForFunction(
      () => {
        const t = document.querySelector('[data-testid="check-update-status"]')?.textContent ?? "";
        return t.includes("最新") || t.includes("失败");
      },
      null,
      { timeout: 20000 },
    )
    .catch(() => null);
  const statusLatest = (
    await page.locator('[data-testid="check-update-status"]').innerText()
  ).trim();
  report.note("statusNoUpdate", statusLatest);
  report.check("settings.reportsLatest", statusLatest.includes("已经是最新版本"), statusLatest);

  await page.keyboard.press("Escape");
  await waitDialogClosed(page);

  /* ── 5. 换新版后仍然可用：词表渲染出来、掌握标记能落地 ─── */
  report.check("update.listStillWorks", (await page.locator('[role="row"][data-key]').count()) > 0);
} finally {
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  server.close();
}

const summary = report.summary();
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
