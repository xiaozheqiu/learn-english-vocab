/** 共享类型与常量（§5 F4 / §6 lib/types.ts） */

export const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type Level = (typeof LEVELS)[number];
export type LevelFilter = Level | "ALL";

/**
 * 每页条数。
 *
 * 上限从 500 收到 200：实测 500 行是 7608 个 DOM 节点，切一次页要 250ms
 * （主要是浏览器排版，不是 React），而 200 行只要 200ms 且页数仍有 27 页。
 * 500 带来的收益只是「少点 16 次下一页」，代价是每次翻页都卡一下。
 */
export const PAGE_SIZES = [20, 50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const MAX_PAGE_SIZE = 500;

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
}

/** 原始数据行：[单词, 词性, 中文释义, 3000/5000, 序号] */
export type RawRow = [string, string, string, string, (number | string | undefined)?];

export type MasteryFilter = "all" | "todo" | "done";

/** 状态左栏的语义分类（§1.5） */
export type StatusKind = "new" | "due" | "learning" | "solid" | "mastered";

export interface StatusInfo {
  kind: StatusKind;
  /** 展示文案，「今天到期」「2 天后」「已掌握」 */
  label: string;
  /** 左栏 class 后缀 */
  rail: "rail-due" | "rail-learning" | "rail-solid" | "rail-mastered" | "";
}

/** FSRS 卡片持久化形态：Date 一律存 epoch ms，保持可 JSON 导出 */
export interface SrsCardRecord {
  key: string;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  /** 0 New / 1 Learning / 2 Review / 3 Relearning */
  state: 0 | 1 | 2 | 3;
  last_review?: number;
  /** 测验累计（F3 抽题权重用） */
  right: number;
  wrong: number;
}

/** 每次作答流水（导出后可用于拟合 FSRS 权重） */
export interface ReviewLogRecord {
  id?: number;
  key: string;
  /** epoch ms */
  at: number;
  rating: 1 | 2 | 3 | 4;
  /** 作答来源：复习卡 / 测试 */
  source: "review" | "quiz";
  stateBefore: 0 | 1 | 2 | 3;
  dueBefore: number;
  stabilityBefore: number;
  difficultyBefore: number;
  /** 本次安排的间隔（天） */
  scheduledDays: number;
  /** 是否答对（复习卡的 again 视为错） */
  correct: boolean;
}

/** 当日计数（§5 F4 days） */
export interface DayRecord {
  /** 本地日期 YYYY-MM-DD */
  day: string;
  reviewed: number;
  correct: number;
  wrong: number;
  /** 当日首次评分的新词数 */
  newWords: number;
}

/** 偏好（meta.prefs） */
export interface Prefs {
  pageSize: PageSize;
  defaultLevel: LevelFilter;
  /** 每日新词上限 */
  newPerDay: number;
  /**
   * 单轮复习题量。要能装下当天的到期卡，所以偏大（默认 300）。
   * 复习的任务是「清账」，做完才算今天结束。
   */
  reviewSize: number;
  /**
   * 单套测试题量。测试的任务是「练手感」，零碎时间也能做一套，
   * 所以和复习分开设置（默认 50）。
   */
  quizSize: number;
  /** 期望留存率 0.8–0.95 */
  retention: number;
  /** 自动锁定分钟数，0 = 不自动锁 */
  autoLockMinutes: number;
  /** 测试启用的题型 */
  quizTypes: QuizType[];
}

export type QuizType = "en2cn" | "cn2en" | "spell";

export const QUIZ_TYPES: readonly QuizType[] = ["en2cn", "cn2en", "spell"];

/**
 * 每日新词上限。
 *
 * 20–80 是「可持续」的区间：每天 60 个新词会连带出 190 次复习（实测），
 * 连续三个月是很陡的强度；80 之上复习量会压到做不完，只是把欠账推给明天。
 *
 * 对应的覆盖时长（5323 条）：20 个/天约 267 天，60 个/天约 89 天，80 个/天约 67 天。
 * 冲刺目标不再是硬性的「必须 90 天」，而是按当前设置实时显示「还需要多久」。
 */
export const NEW_PER_DAY_MIN = 20;
export const NEW_PER_DAY_MAX = 80;
export const NEW_PER_DAY_STEP = 10;

/** 单轮复习题量候选。60 个新词/天时到期峰值实测 265，默认取 300 才吃得下 */
export const REVIEW_SIZES = [150, 200, 300, 500] as const;
export const DEFAULT_REVIEW_SIZE = 300;

/** 单套测试题量候选。默认 50：约 5–7 分钟一套，零碎时间能做 */
export const QUIZ_SIZES = [20, 30, 50, 100] as const;
export const DEFAULT_QUIZ_SIZE = 50;

/**
 * 标记「已掌握」后的免检天数。
 *
 * 早期的 180 天等于永久免检，所以定 30 天：标记后一个月抽查一次，
 * 考过续期。这样「已掌握」仍然是降频而不是毕业。
 */
export const MASTERY_COOLDOWN_DAYS = 30;

/** 目标词量（A1–C1 全部）；进度条与「还要多少天」都以它为分母 */
export const SPRINT_TARGET = 5323;

export const DEFAULT_PREFS: Prefs = {
  pageSize: 20,
  defaultLevel: "A1",
  newPerDay: NEW_PER_DAY_MIN,
  reviewSize: DEFAULT_REVIEW_SIZE,
  quizSize: DEFAULT_QUIZ_SIZE,
  retention: 0.9,
  autoLockMinutes: 30,
  quizTypes: ["en2cn", "cn2en", "spell"],
};

/** 一次性迁移标记 + 锁屏数据（meta store，§4.3） */
export interface PinHash {
  salt: string;
  hash: string;
  iterations: number;
}

/**
 * 「已掌握」标记。
 * `at` 是标记时间：过了 MASTERY_COOLDOWN_DAYS 就回到复习队列抽查一次，
 * 所以这个按钮不是单程票（旧库里只有 key，用导入时间或 0 兜底）。
 */
export interface MasteryEntry {
  key: string;
  at: number;
}

export interface MetaState {
  lockEnabled: boolean;
  pinHash: PinHash | null;
  lockGraceUntil: number | null;
  /** setup 向导是否已完成 */
  setupDone: boolean;
  /** 旧 localStorage 是否已迁移 */
  migratedFromLocal: boolean;
  prefs: Prefs;
}

export const MEMORY_FALLBACK_NOTICE = "本次进度不会保存";

export const DB_NAME = "ox5000";
export const DB_VERSION = 1;

/** 旧版 localStorage 键名，保留作备份（§5 F4） */
export const LEGACY_MASTERED_KEY = "ox5000-mastered-v1";
