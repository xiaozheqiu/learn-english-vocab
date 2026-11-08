/**
 * 中→英 自测：出题、判分、本轮统计。
 *
 * ## 为什么是「中→英」而不是选择题
 *
 * 四选一即使完全不认识也有 25% 蒙对，而蒙对和记住在数据上分不开 ——
 * 用它当「学得怎么样」的尺子，量出来的是运气。中文给出、英文自己敲，
 * 蒙不出来，对错是硬信号。
 *
 * ## 这一版不落库
 *
 * 只出「本轮结果 + 错词清单」，不写 IndexedDB、不加 store、不排期。
 * 理由：还没人连续用过它，现在设计一套复习算法等于猜需求。
 * 等真用上一段时间、想看的曲线稳定了，再加记录表 —— 那时才知道要存什么。
 *
 * 错词的处理复用现成语义：交回给调用方去 `toggleMastery(key, false)`，
 * 于是「答错的词回到未掌握」这件事不需要新概念，也就自然回到待背队列里。
 */
import type { Word } from "./types";

/** 一题 */
export interface DrillQuestion {
  key: string;
  /** 题面：中文释义 */
  prompt: string;
  /** 答案：英文原词（可能含 `a, an` 这种并列写法） */
  answer: string;
  /** 可接受的写法（归一化后） */
  accepted: readonly string[];
  /** 词性，揭晓时一并给出，避免背成「另一种词性的那个词」 */
  pos: string;
}

/**
 * 判定一次作答。
 *
 * 归一化只做「不该因为这些判错」的那几样：大小写、首尾空白、内部多余空格、
 * 尾随标点。**不做**任何拼写纠错 —— 「差不多对」正是要抓出来的东西。
 */
export function judgeSpelling(answer: string, given: string): boolean {
  const want = normalize(answer);
  const got = normalize(given);
  return got.length > 0 && got === want;
}

/** 去掉大小写、标点、内部多余空格 */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,;:!?'"’”“()[\]-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 词条的可接受写法。
 *
 * `a, an` 是冠词的两个书写变体并列，任一个都算对；`ice cream` 这种含空格的
 * 短语要整体也接受。切分只按 `,` `/` `;`，不按空格 —— 按空格切会把短语拆散。
 */
export function acceptedSpellings(word: string): string[] {
  const out = new Set<string>();
  const cleaned = word.replace(/\([^)]*\)/g, " ").trim();
  for (const part of cleaned.split(/\s*[,/;]\s*/)) {
    const norm = normalize(part);
    if (norm) out.add(norm);
  }
  const whole = normalize(cleaned);
  if (whole) out.add(whole);
  return [...out];
}

/**
 * 出题范围：只挑「有释义的」词。
 *
 * 没有释义就没法出中→英（题面是中文），这种词在自测里直接跳过，
 * 而不是出一题空题干让人茫然的题。
 */
export interface DrillInput {
  words: readonly Word[];
  /** key → 中文释义 */
  glosses: ReadonlyMap<string, string>;
  /**
   * 排除这些 key（通常是「只测未掌握」时把已掌握的排除掉）。
   *
   * 只要求 `has`，不要求完整的 Set：调用方手里往往是 `Map<key, 标记时间>`，
   * 为了传参再 `new Set(...)` 一次纯属白拷贝。
   */
  exclude?: { has(key: string): boolean };
  /** 题目数量上限 */
  limit: number;
  /** 随机种子：同一颗种子出同一套题，结果可复现 */
  seed: number;
}

/**
 * 组一套题。
 *
 * 用「key + 种子」哈希排序后再截断，而不是直接洗整个数组：
 * 这样同一颗种子下题目顺序完全确定，`judgeSpelling` 的判定也可以在测试里
 * 用固定输入复现 —— 与 listView 的 `applyOrder` 是同一套做法。
 */
export function buildDrill({ words, glosses, exclude, limit, seed }: DrillInput): DrillQuestion[] {
  const pool: DrillQuestion[] = [];
  for (const word of words) {
    if (exclude?.has(word.key)) continue;
    const gloss = glosses.get(word.key)?.trim();
    if (!gloss) continue;
    pool.push({
      key: word.key,
      prompt: gloss,
      answer: word.word,
      accepted: acceptedSpellings(word.word),
      pos: word.pos,
    });
  }
  return pool
    .map((question) => ({ question, rank: shuffleRank(question.key, seed) }))
    .sort((a, b) =>
      a.rank !== b.rank ? a.rank - b.rank : a.question.key < b.question.key ? -1 : 1,
    )
    .slice(0, Math.max(0, limit))
    .map((item) => item.question);
}

/** FNV-1a 混种子后折成 0–1；与 listView.shuffleRank 同一条公式 */
function shuffleRank(key: string, seed: number): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/** 一次作答记录 */
export interface DrillAnswer {
  key: string;
  prompt: string;
  answer: string;
  /** 用户敲的原文（保留原样，结果页要照原样显示） */
  given: string;
  correct: boolean;
}

/**
 * 本轮统计。
 *
 * 只报两个数：对了多少、错了哪些。**故意不报「正确率百分比」之外的花哨指标**
 * —— 一次二十题的样本，百分比精确到整数已经是它的上限，多给一位小数是假精度。
 */
export interface DrillSummary {
  total: number;
  correct: number;
  wrong: DrillAnswer[];
}

export function summarize(answers: readonly DrillAnswer[]): DrillSummary {
  const wrong = answers.filter((answer) => !answer.correct);
  return { total: answers.length, correct: answers.length - wrong.length, wrong };
}
