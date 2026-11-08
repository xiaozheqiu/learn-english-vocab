/** 词表加载、主键生成、释义抽取（§6 lib/words.ts） */
import { type Bucket, type RawRow, type Tier, type Word } from "./types";
import { BUCKETS, PHRASE_LEVEL } from "./types";

/*
 * 缓存按「板块」分片，六片：五个词汇等级 + 短语栏。
 *
 * 短语栏不参与「等级加载」那套逻辑（它没有 CEFR 等级，也没有分包顺序要求），
 * 但对缓存来说就是又一片 JSON，用同一套机制最省事。
 */
const cache = new Map<Bucket, Word[]>();

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
 * 短语判定：含空格、且不含逗号。
 *
 * `have to` / `according to` / `ice cream` 是短语；`a, an` 含空格但含逗号，
 * 它是冠词 a 与 an 两个书写变体并列，不是短语。连字符词（`T-shirt`）不含
 * 空格，仍是单词。
 *
 * 规则放在这里而不是在数据里加字段：数据多存一个 kind 就多一份要跟着改的真值，
 * 而这条判定是纯函数，两边（这里与 scripts/merge-words.py）用同一条规则即可。
 */
export function isPhrase(word: string): boolean {
  return word.includes(" ") && !word.includes(",");
}

/**
 * 词条主键：`等级|单词`。
 *
 * 合并之后一个单词只有一行，词性不再参与主键 —— 词性差异表达在同一行的
 * pos 串里（`arm  n., v.(C1)`）。旧规则是 `等级|单词|词性[|序号]`，那份
 * 数据里同一个词会占 2~4 行，既是「重复感」的来源，也让勾选粒度莫名其妙。
 *
 * 短语不参与等级：它们的 level 记作 `PHRASE`，主键随之是 `PHRASE|have to`。
 * 这样短语有独立的一栏，不会挤进 A1 把 A1 的进度分母撑大。
 *
 * 老进度由 migrateLegacyKeys() 负责换算，不靠这里兼容旧格式。
 */
export function buildKeys(level: Bucket, rows: readonly RawRow[]): Word[] {
  return rows.map<Word>((r) => {
    const word = String(r[0] ?? "").trim();
    return {
      // 短语一律落在 PHRASE 栏，即使调用方按 A1 传进来
      key: `${isPhrase(word) ? PHRASE_LEVEL : level}|${word}`,
      level: isPhrase(word) ? PHRASE_LEVEL : level,
      word,
      pos: String(r[1] ?? "").trim(),
      rank: 0,
      tier: "core" as Tier,
      ox3000: false,
      ox5000: false,
    };
  });
}

/** 动态导入单个等级的分包 */
async function importLevel(level: Bucket): Promise<readonly RawRow[]> {
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
const enrichedLevels = new Set<Bucket>();

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
export async function loadLevel(level: Bucket, withIndexes = true): Promise<Word[]> {
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

/** 搜索需要跨板块，带进度回调。走过的板块一律补齐索引。 */
export async function loadAll(onProgress?: (done: number, total: number) => void): Promise<Word[]> {
  let done = 0;
  const groups = await Promise.all(
    BUCKETS.map(async (level) => {
      const words = await loadLevel(level);
      done += 1;
      onProgress?.(done, BUCKETS.length);
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
  for (const level of BUCKETS) {
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
  return BUCKETS.every((level) => !cache.has(level) || enrichedLevels.has(level));
}

/** 已加载的等级（同步读取，供需要立刻渲染的场景） */
export function cachedAll(): Word[] {
  return BUCKETS.flatMap((level) => cache.get(level) ?? []);
}

/**
 * 释义缓存：`key → 中文释义`。
 *
 * 释义单独成包（`zh-*.json`），与词表同序一一对应，靠下标对齐。为什么不并回
 * 主产物：并回去是 21.7KB → 73.6KB gzip，每个只用英文的人凭空多付 52KB，
 * 而中文模式只是其中一种看法。分开之后，只有真的切到中文模式才下载。
 *
 * 为什么是 Map 而不是给 `Word` 加回 `cn` 字段：`Word` 是词表筛选的输入，
 * 每加一个字段都要在 filterWords / applyOrder / 一堆测试里跟着走一遍，
 * 而释义不参与任何筛选。传一个并行的 Map，行组件按 key 取，边界最清楚。
 */
const glossCache = new Map<Bucket, Map<string, string>>();

/**
 * 载入某个板块的释义。
 *
 * 依赖 `loadLevel(level, false)`：两边都源自同一份 `data/*.js`，顺序天然一致。
 * 万一长度对不上（比如产物是旧的、词表是新的），**返回空 Map 而不是错位填充** ——
 * 少显示释义只是难看，错位却是把 A 的答案挂到 B 上，那才是背错的开始。
 */
export async function loadGlosses(level: Bucket): Promise<Map<string, string>> {
  const hit = glossCache.get(level);
  if (hit) return hit;

  const words = await loadLevel(level, false);
  const map = new Map<string, string>();
  try {
    const mod = (await import(`../data/zh-${level}.json`)) as { default: readonly string[] };
    const glosses = mod.default ?? [];
    if (glosses.length !== words.length) return new Map();
    words.forEach((word, index) => {
      const gloss = glosses[index];
      if (gloss) map.set(word.key, gloss);
    });
  } catch {
    // 释义是增强信息，拿不到就当没有：绝不因此把词表挡在启动页
    return new Map();
  }
  glossCache.set(level, map);
  return map;
}

/**
 * 易混词分组：`释义 → 该释义下的全部 key`。
 *
 * 由 `scripts/build-data.mjs` 在构建期算好（192 组 / 399 条），运行期只是读。
 * **只在这个功能真的被打开时才载入**（7.1KB）：不在模块顶层自动发起请求 ——
 * 那会让每个首屏都为一个多数人不会用的筛选付流量，等于白做「按需加载」。
 * 与 tiers / oxford 一样，拿不到就降级成空 Map，词表照常用。
 */
let confusablesPromise: Promise<Map<string, string[]>> | null = null;

export function loadConfusables(): Promise<Map<string, string[]>> {
  if (!confusablesPromise) {
    confusablesPromise = (async () => {
      try {
        const mod = (await import("../data/confusables.json")) as {
          default: Record<string, string[]>;
        };
        return new Map(Object.entries(mod.default ?? {}));
      } catch {
        // 拿不到就没有易混词这一档
        return new Map<string, string[]>();
      }
    })();
  }
  return confusablesPromise;
}

/** 已经拿到手的分组（同步读取）；没载入过就是空 Map */
export function cachedConfusables(): Map<string, string[]> {
  return confusablesLoaded ?? new Map<string, string[]>();
}

/** loadConfusables 成功后的那份结果，供同步读取 */
let confusablesLoaded: Map<string, string[]> | null = null;

/** 载入并记住，返回同一份引用（幂等） */
export async function ensureConfusablesLoaded(): Promise<Map<string, string[]>> {
  if (confusablesLoaded) return confusablesLoaded;
  confusablesLoaded = await loadConfusables();
  return confusablesLoaded;
}

/** 已载入的释义合在一起（同步读取，供渲染时按 key 取） */
export function cachedGlosses(): Map<string, string> {
  return new Map([...glossCache.values()].flatMap((map) => [...map]));
}

/** 五个词汇等级（不含短语栏）—— 首屏快路径与「全部等级是否到齐」只认这个 */
export function isLoaded(levels: readonly Bucket[]): boolean {
  return levels.every((level) => cache.has(level));
}
