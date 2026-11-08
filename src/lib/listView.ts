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
  /**
   * 复核筛选："all" 不过滤；"d7"/"d30" 只留「标记已满 7 / 30 天」的词。
   *
   * 属于 ListCriteria 而不是 ListView：它确实改变结果集，抽屉的条数预览要跟着变。
   */
  review: ReviewFilter;
  /** 易混词筛选：只留与别的词共用同一句中文的词 */
  confusable: ConfusableFilter;
  query: string;
}

export interface ListView extends ListCriteria {
  /**
   * 显示语言：word = 只出英文（默认）；cn = 只出中文释义。
   *
   * 为什么需要它：拿着中文去反推英文，才是真正在回忆；盯着英文看只会认出
   * 「这行我见过」。实测里最常见的一句抱怨是「昨天明明背过，今天想不起来」——
   * 那是「认得出」和「想得出」的差别，而只给英文的词表只能训练前者。
   *
   * 它**不属于** ListCriteria：显示方式不改变结果集，所以 filterWords 不读它、
   * 抽屉的条数预览也不受它影响 —— 和 order / seed 是同一条边界。
   */
  display: DisplayFilter;
  /**
   * 排序方式：default = 保持数据原始（字母）顺序；random = 换一种乱序。
   *
   * 为什么需要它：词表按字母序排，连着背 A1 前几十个词时记住的是
   * 「a, an · about · above · across」这串流动，而不是词义本身。
   * 打乱之后每个词都得单独回忆，位置线索不再起作用。
   *
   * 它**不属于** ListCriteria：排序不改变结果集，只改变顺序，所以
   * filterWords 不读它、抽屉的条数预览也不受它影响（见 applyOrder）。
   */
  order: OrderFilter;
  /**
   * 乱序的种子。
   *
   * 不能在渲染时现算 `Math.random()`：那样每次重渲染都重洗一遍，
   * 翻页、勾选、切回标签页都会看到完全不同的顺序，连「刚才那一页」都回不去。
   * 种子随「确定」动作更新，同一轮内排序稳定。
   */
  seed: number;
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
 * 排序方式；只影响顺序，不影响筛选结果。
 *
 * `freq` = 按口语词频（`Word.rank`，ECDICT 的 frq/bnc 合成分）从高频到低频。
 * 为什么需要它：字母序是词典排版的副作用，不是学习顺序 —— A1 按字母序的
 * 头几个词是 `a, an, about, above, across`，按词频却是 `the, be, and, of, in`。
 * 前者只会让「今天背的 50 个词」在真实文本里几乎撞不到。
 *
 * 它读 `rank`，而 `rank` 来自 tiers.json —— 首屏快路径不载索引，那时 rank 全是 0。
 * 所以开了 freq 就必须等索引补齐（与档位 / 牛津筛选同一条边界，见
 * `firstPaintNeedsIndexes` 与 WordListPage 的 `viewNeedsIndexes`）。
 */
export type OrderFilter = "default" | "random" | "freq";
const ORDER_FILTERS: readonly OrderFilter[] = ["default", "random", "freq"];

/** 这个排序方式是否依赖 rank 索引（供首屏与视图判定用） */
export function orderNeedsIndexes(order: OrderFilter): boolean {
  return order === "freq";
}

/**
 * 显示语言；只影响「这一行长什么样」，不影响结果集。
 *
 * `cn` 不是「中英对照」而是**只给中文**：对照看仍然是「认得出」，只有撤掉
 * 英文才逼出回忆。想看回来点一下那一行就揭晓（见 WordRow）。
 */
export type DisplayFilter = "word" | "cn";
const DISPLAY_FILTERS: readonly DisplayFilter[] = ["word", "cn"];

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
    review: "all",
    confusable: "all",
    display: "word",
    order: "default",
    seed: 0,
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
  const display = DISPLAY_FILTERS.includes(input.display as DisplayFilter)
    ? (input.display as DisplayFilter)
    : base.display;
  const review = REVIEW_FILTERS.includes(input.review as ReviewFilter)
    ? (input.review as ReviewFilter)
    : base.review;
  const confusable = CONFUSABLE_FILTERS.includes(input.confusable as ConfusableFilter)
    ? (input.confusable as ConfusableFilter)
    : base.confusable;
  const order = ORDER_FILTERS.includes(input.order as OrderFilter)
    ? (input.order as OrderFilter)
    : base.order;
  // 种子只认非负整数；坏值退回 0，排序函数会把它当成一个合法的固定洗牌
  const seed =
    typeof input.seed === "number" && Number.isFinite(input.seed) && input.seed >= 0
      ? Math.floor(input.seed)
      : base.seed;
  const query = typeof input.query === "string" ? input.query.slice(0, MAX_QUERY) : base.query;
  const page =
    typeof input.page === "number" && Number.isFinite(input.page) && input.page >= 1
      ? Math.floor(input.page)
      : base.page;
  return {
    level,
    mode,
    tier,
    oxford,
    pos,
    initial,
    review,
    confusable,
    display,
    order,
    seed,
    query,
    page,
  };
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

/**
 * 「已掌握」查询。
 *
 * `Set` 只满足 has；`Map` 两者都有。复核筛选（`review`）要判断「标了多久」，
 * 靠的是 `get` 拿标记时间，所以它是可选方法：缺了就当成「没有时间信息」，
 * 那批词一律不算到期 —— 宁可漏报，也不要凭空的「这条该复习了」。
 */
export interface MasteredLookup {
  has(key: string): boolean;
  get?(key: string): number | undefined;
}

/**
 * 复核筛选：只看「标了有一阵子」的词。
 *
 * 为什么需要它：现在「已掌握」是终点 —— 标完就再也不会出现在任何视图里，
 * 于是「昨天背过、今天想不起来」这件事永远没有第二次接触的机会。
 * 而 `mastery` 里本来就存了标记时间（`at`），此前只有云端合并读它，界面从没告诉过
 * 用户「这个词是 40 天前标的」。这一档就是把那份现成数据用起来，不加任何新存储。
 *
 * 它**只对已标掌握的词有意义**：未掌握的词没有标记时间，谈不上「到期」。
 */
export type ReviewFilter = "all" | "d7" | "d30";
const REVIEW_FILTERS: readonly ReviewFilter[] = ["all", "d7", "d30"];

/** 复核档 → 天数阈值 */
const REVIEW_DAYS: Record<Exclude<ReviewFilter, "all">, number> = { d7: 7, d30: 30 };

/**
 * 易混词筛选："all" 不过滤；"only" 只留和别人共用同一句中文的词。
 *
 * 判据来自构建期生成的 `confusables.json`（192 组 / 399 条）。这些词不是数据错误 ——
 * 它们是真同义词，但也正因为同义，单独背哪个都记不牢：认不出是哪一个。
 * 单独筛出来是为了成组对比，而不是一个个孤立地背。
 */
export type ConfusableFilter = "all" | "only";
const CONFUSABLE_FILTERS: readonly ConfusableFilter[] = ["all", "only"];

/** 一天的毫秒数；按本地日历日四舍五入而不是 86400000 整除，免得跨夏令时差一小时 */
const DAY_MS = 86_400_000;

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
 *
 * ## 搜索按输入的语言分流
 *
 * - 输入含汉字 → 匹配**中文释义**（`glosses`）。中文模式里看到「回答；答复」，
 *   想反查是哪几个词，只能靠这条。
 * - 输入是英文 → 匹配单词，行为一个字没变。
 *
 * 分流而不是「两者都查」：查 `a` 时若同时匹配释义，会命中几百条含「一个」的词，
 * 把单词搜索结果淹掉。语言决定意图，比模糊匹配可靠。
 */
export function filterWords(
  words: readonly Word[],
  criteria: ListCriteria,
  mastered: MasteredLookup,
  glosses?: ReadonlyMap<string, string>,
  confusables?: ReadonlySet<string>,
): readonly Word[] {
  const keyword = criteria.query.trim().toLowerCase();
  const byChinese = /[\u4e00-\u9fa5]/.test(keyword);
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
    if (byChinese) {
      /*
       * 中文搜索。释义还没载入时 `glosses` 是空的 / undefined —— 那时**返回空集**
       * 而不是退化成「不过滤」。退化成不过滤会让用户以为搜到了全库，
       * 空集至少诚实：界面那边同时会把释义补载，下一帧就有结果。
       */
      if (!glosses || glosses.size === 0) return [];
      source = source.filter((w) => (glosses.get(w.key) ?? "").toLowerCase().includes(keyword));
    } else {
      source = source.filter((w) => w.word.toLowerCase().includes(keyword));
    }
  }
  if (criteria.confusable === "only") {
    /*
     * 只留「有同伴」的词。判据是外部传进来的 key 集合（构建期算好的 192 组），
     * 不在这里现算分组 —— 那需要整份词表 + 释义做一次全量分组，而这件事
     * 每次筛选都做一遍纯属重复劳动。
     *
     * 没有集合（还没载入）时返回空集：与中文搜索同一条原则，
     * 「不知道」不该表现为「全部命中」。
     */
    if (!confusables) return [];
    source = source.filter((w) => confusables.has(w.key));
  }
  if (criteria.review !== "all") {
    const days = REVIEW_DAYS[criteria.review];
    const now = Date.now();
    source = source.filter((w) => {
      const at = mastered.get?.(w.key);
      // 没有标记时间（未掌握 / 老数据 / 纯 Set 查询）一律不算到期：宁可漏报
      if (!at) return false;
      return (now - at) / DAY_MS >= days;
    });
  }
  if (criteria.mode === "todo") return source.filter((w) => !mastered.has(w.key));
  if (criteria.mode === "done") return source.filter((w) => mastered.has(w.key));
  return source;
}

/**
 * 距离标记已满多少天（用于行上那句「40 天前标的」）。
 *
 * 向下取整：只要跨过一天就报一天，不做四舍五入 —— 昨天标的显示「0 天前」
 * 比显示「1 天前」诚实。
 */
export function daysSinceMarked(at: number | undefined, now = Date.now()): number | null {
  if (!at || !Number.isFinite(at)) return null;
  const days = Math.floor((now - at) / DAY_MS);
  return days < 0 ? 0 : days;
}

/**
 * 乱序排序。
 *
 * 为什么不直接 `sort(() => Math.random() - 0.5)`：那是个假随机排序（比较器
 * 不自洽，结果取决于引擎的排序实现），更要命的是每渲染一次就重洗一遍 ——
 * 翻页、勾一个词、切回标签页，看到的都是另一批词，连「刚才是第几页」都回不去。
 *
 * 这里用「key + 种子」算一个哈希当排序键，于是同一轮内顺序完全确定：
 * 换页、勾选、切标签页都不动，只有重新点一次「确定」（换种子）才换一种排法。
 * 它也不依赖输入数组的原有顺序，将来数据源顺序变了，同一颗种子给出的
 * 仍是同一组词序的语义等价物。
 */
export function applyOrder(
  words: readonly Word[],
  order: OrderFilter,
  seed: number,
): readonly Word[] {
  if (order === "freq") {
    /*
     * 词频序：rank 小的在前。
     *
     * rank = 0 表示「没取到分档」，兜底排到最后 —— 与 `Word.rank` 注释里
     * 「0 = 未取到分档（不应出现，兜底排到最后）」一致。索引没补齐时所有词
     * 都是 0，于是退化成原始顺序；那种情况由界面挡在前面（等索引），
     * 不靠这里猜。
     *
     * 同 rank 按 key 兜底，保证结果与输入顺序无关（与随机排序同一条原则）。
     */
    return [...words].sort((a, b) => {
      const ra = a.rank || Number.MAX_SAFE_INTEGER;
      const rb = b.rank || Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }
  if (order !== "random") return words;
  // 排一次数组副本，不碰入参
  return [...words].sort((a, b) => {
    const diff = shuffleRank(a.key, seed) - shuffleRank(b.key, seed);
    // 哈希相同时按 key 兜底，保证结果与输入顺序无关
    return diff !== 0 ? diff : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/**
 * `key` 在给定种子下的排序权重（0–1 的浮点）。
 *
 * FNV-1a 混合种子后取 32 位，再折成浮点参与比较。够散、够快，
 * 而且不需要引入随机数库 —— 这里要的是「确定的一团乱」，不是密码学随机。
 */
function shuffleRank(key: string, seed: number): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
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
