/**
 * 词表视图状态（§5 F1）：筛选条件 + 页码的持久化，以及过滤 / 板块进度的纯函数。
 *
 * 为什么单独一个文件：这三件事都是「输入快照、输出结果」，不碰 React，
 * 可以直接单测；组件只做 setState 包装。
 */
import { isLevelFilter, type LevelFilter, type MasteryFilter, type Tier, type Word } from "./types";

export interface ListCriteria {
  level: LevelFilter;
  mode: MasteryFilter;
  /**
   * 档位筛选：all = 全部；core = 日常档；extended = 认脸档。
   *
   * 单独给一个维度而不是复用 level，是因为两者回答的不是同一个问题：
   * level 问「教学大纲几级」，tier 问「这个词值不值得背」。用户要跳过认脸档时
   * 需要的是后者，而这一档横跨 A1–C1（比如 C1 里有 genocide 也有 abuse）。
   */
  tier: TierFilter;
  /**
   * 牛津官方词表筛选："all" 不过滤；
   * "ox3000"/"ox5000" 只留官方标记的词；"none" 只看不在官方表里的词。
   */
  oxford: OxfordFilter;
  query: string;
}

export interface ListView extends ListCriteria {
  page: number;
}

/** 只记视图状态，不记用户数据；键名带版本，将来改结构可以换键而不是猜旧值 */
export const LIST_VIEW_KEY = "ox5000-list-view-v2";

const MODES: readonly MasteryFilter[] = ["all", "todo", "done"];
const TIER_FILTERS: readonly TierFilter[] = ["all", "core", "extended"];

/** 档位筛选值；"all" 不过滤 */
export type TierFilter = "all" | Tier;

/** 牛津官方词表筛选值 */
export type OxfordFilter = "all" | "ox3000" | "ox5000" | "none";
const OXFORD_FILTERS: readonly OxfordFilter[] = ["all", "ox3000", "ox5000", "none"];
/** 搜索词上限：防一条异常长的串被写进 localStorage 并在启动时反复解析 */
const MAX_QUERY = 80;

export function defaultListView(level: LevelFilter): ListView {
  return { level, mode: "all", tier: "all", oxford: "all", query: "", page: 1 };
}

/**
 * 把存储里的任意值收敛成合法视图。
 * 逐字段回落而不是整条丢弃：将来某天等级列表变了，用户的页码和搜索词不必一起作废。
 */
export function parseListView(raw: unknown, fallbackLevel: LevelFilter): ListView {
  const base = defaultListView(fallbackLevel);
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Record<string, unknown>;
  const level = isLevelFilter(input.level) ? input.level : base.level;
  const mode = MODES.includes(input.mode as MasteryFilter)
    ? (input.mode as MasteryFilter)
    : base.mode;
  const tier = TIER_FILTERS.includes(input.tier as TierFilter)
    ? (input.tier as TierFilter)
    : base.tier;
  const oxford = OXFORD_FILTERS.includes(input.oxford as OxfordFilter)
    ? (input.oxford as OxfordFilter)
    : base.oxford;
  const query = typeof input.query === "string" ? input.query.slice(0, MAX_QUERY) : base.query;
  const page =
    typeof input.page === "number" && Number.isFinite(input.page) && input.page >= 1
      ? Math.floor(input.page)
      : base.page;
  return { level, mode, tier, oxford, query, page };
}

/** 读回上次的视图；隐私模式下 localStorage 会抛，读不到就当第一次来 */
export function loadListView(fallbackLevel: LevelFilter): ListView {
  if (typeof window === "undefined") return defaultListView(fallbackLevel);
  try {
    const raw = window.localStorage.getItem(LIST_VIEW_KEY);
    if (!raw) return defaultListView(fallbackLevel);
    return parseListView(JSON.parse(raw), fallbackLevel);
  } catch {
    return defaultListView(fallbackLevel);
  }
}

export function saveListView(view: ListView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIST_VIEW_KEY, JSON.stringify(view));
  } catch {
    // 配额满 / 隐私模式：这次不记，页面照常工作
  }
}

/** `Set` 和 `Map` 都满足；只要 has，不关心值 */
export interface MasteredLookup {
  has(key: string): boolean;
}

/**
 * 词表过滤。
 *
 * 搜索跨全部等级、不服从等级筛选：之前这里是「先按等级过滤再搜索」，
 * 结果搜 abandon（B2 词）在默认 A1 下永远是「没有匹配」——明明全库已加载，
 * 用户却以为词表里没这个词。
 */
export function filterWords(
  words: readonly Word[],
  criteria: ListCriteria,
  mastered: MasteredLookup,
): readonly Word[] {
  const keyword = criteria.query.trim().toLowerCase();
  let source: readonly Word[] = words;
  if (criteria.tier !== "all") source = source.filter((w) => w.tier === criteria.tier);
  if (criteria.oxford === "ox3000") source = source.filter((w) => w.ox3000);
  else if (criteria.oxford === "ox5000") source = source.filter((w) => w.ox5000);
  else if (criteria.oxford === "none") source = source.filter((w) => !w.ox3000 && !w.ox5000);
  if (!keyword && criteria.level !== "ALL") {
    source = source.filter((w) => w.level === criteria.level);
  }
  if (keyword) {
    source = source.filter(
      (w) => w.word.toLowerCase().includes(keyword) || w.cn.toLowerCase().includes(keyword),
    );
  }
  if (criteria.mode === "todo") return source.filter((w) => !mastered.has(w.key));
  if (criteria.mode === "done") return source.filter((w) => mastered.has(w.key));
  return source;
}

export interface ScopeProgressInfo {
  /** 这一段进度描述的是哪个板块：LEVELS 之一，或全库 */
  scope: LevelFilter;
  mastered: number;
  total: number;
  /** 0–1；total 为 0 时给 0，避免 NaN */
  ratio: number;
}

/**
 * 板块掌握进度。
 *
 * 分母是板块总词数，不吃搜索词和掌握筛选 —— 否则选「已掌握」时进度永远 100%、
 * 搜一个词时永远是 0/1，这个数字就失去意义了。
 */
export function scopeProgress(
  words: readonly Word[],
  scope: LevelFilter,
  mastered: MasteredLookup,
): ScopeProgressInfo {
  let total = 0;
  let done = 0;
  for (const word of words) {
    if (scope !== "ALL" && word.level !== scope) continue;
    total += 1;
    if (mastered.has(word.key)) done += 1;
  }
  return { scope, mastered: done, total, ratio: total > 0 ? done / total : 0 };
}
