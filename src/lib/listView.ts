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
  /**
   * 词性筛选："all" 不过滤；其余按归一化后的主词性大类命中。
   *
   * 一个词常有多个词性（`n., v.` / `det./pron./adv.`），这里取的是「集合命中」
   * 而不是「字符串相等」：book（n., v.）在「名词」和「动词」两档下都该出现，
   * 否则用户会以为词表里没这个词。归一化规则见 posTags()。
   */
  pos: PosFilter;
  /** 首字母筛选："all" 不过滤，否则只看该字母开头的词 */
  initial: InitialFilter;
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

/**
 * 词性筛选暴露的大类。
 *
 * 源数据里有 81 种写法（`n.,adj.` 少空格、`det./pron./adv.` 斜杠混排、
 * `modal v.`、`auxiliary v.`、`indefinite article` …），直接拿字符串做筛选等于
 * 让用户在 81 个几乎不重复的格子里点。这里只暴露 10 个真正会用的类别，
 * 混合写法按「命中任一」处理，细类映射进最近的大类（情态 / 助动词 → 动词，
 * 冠词 → 限定词）。完整对照见 src/content/part-of-speech.md。
 */
export const POS_FILTERS = [
  "n",
  "v",
  "adj",
  "adv",
  "pron",
  "prep",
  "det",
  "number",
  "conj",
  "exclam",
] as const;
export type PosTag = (typeof POS_FILTERS)[number];
export type PosFilter = "all" | PosTag;

const POS_FILTER_SET: ReadonlySet<string> = new Set<string>(["all", ...POS_FILTERS]);

/**
 * 源数据的零散词性标记 → 上文 10 个大类。
 *
 * 只映射真正出现的写法（data/*.js 里 81 种已穷举过），不做通用 NLP：
 * 词表是冻结数据，写死对照表比引一坨规则更可控。
 */
const POS_ALIASES: Readonly<Record<string, PosTag>> = {
  "modal v": "v",
  "auxiliary v": "v",
  "indefinite article": "det",
  "definite article": "det",
  article: "det",
};

/**
 * 不归入任何筛选档的细类：`infinitive marker` 只出现在 to 的
 * `prep., infinitive marker` 里，靠 prep 一档已经能筛到；
 * 硬塞进限定词会让人以为 to 是限定词。宁可在词性这一档漏一个标记，
 * 也不要造一个错的分类。
 */

/** 该词的全部词性大类；解析不出任何一类时返回空集合 */
export function posTags(pos: string): Set<PosTag> {
  const tags = new Set<PosTag>();
  for (const raw of pos.split(/[,/]/)) {
    // `n.,adj.` 这类紧贴写法靠 split 就能拆开，再去掉句点与多余空白
    const piece = raw.trim().toLowerCase().replace(/\.+$/, "").replace(/\s+/g, " ");
    if (!piece) continue;
    const tag = POS_ALIASES[piece] ?? piece;
    if ((POS_FILTERS as readonly string[]).includes(tag)) tags.add(tag as PosTag);
  }
  return tags;
}

/**
 * 带缓存的版本，供 filterWords 在每次输入 / 筛选时逐词调用。
 *
 * 词表只有 81 种 pos 字符串、5323 个词，缓存后每个词条只剩一次 Map 查表；
 * 返回的 Set 是共享的，调用方只读（filterWords 里只 has）。
 */
const POS_CACHE = new Map<string, ReadonlySet<PosTag>>();

function posTagsCached(pos: string): ReadonlySet<PosTag> {
  const hit = POS_CACHE.get(pos);
  if (hit) return hit;
  const tags = posTags(pos);
  POS_CACHE.set(pos, tags);
  return tags;
}

/**
 * 字母筛选按钮的候选。
 *
 * 少了 x：5323 条里没有一条以 x 开头（已逐条核过），给一个点了永远空态的按钮
 * 只是噪声。字母本身仍按 /^[a-z]$/ 判定，将来数据里出现 x 开头的词时
 * 只需把它加回这个数组，initialOf 不用改。
 */
export const INITIALS = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "y",
  "z",
] as const;
export type Initial = (typeof INITIALS)[number];
export type InitialFilter = "all" | Initial;

const INITIAL_SET: ReadonlySet<string> = new Set<string>(["all", ...INITIALS]);

/**
 * 词条的首字母（小写）。
 *
 * 词表里全部是 ASCII 字母开头的词（已核对 5323 条，没有数字 / 符号 / 非拉丁开头），
 * 所以不做归一化之外的兜底：取不到 a–z 就返回空串，筛选时自然被排除。
 */
export function initialOf(word: string): string {
  const first = word.trim().charAt(0).toLowerCase();
  return /^[a-z]$/.test(first) ? first : "";
}

/** 搜索词上限：防一条异常长的串被写进 localStorage 并在启动时反复解析 */
const MAX_QUERY = 80;

export function defaultListView(level: LevelFilter): ListView {
  return {
    level,
    mode: "all",
    tier: "all",
    oxford: "all",
    pos: "all",
    initial: "all",
    query: "",
    page: 1,
  };
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
  const pos = POS_FILTER_SET.has(input.pos as string) ? (input.pos as PosFilter) : base.pos;
  const initial = INITIAL_SET.has(input.initial as string)
    ? (input.initial as InitialFilter)
    : base.initial;
  const query = typeof input.query === "string" ? input.query.slice(0, MAX_QUERY) : base.query;
  const page =
    typeof input.page === "number" && Number.isFinite(input.page) && input.page >= 1
      ? Math.floor(input.page)
      : base.page;
  return { level, mode, tier, oxford, pos, initial, query, page };
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
 *
 * 首字母**不**这样：它和词性、档位一样是普通筛选条件，在当前等级内生效。
 * 停在 A1 选 S 就只出 A1 里 s 开头的词 —— 想跨等级看，把等级选成「全部」。
 * （早先把它当「浏览入口」处理、选字母就悄悄跳到全库，等于替用户改了他
 * 明确设过的等级条件，停在 A1 的人会被莫名拉走。）
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
  if (criteria.pos !== "all") {
    source = source.filter((w) => posTagsCached(w.pos).has(criteria.pos as PosTag));
  }
  if (!keyword && criteria.level !== "ALL") {
    source = source.filter((w) => w.level === criteria.level);
  }
  if (criteria.initial !== "all") {
    source = source.filter((w) => initialOf(w.word) === criteria.initial);
  }
  if (keyword) {
    source = source.filter((w) => w.word.toLowerCase().includes(keyword));
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
