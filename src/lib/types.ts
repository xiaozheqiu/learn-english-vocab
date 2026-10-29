/** 共享类型与常量（§5 F4 / §6 lib/types.ts） */

export const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type Level = (typeof LEVELS)[number];
export type LevelFilter = Level | "ALL";

export function isLevelFilter(value: unknown): value is LevelFilter {
  return (
    value === "ALL" || (typeof value === "string" && (LEVELS as readonly string[]).includes(value))
  );
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

/** 词表行（由 data/*.json 归一化而来） */
export interface Word {
  /** 主键：等级|单词|词性[|序号]，与旧版 localStorage 规则一致 */
  key: string;
  level: Level;
  word: string;
  pos: string;
  cn: string;
  /** "3000" | "5000" */
  scope: string;
  /** 词条序号，未使用为 "" */
  seq: string;
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

/** 原始数据行：[单词, 词性, 中文释义, 3000/5000, 序号] */
export type RawRow = [string, string, string, string, (number | string | undefined)?];

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

/** meta store 里真正还在用的两把键 */
export interface MetaState {
  /** 旧 localStorage 是否已迁移 */
  migratedFromLocal: boolean;
  prefs: Prefs;
}

export const DB_NAME = "ox5000";
/** v2：删掉复习遗留的 srs / reviews / days 三个 store，并清掉锁屏相关的 meta 键 */
export const DB_VERSION = 2;

/** 旧版 localStorage 键名，保留作备份（§5 F4） */
export const LEGACY_MASTERED_KEY = "ox5000-mastered-v1";
