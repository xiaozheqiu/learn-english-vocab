// 把 ../data/*.js（window.OX.A1 = [[...]]）转成 src/data/*.json。
// 数据源不变，只是换个格式给 Vite 用：JSON 能走正常的动态 import + 分包。
//
// 每个板块出两份产物：
//   1. `L.json`    —— `[单词, 词性]`，词表渲染与筛选的唯一来源。
//   2. `zh-L.json` —— 中文释义的**裸数组**，与上面同序一一对应。
//
// 释义单独成包，不并回主产物：并回去是 21.7KB → 73.6KB gzip，每个只用英文
// 的人凭空多付 52KB。分开之后「中文模式」是唯一入口，按板块懒加载，
// 首屏只在该模式真的开着时才多一个 4~13KB 的包。
//
// 两份产物必须**同序对齐**：zh-L.json 靠下标找释义，一旦错位就是把 A 的释义
// 挂到 B 上。所以这里在写盘前逐板块断言长度相等，不相等直接抛 —— 宁可构建失败，
// 也不要发出一份会张冠李戴的数据。
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

/** 词表产物每行的列数：[单词, 词性] */
export const ROW_WIDTH = 2;

/** 源数据行 → 产物行 */
function toRow(r) {
  return [String(r[0] ?? ""), String(r[1] ?? "")];
}

/** 源数据行 → 释义行（中文原文，不做裁剪与归一） */
function toGloss(r) {
  return String(r[2] ?? "").trim();
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
 * 释义产物的新鲜度：不旧于源文件、且确实是一串字符串。
 *
 * 形状要单独查，理由和主产物一样 —— 只比 mtime 的话，改结构（比如曾把释义
 * 存成 {key: gloss} 的对象）之后老文件依旧算「更新」而被永久跳过。
 */
function isFreshGlossAt(srcMtimeMs, out) {
  try {
    const target = fs.statSync(out);
    if (target.size === 0 || target.mtimeMs < srcMtimeMs) return false;
    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    return Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string";
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
 * 读回某个等级的释义产物（测试用：断言它与词表同序对齐）。
 * 读不出来就抛，不返回空数组 —— 空数组会让「对齐」的断言假通过。
 */
export function readBuiltGlosses(level) {
  const out = path.join(OUT_DIR, `zh-${level}.json`);
  const glosses = JSON.parse(fs.readFileSync(out, "utf8"));
  if (!Array.isArray(glosses) || glosses.length === 0) throw new Error(`${out} 不是非空数组`);
  return glosses;
}

/**
 * 往某个等级的释义产物里写一份伪造内容，并把 mtime 推到源文件之后（测试夹具）。
 * 场景与 writeBuiltRowsForTest 相同：证明「形状变了的老产物不会被当成最新」。
 */
export function writeBuiltGlossesForTest(level, glosses) {
  const out = path.join(OUT_DIR, `zh-${level}.json`);
  fs.writeFileSync(out, JSON.stringify(glosses));
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(out, future, future);
}

/**
 * 易混词分组：共用同一句中文释义的词归成一组。
 *
 * ## 为什么需要它
 *
 * 修完释义撞车之后还剩 192 组、399 条词共用同一句中文（`almost`/`nearly`、
 * `answer`/`reply`/`respond`/`response`）。这些不是数据错误，是**真同义词** ——
 * 但也正因为它们同义，单独背任何一个都记不牢：识别不出来是哪一个。
 *
 * 把它们摆在一起对比（discrimination training），干扰就来自「相似」本身，
 * 比把每个词各背四遍有效。
 *
 * ## 为什么在构建期算
 *
 * 分组只依赖两份产物（词表 + 释义），运行期再算一遍纯属白费 CPU，还得为它
 * 在每个板块各自拼一次。这里算一次写成 `confusables.json`，首屏不用、
 * 只在用户真的筛选易混词时载入。
 *
 * 只收 ≥2 个词的组；单词组（99% 的词）不进文件，避免把整份词表复制一遍。
 *
 * @param {{ rows: Array<[string,string]>, glosses: string[], bucket: string }[]} parts
 * @returns {Record<string, string[]>} 释义 → 该释义下的全部 key
 */
export function buildConfusables(parts) {
  const byGloss = new Map();
  for (const { rows, glosses: zh, bucket } of parts) {
    rows.forEach((row, index) => {
      const gloss = String(zh[index] ?? "").trim();
      if (!gloss) return;
      const key = `${bucket}|${row[0]}`;
      const list = byGloss.get(gloss);
      if (list) list.push(key);
      else byGloss.set(gloss, [key]);
    });
  }

  /** 只留成组的，并按「组越大越靠前、同大小按释义字典序」固定下来 */
  return [...byGloss.entries()]
    .filter(([, keys]) => keys.length >= 2)
    .sort((a, b) =>
      b[1].length !== a[1].length ? b[1].length - a[1].length : a[0] < b[0] ? -1 : 1,
    )
    .reduce((acc, [gloss, keys]) => {
      acc[gloss] = keys;
      return acc;
    }, {});
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
  /** 与 buckets 同序的释义，写盘前逐板块核对长度 */
  const glosses = new Map(BUCKETS.map((bucket) => [bucket, []]));
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
      glosses.get(bucket).push(toGloss(row));
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
    const outGloss = path.join(OUT_DIR, `zh-${bucket}.json`);
    const rows = buckets.get(bucket);
    const zh = glosses.get(bucket);

    /*
     * 对齐是这两份产物唯一的契约，写盘前当场核对。
     * 错位的表现是「释义挂到隔壁词上」，比不显示更糟，而且没人会一眼看出来 ——
     * 所以这里不做降级、不写警告，直接让构建失败。
     */
    if (rows.length !== zh.length) {
      throw new Error(
        `${bucket}: 词表 ${rows.length} 行、释义 ${zh.length} 行，两份产物必须一一对应`,
      );
    }

    if (!force && isFreshAt(newestSrc, out) && isFreshGlossAt(newestSrc, outGloss)) {
      const size = fs.statSync(out).size + fs.statSync(outGloss).size;
      total += size;
      skipped.push(bucket);
      report.push(`  ${bucket}: 跳过（已是最新）, ${(size / 1024).toFixed(1)} KB`);
      continue;
    }

    const json = JSON.stringify(rows);
    const jsonZh = JSON.stringify(zh);
    fs.writeFileSync(out, json);
    fs.writeFileSync(outGloss, jsonZh);
    total += Buffer.byteLength(json) + Buffer.byteLength(jsonZh);
    built.push(bucket);
    report.push(
      `  ${bucket}: ${rows.length} 条, ${(json.length / 1024).toFixed(1)} KB` +
        ` + 释义 ${(jsonZh.length / 1024).toFixed(1)} KB`,
    );
  }

  /*
   * 易混词分组（见 buildConfusables）。它由上面两份产物推出，所以和它们
   * 用同一份新鲜度判断：任一板块重写过，这份也要重写。
   */
  const outConfusable = path.join(OUT_DIR, "confusables.json");
  const confusables = buildConfusables(
    BUCKETS.map((bucket) => ({
      rows: buckets.get(bucket),
      glosses: glosses.get(bucket),
      bucket,
    })),
  );
  const jsonConfusable = JSON.stringify(confusables);
  const confusableFresh =
    !force &&
    fs.existsSync(outConfusable) &&
    fs.statSync(outConfusable).mtimeMs >= newestSrc &&
    built.length === 0;
  if (!confusableFresh) {
    fs.writeFileSync(outConfusable, jsonConfusable);
    total += Buffer.byteLength(jsonConfusable);
    const groups = Object.keys(confusables).length;
    const entries = Object.values(confusables).reduce((sum, keys) => sum + keys.length, 0);
    report.push(
      `  易混词: ${groups} 组 / ${entries} 条, ${(jsonConfusable.length / 1024).toFixed(1)} KB`,
    );
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
