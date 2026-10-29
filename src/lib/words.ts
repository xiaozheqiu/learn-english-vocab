/** 词表加载、主键生成、释义抽取（§6 lib/words.ts） */
import { type Level, type RawRow, type Tier, type Word } from "./types";
import { LEVELS } from "./types";

const cache = new Map<Level, Word[]>();

/**
 * 口语词频顺序表（scripts/gen-tiers.py 生成）。
 *
 * 只加载一次；加载失败不影响主流程 —— 拿不到顺序就退回数据原始顺序，
 * 功能降级而不是报错，否则一份可选的数据文件能把整个应用挡在启动页。
 */
interface TierPayload {
  version: number;
  /** 累积分界：order[0..tierBounds.core) 是 core，其余是 extended */
  tierBounds: Record<string, number>;
  order: string[];
}

/** 分档结果：key → { rank, tier } */
export interface TierInfo {
  rank: number;
  tier: Tier;
}

/**
 * 牛津官方标记。
 * 两个字段都是可选的：词不在官方表里时那条记录就是空对象，
 * 生成脚本只写存在的标记，不写 false。
 */
interface OxfordRecord {
  ox3000?: boolean;
  ox5000?: boolean;
}

/**
 * 牛津官方词表标记（scripts/gen-oxford.py 从牛津快照生成）。
 *
 * 这个文件原来叫 cefr.json，带词条级 / 义项级 CEFR，用来做「难度」筛选；
 * 那个维度和词表自带的 A1–C1 等级 99% 重合（5323 条里 5280 条一致），
 * 已经移除，文件也随之只留两个官方标记，从 425KB 收到 175KB。
 *
 * 与 tiers 一样是一次性加载、失败降级：拿不到就没有标记，
 * 不影响词表 —— 标记是增强信息，不是启动必需。
 */
let oxfordPromise: Promise<Map<string, OxfordRecord>> | null = null;

export function loadOxfordIndex(): Promise<Map<string, OxfordRecord>> {
  if (!oxfordPromise) {
    oxfordPromise = (async () => {
      try {
        const mod = (await import("../data/oxford.json")) as {
          default: Record<string, OxfordRecord>;
        };
        return new Map(Object.entries(mod.default ?? {}));
      } catch {
        return new Map<string, OxfordRecord>();
      }
    })();
  }
  return oxfordPromise;
}

let tierPromise: Promise<Map<string, TierInfo>> | null = null;

export function loadTierOrder(): Promise<Map<string, TierInfo>> {
  if (!tierPromise) {
    tierPromise = (async () => {
      const map = new Map<string, TierInfo>();
      try {
        const mod = (await import("../data/tiers.json")) as { default: TierPayload };
        const order = mod.default?.order ?? [];
        const coreEnd = mod.default?.tierBounds?.core ?? order.length;
        order.forEach((key, index) => {
          map.set(key, { rank: index + 1, tier: index < coreEnd ? "core" : "extended" });
        });
      } catch {
        // 分档文件缺失：不阻断加载。rank=0、tier 按 core 兜底，
        // 宁可让 extended 混进队列，也不要因为一份可选文件把应用挡在启动页。
      }
      return map;
    })();
  }
  return tierPromise;
}

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
    rank: 0,
    tier: "core" as Tier,
    ox3000: false,
    ox5000: false,
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
  const [rows, ranks, oxford] = await Promise.all([
    importLevel(level),
    loadTierOrder(),
    loadOxfordIndex(),
  ]);
  const words = buildKeys(level, rows);
  for (const word of words) {
    const info = ranks.get(word.key);
    word.rank = info?.rank ?? 0;
    word.tier = info?.tier ?? "core";
    const rec = oxford.get(word.key);
    word.ox3000 = rec?.ox3000 ?? false;
    word.ox5000 = rec?.ox5000 ?? false;
  }
  cache.set(level, words);
  return words;
}

/** 搜索需要跨等级，带进度回调 */
export async function loadAll(onProgress?: (done: number, total: number) => void): Promise<Word[]> {
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
