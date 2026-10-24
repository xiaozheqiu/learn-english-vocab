/** 词表加载、主键生成、释义抽取（§6 lib/words.ts） */
import type { Level, RawRow, Word } from "./types";
import { LEVELS } from "./types";

const cache = new Map<Level, Word[]>();

/**
 * 旧规则主键：`等级|单词|词性[|序号]`。
 * 同等级下 (词, 词性) 重复时给键加序号，避免两条词共用一个勾。
 * 必须与旧版 index.html / data.js 完全一致，否则老用户进度对不上。
 */
export function buildKeys(level: Level, rows: readonly RawRow[]): Word[] {
  const base = rows.map<Word>((r) => ({
    key: "",
    level,
    word: String(r[0] ?? "").trim(),
    pos: String(r[1] ?? "").trim(),
    cn: String(r[2] ?? "").trim(),
    scope: String(r[3] ?? ""),
    seq: String(r[4] ?? ""),
  }));

  const counts = new Map<string, number>();
  for (const w of base) {
    const stem = `${w.level}|${w.word}|${w.pos}`;
    counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  for (const w of base) {
    const stem = `${w.level}|${w.word}|${w.pos}`;
    if ((counts.get(stem) ?? 0) > 1) {
      const n = (seen.get(stem) ?? 0) + 1;
      seen.set(stem, n);
      w.key = `${stem}|${n}`;
    } else {
      w.key = stem;
    }
  }
  return base;
}

/** 动态导入单个等级的分包 */
async function importLevel(level: Level): Promise<readonly RawRow[]> {
  const mod = (await import(`../data/${level}.json`)) as { default: readonly RawRow[] };
  return mod.default;
}

export async function loadLevel(level: Level): Promise<Word[]> {
  const hit = cache.get(level);
  if (hit) return hit;
  const words = buildKeys(level, await importLevel(level));
  cache.set(level, words);
  return words;
}

/** 搜索需要跨等级，带进度回调 */
export async function loadAll(
  onProgress?: (done: number, total: number) => void,
): Promise<Word[]> {
  let done = 0;
  const groups = await Promise.all(
    LEVELS.map(async (level) => {
      const words = await loadLevel(level);
      done += 1;
      onProgress?.(done, LEVELS.length);
      return words;
    }),
  );
  return groups.flat();
}

/** 已加载的等级（同步读取，供需要立刻渲染的场景） */
export function cachedAll(): Word[] {
  return LEVELS.flatMap((level) => cache.get(level) ?? []);
}

export function isLoaded(levels: readonly Level[]): boolean {
  return levels.every((level) => cache.has(level));
}

/**
 * 释义抽取：拼写题只接受词条里的并列写法（`a, an`），去掉括注。
 * 返回去重后的候选拼写，小写化。
 */
export function acceptedSpellings(word: string): string[] {
  const out = new Set<string>();
  const cleaned = word.replace(/\([^)]*\)/g, " ").trim();
  for (const part of cleaned.split(/\s*[,/;]\s*/)) {
    const norm = normalizeSpelling(part);
    if (norm) out.add(norm);
  }
  const whole = normalizeSpelling(cleaned);
  if (whole) out.add(whole);
  return [...out];
}

/** 去掉大小写、尾随标点、内部多余空格 */
export function normalizeSpelling(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,;:!?'"’”“()\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 释义首段，用于干扰项与列表展示 */
export function primaryMeaning(cn: string): string {
  return cn.split(/\s*[／/|]\s*/)[0]?.trim() || cn.trim();
}

/** 词性归一：把 `n., v.` 拆成 ['n.','v.']，用于「同词性」干扰项匹配 */
export function posTags(pos: string): string[] {
  return pos
    .split(/\s*[,，/]\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

export function samePos(a: Word, b: Word): boolean {
  const left = new Set(posTags(a.pos));
  return posTags(b.pos).some((tag) => left.has(tag));
}
