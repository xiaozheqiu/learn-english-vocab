// 数据加载与词条键生成。
// 键的规则必须和旧版 index.html 完全一致，否则老用户已有的勾选进度会对不上。
const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const cache = {};

export { LEVELS };

export const ALL = LEVELS.concat(["ALL"]);

export const SIZES = [20, 50, 100, 200, 500];

export function needOf(l) {
  return l === "ALL" ? LEVELS : [l];
}

// 把原始数组转成对象数组，并生成唯一键：
// 同等级下 (词, 词性) 重复时给键加序号，避免两条词共用一个勾
export function ingest(L, rows) {
  const arr = rows.map((r) => ({
    lv: L,
    w: r[0],
    p: r[1],
    cn: r[2],
    sc: r[3],
    sn: r[4] || "",
  }));
  const cnt = {};
  for (const d of arr) {
    const b = d.lv + "|" + d.w + "|" + d.p;
    cnt[b] = (cnt[b] || 0) + 1;
  }
  const seen = {};
  for (const d of arr) {
    const b = d.lv + "|" + d.w + "|" + d.p;
    if (cnt[b] > 1) {
      seen[b] = (seen[b] || 0) + 1;
      d._k = b + "|" + seen[b];
    } else d._k = b;
  }
  return arr;
}

export async function loadLevel(L) {
  if (cache[L]) return cache[L];
  const mod = await import(`../data/${L}.json`);
  cache[L] = ingest(L, mod.default);
  return cache[L];
}

// 全部加载：搜索要跨等级
export async function loadAll(onProgress) {
  let n = 0;
  const out = {};
  await Promise.all(
    LEVELS.map(async (L) => {
      out[L] = await loadLevel(L);
      if (onProgress) onProgress(++n, LEVELS.length);
    }),
  );
  return out;
}

export function esc(s) {
  return (s || "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}
