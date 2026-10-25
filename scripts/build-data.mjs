// 把 ../data/*.js（window.OX.A1 = [[...]]）转成 src/data/*.json。
// 数据源不变，只是换个格式给 Vite 用：JSON 能走正常的动态 import + 分包。
//
// 增量执行：产物比源文件新就直接跳过，所以 `npm run dev` / `npm run build`
// 只有在 data/*.js 真的改过时才重新转一次。`npm run data -- --force` 强制重转。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, ".."); // 项目根目录
export const SRC_DIR = path.join(ROOT, "data"); // 词汇数据源
export const OUT_DIR = path.join(ROOT, "src", "data"); // 输出目录
export const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

/** 产物存在且不旧于源文件，才算可以跳过 */
function isFresh(src, out) {
  try {
    const target = fs.statSync(out);
    return target.size > 0 && target.mtimeMs >= fs.statSync(src).mtimeMs;
  } catch {
    return false;
  }
}

/**
 * @param {{ force?: boolean }} [options]
 * @returns {{ built: string[], skipped: string[], total: number, report: string[] }}
 */
export function buildData({ force = false } = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let total = 0;
  const built = [];
  const skipped = [];
  const report = [];

  for (const L of LEVELS) {
    const src = path.join(SRC_DIR, `${L}.js`);
    const out = path.join(OUT_DIR, `${L}.json`);
    if (!fs.existsSync(src)) throw new Error(`缺少数据文件：${src}`);

    if (!force && isFresh(src, out)) {
      const size = fs.statSync(out).size;
      total += size;
      skipped.push(L);
      report.push(`  ${L}: 跳过（已是最新）, ${(size / 1024).toFixed(1)} KB`);
      continue;
    }

    const code = fs.readFileSync(src, "utf8");
    // 在隔离沙箱里执行原文件，取出 window.OX[L]，保证与线上完全同一份数据
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: src });

    const rows = sandbox.window.OX && sandbox.window.OX[L];
    if (!Array.isArray(rows)) throw new Error(`${src} 里没有 window.OX.${L}`);

    const json = JSON.stringify(rows);
    fs.writeFileSync(out, json);
    total += Buffer.byteLength(json);
    built.push(L);
    report.push(`  ${L}: ${rows.length} 条, ${(json.length / 1024).toFixed(1)} KB`);
  }

  return { built, skipped, total, report };
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const { built, skipped, total, report } = buildData({
    force: process.argv.includes("--force"),
  });
  const nothingToDo = built.length === 0 && skipped.length === LEVELS.length;
  console.log(nothingToDo ? "数据已是最新，跳过转换：" : "数据已转为 JSON：");
  report.forEach((line) => console.log(line));
  console.log(`  合计 ${(total / 1024).toFixed(1)} KB`);
}
