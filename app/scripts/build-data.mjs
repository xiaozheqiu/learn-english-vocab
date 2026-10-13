// 把 ../data/*.js（window.OX.A1 = [[...]]）转成 src/data/*.json。
// 数据源不变，只是换个格式给 Vite 用：JSON 能走正常的动态 import + 分包。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const SRC = path.resolve(APP, "..", "data"); // 词汇/learn-english-vocab-site/data
const OUT = path.join(APP, "src", "data");

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

fs.mkdirSync(OUT, { recursive: true });

let total = 0;
const report = [];

for (const L of LEVELS) {
  const file = path.join(SRC, `${L}.js`);
  if (!fs.existsSync(file)) throw new Error(`缺少数据文件：${file}`);

  const code = fs.readFileSync(file, "utf8");
  // 在隔离沙箱里执行原文件，取出 window.OX[L]，保证与线上完全同一份数据
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });

  const rows = sandbox.window.OX && sandbox.window.OX[L];
  if (!Array.isArray(rows)) throw new Error(`${file} 里没有 window.OX.${L}`);

  const json = JSON.stringify(rows);
  fs.writeFileSync(path.join(OUT, `${L}.json`), json);
  total += Buffer.byteLength(json);
  report.push(`  ${L}: ${rows.length} 条, ${(json.length / 1024).toFixed(1)} KB`);
}

console.log("数据已转为 JSON：");
report.forEach((r) => console.log(r));
console.log(`  合计 ${(total / 1024).toFixed(1)} KB`);
