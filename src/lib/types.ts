/** 共享类型与常量（§5 F4 / §6 lib/types.ts） */

export const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type Level = (typeof LEVELS)[number];

/**
 * 短语栏。
 *
 * `have to` / `according to` / `ice cream` 这类组合词不属于任何 CEFR 等级：
 * 混在 A1 里会让「A1 有 898 个单词」和「A1 已掌握 12/898」都对不上，
 * 而且它们是「整块记」的东西，学习节奏和单词也不一样。
 * 所以单独一栏，主键里 level 记作 PHRASE。
 */
export const PHRASE_LEVEL = "PHRASE" as const;
export type PseudoLevel = typeof PHRASE_LEVEL;

/** 词条真正能落的位置：五个等级 + 短语栏 */
export type Bucket = Level | PseudoLevel;
/** 板块筛选能选的范围：字母序在前，短语排在最后 */
export const BUCKETS = [...LEVELS, PHRASE_LEVEL] as const;

export type LevelFilter = Bucket | "ALL";

/**
 * 板块的中文显示名。
 *
 * A1–C1 直接用代号（那是官方等级名，用户认得），只有 PHRASE 是内部代号、
 * 必须换成「短语」—— 界面上曾经直接印出 `PHRASE 已掌握 0 / 9`，像没做完的半成品。
 * 显示名集中在这里，进度条、筛选按钮、空态文案共用，不各写一份。
 */
export const BUCKET_LABELS: Record<LevelFilter, string> = {
  A1: "A1",
  A2: "A2",
  B1: "B1",
  B2: "B2",
  C1: "C1",
  PHRASE: "短语",
  ALL: "全库",
};

/** 板块代号 → 显示名 */
export function bucketLabel(bucket: LevelFilter): string {
  return BUCKET_LABELS[bucket] ?? bucket;
}

export function isLevelFilter(value: unknown): value is LevelFilter {
  return (
    value === "ALL" || (typeof value === "string" && (BUCKETS as readonly string[]).includes(value))
  );
}

/** 只认五个词汇等级（加载分包、算学习进度时用，短语栏不走这条路径） */
export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/**
 * 每页条数。
 *
 * 上限从 500 收到 200：实测 500 行是 7608 个 DOM 节点，切一次页要 250ms
 * （主要是浏览器排版，不是 React），而 200 行只要 200ms 且页数仍有 27 页。
 * 500 带来的收益只是「少点 16 次下一页」，代价是每次翻页都卡一下。
 */
export const PAGE_SIZES = [20, 50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** 词表行（由 src/data/*.json 归一化而来） */
export interface Word {
  /**
   * 主键：`板块|单词`。
   *
   * 合并之后一个单词只有一行，词性不进主键 —— 词性差异表达在同一行的 pos 串
   * 里（`arm  n., v.(C1)`）。旧规则的 `等级|单词|词性[|序号]` 会让同一个词
   * 占 2~4 行，既是「重复感」的来源，也让勾选粒度变得莫名其妙。
   * 旧进度由 db.ts 的 migrateLegacyKeys() 换算。
   */
  key: string;
  /** 所属板块：A1–C1，或 PHRASE（短语栏） */
  level: Bucket;
  word: string;
  /** 词性串；跨等级的词性带等级标注，如 `n., v.(C1)` */
  pos: string;
  /**
   * 口语词频学习顺序（1 起）。
   *
   * data/*.js 本身按字母序排，字母序会把 abandon / abolish / abrupt 这类
   * 抽象书面词顶到最前，背起来既无语境又互相干扰。这里用 ECDICT 的
   * frq/bnc 词频重排，A 档（前 2899）覆盖日常文本约 85%。
   * 0 = 未取到分档（不应出现，兜底排到最后）。
   */
  rank: number;
  /**
   * 学习档位：core = 日常听说够用；extended = 认脸即可。
   *
   * 按口语词频（≤5000）切，不按 A1–C1 等级切。等级是教学大纲难度，
   * 不是常用度：C1 里既有 genocide/asylum 这类政治史词，也有 abuse/attorney/
   * burden 这类新闻口语高频词，按等级一刀切会把后者一起干掉。
   */
  tier: Tier;
  /** 牛津官方 Oxford 3000 / 5000 标记 */
  ox3000: boolean;
  ox5000: boolean;
}

export type Tier = "core" | "extended";

/**
 * 构建产物行：`[单词, 词性]`。
 *
 * 源数据 `data/*.js` 是 5 元组 `[单词, 词性, 中文释义, 3000/5000, 序号]`，
 * 但后三项在前端没有任何读取方：释义不显示、也不参与搜索（查词交给三方词典），
 * 序号与 3000/5000 从未进过 UI，主键也只用前两项。
 * 继续把它们搬进分包，等于让每个用户多下载四成用不到的字节，
 * 还要被 PWA 预缓存 —— 所以在 scripts/build-data.mjs 里就裁掉了。
 * 需要释义请读 `data/*.js`（审计脚本与重抓牛津义项仍以它为源）。
 */
export type RawRow = [string, string];

export type MasteryFilter = "all" | "todo" | "done";

/** 偏好（meta.prefs）：只剩词表本身的显示选项 */
export interface Prefs {
  pageSize: PageSize;
  defaultLevel: LevelFilter;
}

export const DEFAULT_PREFS: Prefs = {
  pageSize: 20,
  defaultLevel: "A1",
};

/** meta store 里真正还在用的三把键 */
export interface MetaState {
  /** 旧 localStorage 是否已迁移 */
  migratedFromLocal: boolean;
  /** 旧主键（等级|单词|词性）是否已换算成新主键（板块|单词） */
  migratedKeys: boolean;
  prefs: Prefs;
}

export const DB_NAME = "ox5000";
/**
 * v2：删掉复习遗留的 srs / reviews / days 三个 store，并清掉锁屏相关的 meta 键。
 * v3：加 `drills` —— 自测作答流水（见 DrillRecord）。
 */
export const DB_VERSION = 3;

/**
 * 一次自测的流水记录（`drills` store）。
 *
 * ## 为什么只存汇总，不存每题对错
 *
 * 「这周比上周记得牢吗」只需要每次的正确率；存每题对错要先设计一套「同一个词
 * 跨时间怎么对比」的模型，而这一版还没有用它的地方。先记能回答那个问题的最小字段，
 * 将来真要拟合复习曲线再加 —— 那时才知道该存什么。
 *
 * 追加写、不更新、不删除：它是流水账，不是状态。`at` 用客户端时间即可，
 * 这里没有多设备互相覆盖的问题（各设备各记各的，合并方式是「都留着」）。
 */
export interface DrillRecord {
  /** 自增主键（IndexedDB autoIncrement） */
  id?: number;
  /** 结束时刻（epoch ms） */
  at: number;
  /** 出题范围的简短描述，如「A1」「全库」「2026-11-08 那次筛选」——只供人读 */
  scope: string;
  /** 题量 */
  total: number;
  /** 答对数 */
  correct: number;
}

/** 旧版 localStorage 键名，保留作备份（§5 F4） */
export const LEGACY_MASTERED_KEY = "ox5000-mastered-v1";
