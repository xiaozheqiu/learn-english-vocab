/**
 * 浏览器回归总入口：先起 dev server，再依次跑三个套件（flow / edge / pwa-update）。
 *
 * 用法：
 *   node e2e/run.mjs            # 自己起服务（端口被占则复用）
 *   BASE_URL=... node e2e/run.mjs  # 跑指定地址
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 5173;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}/`;

async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await isUp(BASE))) {
  console.log(`[e2e] 启动 dev server（${BASE}）…`);
  server = spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true });
  const started = Date.now();
  while (!(await isUp(BASE))) {
    if (Date.now() - started > 60_000) {
      console.error("[e2e] dev server 起不来");
      process.exit(1);
    }
    await sleep(400);
  }
} else {
  console.log(`[e2e] 复用已在运行的服务（${BASE}）`);
}

/**
 * pwa-update 需要 dist/（自己起静态服务器、自己造 A/B 夹具），
 * 和 dev server 的两套流程无关，所以放最后单独跑。
 */
const suites = ["flow.mjs", "edge.mjs", "pwa-update.mjs"];
let failed = 0;
let total = 0;

for (const suite of suites) {
  console.log(`\n[e2e] ${suite}`);
  const code = await new Promise((resolve) => {
    const child = spawn("node", [`e2e/${suite}`], {
      stdio: "inherit",
      env: { ...process.env, BASE_URL: BASE },
    });
    child.on("exit", (c) => resolve(c ?? 1));
  });
  if (code !== 0) failed += 1;
  total += 1;
}

if (server) {
  try {
    process.kill(-server.pid);
  } catch {
    /* already gone */
  }
}

console.log(`\n[e2e] ${total - failed}/${total} 套件通过`);
process.exit(failed === 0 ? 0 : 1);
