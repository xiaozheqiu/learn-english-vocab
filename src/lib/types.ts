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
  /**
   * 口语词频学习顺序（1 起）。
   *
   * data/*.js 本身按字母序排，字母序会把 abandon / abolish / abrupt 这类
   * 抽象书面词顶到最前，背起来既无语境又互相干扰。这里用 ECDICT 的
   * frq/bnc 词频重排，A 档（前 2899）覆盖日常文本约 85%，先学完再碰书面词。
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
  /**
   * 词条级 CEFR（取首义 = 最常用义的难度）。空串 = 牛津未标。
   * 用于按难度筛词与「新词从易到难」的排序。
   */
  cefr: Cefr | "";
  /** 每个义项各自的 CEFR，与 cn 里的 `；` 分段一一对应；牛津未标处为空串 */
  senseCefr: readonly (Cefr | "")[];
  /** 牛津官方 Oxford 3000 / 5000 标记 */
  ox3000: boolean;
  ox5000: boolean;
}

/**
 * 牛津 CEFR 分级（义项级）。
 *
 * 与项目自身的 A1–C1 标签不是同一套口径：
 *   - 项目标签是「整词难度」，来自旧数据，一个词只有一个值
 *   - CEFR 是「义项难度」，同一个词的不同义项可以跨 4 级
 *     例：above 的「在上方」是 a1，「自视过高」是 c2
 * 调度按词条级 CEFR（取首义，即最常用义），义项级在复习卡上逐条显示。
 */
export type Cefr = "a1" | "a2" | "b1" | "b2" | "c1" | "c2";

export const CEFR_LEVELS: readonly Cefr[] = ["a1", "a2", "b1", "b2", "c1", "c2"];

/** CEFR 数值序，用于「按难度排序」与「取最易/最难义」 */
export const CEFR_RANK: Record<Cefr, number> = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };

export function isCefr(value: unknown): value is Cefr {
  return typeof value === "string" && (CEFR_LEVELS as readonly string[]).includes(value);
}

/** core 进入复习队列；extended 默认只在词表里可查，不占复习时间 */
export type Tier = "core" | "extended";

export const TIERS: readonly Tier[] = ["core", "extended"];

export const TIER_LABELS: Record<Tier, string> = {
  core: "日常",
  extended: "认脸",
};

/** 原始数据行：[单词, 词性, 中文释义, 3000/5000, 序号] */
export type RawRow = [string, string, string, string, (number | string | undefined)?];

export type MasteryFilter = "all" | "todo" | "done";

/** 状态左栏的语义分类（§1.5） */
export type StatusKind = "new" | "due" | "learning" | "solid" | "mastered" | "leech";

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
  /**
   * 是否把 extended 档（词频 >5000 / 无词频数据）也放进复习队列。
   *
   * 默认 false：这一档对听说几乎没有贡献，却要占 6–8 秒/张的复习成本。
   * 打开后行为与改版前一致（全库都进队列），用于「我要把 5323 条全过一遍」。
   */
  includeExtended: boolean;
  /**
   * 新词难度上限（CEFR）。空串 = 不限。
   *
   * 与「复习范围」是两件事：includeExtended 决定生僻词进不进队列，
   * cefrCap 决定多难的新词先进来。设为 b1 时，c1/c2 的新词暂时不出现，
   * 但已经在复习中的词照常按 FSRS 排期 —— 上限只管「新词发放」，不管旧词。
   */
  cefrCap: Cefr | "";
}

export type QuizType = "en2cn" | "cn2en" | "spell";

export const QUIZ_TYPES: readonly QuizType[] = ["en2cn", "cn2en", "spell"];

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

/**
 * 顽固词（leech）阈值：累计忘记这么多次就移出主复习队列。
 *
 * 为什么需要：FSRS 本身不会放弃任何一张卡 —— 一张反复忘记的卡会被反复排到
 * 「明天」，每天都要花 6–8 秒过一遍却始终记不住。实测把 above/stake 这类
 * 抽象词反复忘 8 次是很常见的，它们会长期占据队列头部的到期位。
 *
 * 8 次是权衡：低于 8 会误伤「只是刚开始记」的新词（前几次忘记是正常的），
 * 高于 8 则一张卡在队列里滞留过久。移出后不是删除 —— 见 LEECH_REVIEW_DAYS。
 */
export const LEECH_THRESHOLD = 8;

/**
 * 顽固词回归主队列的冷却期（天）。
 *
 * 移出后并不永久放弃：过 30 天自动回来考一次，考过就恢复正常排期。
 * 这条与「已掌握」的冷却期同一思路 —— 都是「降频」而不是「毕业」，
 * 避免因为某个阶段状态差就把一个词永久判死。
 */
export const LEECH_COOLDOWN_DAYS = 30;

export const DEFAULT_PREFS: Prefs = {
  pageSize: 20,
  defaultLevel: "A1",
  reviewSize: DEFAULT_REVIEW_SIZE,
  quizSize: DEFAULT_QUIZ_SIZE,
  retention: 0.9,
  autoLockMinutes: 30,
  quizTypes: ["en2cn", "cn2en", "spell"],
  includeExtended: false,
  cefrCap: "",
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
