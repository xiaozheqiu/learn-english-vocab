// 把 ../data/*.js（window.OX.A1 = [[...]]）转成 src/data/*.json。
// 数据源不变，只是换个格式给 Vite 用：JSON 能走正常的动态 import + 分包。
//
// 转出时只保留 [单词, 词性]：源数据是 [单词, 词性, 中文释义, 3000/5000, 序号]，
// 后三项前端一个都不读（释义不显示也不参与搜索，查词走三方词典），却占了分包
// 六成以上体积、还要进 PWA 预缓存。裁掉后 250KB → 93KB。
// 需要释义仍然读 data/*.js —— 审计脚本和重抓牛津义项都以它为源。
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

/**
 * 短语单独一栏（`have to` / `according to` / `ice cream`）。
 *
 * 它们是「组合词」，不是某个等级里的单词：混在 A1 里会把 A1 的进度分母撑大，
 * 也会让「A1 已掌握 12/898」这种数字对不上「A1 到底有多少个单词」。
 * 拆出来之后 A1–C1 只剩单词，短语自己一栏。
 */
export const PHRASE_LEVEL = "PHRASE";

/** 产物要写的等级：五个词汇等级 + 短语栏 */
export const BUCKETS = [...LEVELS, PHRASE_LEVEL];

/**
 * 短语判定，与 src/lib/words.ts 的 isPhrase 同一条规则。
 *
 * 含空格、且不含逗号：`a, an` 含空格但含逗号，是冠词两个书写变体并列，不是短语；
 * 连字符词（`T-shirt`）不含空格，仍是单词。
 */
export function isPhrase(word) {
  return String(word).includes(" ") && !String(word).includes(",");
}

/** 产物每行的列数：[单词, 词性] */
export const ROW_WIDTH = 2;

/** 源数据行 → 产物行 */
function toRow(r) {
  return [String(r[0] ?? ""), String(r[1] ?? "")];
}

/**
 * 产物存在、不旧于给定时刻，且形状是当前版本，才算可以跳过。
 *
 * 形状必须一起查：只比 mtime 的话，改窄了产物结构之后老 JSON 依旧「更新」，
 * 会被永久跳过 —— 表现为本地删了字段、线上还是旧的。
 */
function isFreshAt(srcMtimeMs, out) {
  try {
    const target = fs.statSync(out);
    if (target.size === 0 || target.mtimeMs < srcMtimeMs) return false;
    const first = JSON.parse(fs.readFileSync(out, "utf8"))[0];
    return Array.isArray(first) && first.length === ROW_WIDTH;
  } catch {
    return false;
  }
}

/**
 * 读回某个等级的产物（测试用：断言产物形状在被谁改过之后仍然只有两列）。
 * 读不出来就抛，不返回空数组 —— 空数组会让「形状对」的断言假通过。
 */
export function readBuiltRows(level) {
  const out = path.join(OUT_DIR, `${level}.json`);
  const rows = JSON.parse(fs.readFileSync(out, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${out} 不是非空数组`);
  return rows;
}

/**
 * 往某个等级的产物里写一份伪造内容，并把 mtime 推到源文件之后（测试夹具）。
 *
 * 用来复现「产物看起来更新，但形状是旧的」这个场景：如果 isFresh 只比 mtime，
 * 这种产物会被永久跳过，改窄字段等于没生效。mtime 必须在脚本里改，
 * 测试侧拿不到 node:fs 的类型声明，也不该为一条断言往前端依赖里塞 @types/node。
 */
export function writeBuiltRowsForTest(level, rows) {
  const out = path.join(OUT_DIR, `${level}.json`);
  fs.writeFileSync(out, JSON.stringify(rows));
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(out, future, future);
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

  /*
   * 一次读完五个等级的源文件，再按「是不是短语」分到各桶。
   *
   * 短语不能靠「源文件里本来就在哪」来落桶：`have to` 现在写在 data/A1.js 里，
   * 但它不该算 A1 的词。所以先把 5 个源文件全读进来、按词分流，最后统一写产物。
   * 代价是不再能「只重建改过的那一个等级」—— 分流本来就是跨文件的，
   * 增量跳过只在全部源文件都没变时才成立（见下面的 freshness 判断）。
   */
  const buckets = new Map(BUCKETS.map((bucket) => [bucket, []]));
  const srcStats = [];

  for (const L of LEVELS) {
    const src = path.join(SRC_DIR, `${L}.js`);
    if (!fs.existsSync(src)) throw new Error(`缺少数据文件：${src}`);

    const code = fs.readFileSync(src, "utf8");
    // 在隔离沙箱里执行原文件，取出 window.OX[L]，保证与线上完全同一份数据
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: src });

    const rows = sandbox.window.OX && sandbox.window.OX[L];
    if (!Array.isArray(rows)) throw new Error(`${src} 里没有 window.OX.${L}`);

    srcStats.push({ level: L, src, mtimeMs: fs.statSync(src).mtimeMs, count: rows.length });
    for (const row of rows) {
      const bucket = isPhrase(row[0]) ? PHRASE_LEVEL : L;
      buckets.get(bucket).push(toRow(row));
    }
  }

  /*
   * 产物的新鲜度看的是「全部源文件里最新的那个 mtime」，不是各自对应的源文件：
   * 改了 A1.js 里的短语，PHRASE.json 也得跟着重写，而 PHRASE.json 没有
   * 自己的源文件。
   */
  const newestSrc = Math.max(...srcStats.map((s) => s.mtimeMs));

  for (const bucket of BUCKETS) {
    const out = path.join(OUT_DIR, `${bucket}.json`);
    const rows = buckets.get(bucket);

    if (!force && isFreshAt(newestSrc, out)) {
      const size = fs.statSync(out).size;
      total += size;
      skipped.push(bucket);
      report.push(`  ${bucket}: 跳过（已是最新）, ${(size / 1024).toFixed(1)} KB`);
      continue;
    }

    const json = JSON.stringify(rows);
    fs.writeFileSync(out, json);
    total += Buffer.byteLength(json);
    built.push(bucket);
    report.push(`  ${bucket}: ${rows.length} 条, ${(json.length / 1024).toFixed(1)} KB`);
  }

  return { built, skipped, total, report };
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const { built, skipped, total, report } = buildData({
    force: process.argv.includes("--force"),
  });
  const nothingToDo = built.length === 0 && skipped.length === BUCKETS.length;
  console.log(nothingToDo ? "数据已是最新，跳过转换：" : "数据已转为 JSON：");
  report.forEach((line) => console.log(line));
  console.log(`  合计 ${(total / 1024).toFixed(1)} KB`);
}
