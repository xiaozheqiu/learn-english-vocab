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
 *
 * 注意：主键里的「序号」是**重复计数**（第几条同名同词性），
 * 不是源数据第 5 列的 seq —— 后者从未参与主键，所以裁掉不影响历史进度。
 */
export function buildKeys(level: Level, rows: readonly RawRow[]): Word[] {
  const base = rows.map<Word>((r) => ({
    key: "",
    level,
    word: String(r[0] ?? "").trim(),
    pos: String(r[1] ?? "").trim(),
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

/**
 * 已经补过 rank / tier / 牛津标记的等级。
 *
 * 词条进缓存时可能还是「裸的」（只有单词与词性），索引文件（tiers / oxford）
 * 随后才到。这张表记的是「补没补」，不是「载没载」—— 两者解耦之后，首屏才能
 * 只解析一个等级的字面量，不必等那 228KB 的索引。
 */
const enrichedLevels = new Set<Level>();

/**
 * 给一组词条补上 rank / tier / 牛津标记。
 *
 * 就地改 `Word` 对象：这些对象与缓存里是同一份引用，补完所有持有者立刻可见；
 * 也正因为是同一份引用，调用方要自己换一次数组引用来通知 React。
 */
async function enrich(words: Word[]): Promise<void> {
  const [ranks, oxford] = await Promise.all([loadTierOrder(), loadOxfordIndex()]);
  for (const word of words) {
    const info = ranks.get(word.key);
    word.rank = info?.rank ?? 0;
    word.tier = info?.tier ?? "core";
    const rec = oxford.get(word.key);
    word.ox3000 = rec?.ox3000 ?? false;
    word.ox5000 = rec?.ox5000 ?? false;
  }
}

/**
 * 载入一个等级。
 *
 * `withIndexes: false` 是首屏专用的快路径：只 import 这一个等级的分包、建好主键
 * 就交出去，不碰 tiers / oxford。默认视图那一屏（A1，900 条）立刻能画，
 * 其余等级与索引交给空闲时段（见 useVocabStore）。
 *
 * 代价：补齐前 rank / tier / 牛津标记还是默认值（rank=0、tier=core、标记全 false）。
 * 默认视图下档位与牛津两档不生效，看不出来；但用户持久化的视图可能正开着它们，
 * 那种情况下调用方必须传 true，否则会先画出一份错的筛选结果。
 */
export async function loadLevel(level: Level, withIndexes = true): Promise<Word[]> {
  let words = cache.get(level);
  if (!words) {
    words = buildKeys(level, await importLevel(level));
    cache.set(level, words);
  }
  if (withIndexes && !enrichedLevels.has(level)) {
    await enrich(words);
    enrichedLevels.add(level);
  }
  return words;
}

/** 搜索需要跨等级，带进度回调。走过的等级一律补齐索引。 */
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

/**
 * 把已进缓存的等级全部补齐索引，并把合并后的词表交回去。
 *
 * 首屏快路径只载一个等级、不碰索引，所以「档位 / 牛津」这两档在补齐之前
 * 拿不到真值（tier 一律是默认的 core、两个标记全 false）。任何要读这两维的
 * 地方都必须先过这里 —— 否则 A1 会显示「认脸档 0 条」这种看着像真空结果的错。
 */
export async function enrichAll(): Promise<Word[]> {
  for (const level of LEVELS) {
    const words = cache.get(level);
    if (words && !enrichedLevels.has(level)) {
      await enrich(words);
      enrichedLevels.add(level);
    }
  }
  return cachedAll();
}

/** 已加载的等级是否都补过索引（供界面判断「档位/牛津筛选能不能信」） */
export function indexesReady(): boolean {
  return LEVELS.every((level) => !cache.has(level) || enrichedLevels.has(level));
}

/** 已加载的等级（同步读取，供需要立刻渲染的场景） */
export function cachedAll(): Word[] {
  return LEVELS.flatMap((level) => cache.get(level) ?? []);
}

export function isLoaded(levels: readonly Level[]): boolean {
  return levels.every((level) => cache.has(level));
}
