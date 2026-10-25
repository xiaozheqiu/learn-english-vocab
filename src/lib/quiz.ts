/**
 * 抽题权重、加权抽样、判分（§5 F3 / §6 lib/quiz.ts）
 *
 * 抽样用 Efraimidis–Spirakis 加权无放回：key = rng^(1/w) 取最大 N 个。
 * 接受种子 ⇒ 可复现、可单测。
 */
import { acceptedSpellings, normalizeSpelling, posTags, primaryMeaning } from "./words";
import type { QuizType, SrsCardRecord, Word } from "./types";

export const TYPE_COEFFICIENT: Record<QuizType, number> = {
  en2cn: 1.0,
  cn2en: 1.1,
  spell: 1.25,
};

/**
 * w = (0.6 + 2.6 × 错误率) / √(1 + 作答次数 / 8) × 题型系数
 * 从未测过：w = 2 × 题型系数
 */
export function questionWeight(
  record: Pick<SrsCardRecord, "right" | "wrong"> | null,
  type: QuizType,
): number {
  const coef = TYPE_COEFFICIENT[type];
  if (!record || record.right + record.wrong === 0) return 2 * coef;
  const attempts = record.right + record.wrong;
  const errorRate = record.wrong / attempts;
  return ((0.6 + 2.6 * errorRate) / Math.sqrt(1 + attempts / 8)) * coef;
}

/* ── 可复现随机 ───────────────────────────────────────────────── */

/** 字符串 → 32bit 种子（FNV-1a） */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：同种子同序列 */
export function makeRng(seed: string | number): () => number {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Efraimidis–Spirakis 加权无放回抽样。
 * 权重越大越容易被选中；返回顺序即 rng 抽出的结果（调用方可再排序）。
 */
export function weightedSample<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  count: number,
  rng: () => number,
): T[] {
  if (count <= 0 || items.length === 0) return [];
  const keyed = items.map((item) => {
    const w = Math.max(weightOf(item), 1e-6);
    return { item, key: Math.pow(rng(), 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, Math.min(count, keyed.length)).map((entry) => entry.item);
}

/* ── 题目生成 ─────────────────────────────────────────────────── */

export type QuizDirection = QuizType;

export interface QuizQuestion {
  key: string;
  word: Word;
  type: QuizType;
  /** 题面 */
  prompt: string;
  /** 题面副标题（拼写题给词性；选择题给提示） */
  hint: string;
  /** 选择题选项，已洗牌 */
  choices: string[];
  /** 正确答案（选项原文 / 拼写原文） */
  answer: string;
  /** 拼写题可接受的写法（已归一化） */
  accepted: string[];
}

export interface BuildQuizOptions {
  words: readonly Word[];
  records: ReadonlyMap<string, SrsCardRecord>;
  seed: string | number;
  size: number;
  types: readonly QuizType[];
  /** 干扰项候选池，默认用 words */
  pool?: readonly Word[];
  /** 只练错题：给定 key 白名单 */
  only?: readonly string[];
}

/** 从池子里挑 3 个干扰项：同等级+同词性 → 同等级 → 跨等级，且不与他人同义 */
export function pickDistractors(
  answer: Word,
  pool: readonly Word[],
  want: number,
  rng: () => number,
  field: "cn" | "word",
): string[] {
  const answerText = normalizeSpelling(field === "cn" ? primaryMeaning(answer.cn) : answer.word);
  const tiers: Word[][] = [[], [], []];
  for (const candidate of pool) {
    if (candidate.key === answer.key) continue;
    const text = normalizeSpelling(field === "cn" ? primaryMeaning(candidate.cn) : candidate.word);
    // 去重：避免两个选项同义 / 同词
    if (!text || text === answerText) continue;
    const sameLevel = candidate.level === answer.level;
    if (sameLevel && sharesPos(answer, candidate)) tiers[0]!.push(candidate);
    else if (sameLevel) tiers[1]!.push(candidate);
    else tiers[2]!.push(candidate);
  }

  const chosen: Word[] = [];
  const usedText = new Set<string>([answerText]);
  for (const tier of tiers) {
    if (chosen.length >= want) break;
    // 在档内随机取，但不打乱全局可复现性：按 rng 排序后顺序取
    const shuffled = tier
      .map((w) => ({ w, r: rng() }))
      .sort((a, b) => a.r - b.r)
      .map((entry) => entry.w);
    for (const candidate of shuffled) {
      if (chosen.length >= want) break;
      const text = normalizeSpelling(
        field === "cn" ? primaryMeaning(candidate.cn) : candidate.word,
      );
      if (usedText.has(text)) continue;
      usedText.add(text);
      chosen.push(candidate);
    }
  }
  return chosen.map((w) => (field === "cn" ? displayMeaning(w.cn) : w.word));
}

function sharesPos(a: Word, b: Word): boolean {
  const left = new Set(posTags(a.pos));
  return posTags(b.pos).some((tag) => left.has(tag));
}

function displayMeaning(cn: string): string {
  return primaryMeaning(cn);
}

export function buildQuiz(options: BuildQuizOptions): QuizQuestion[] {
  const { words, records, seed, size, types } = options;
  const pool = options.pool ?? words;
  if (size <= 0 || types.length === 0 || words.length === 0) return [];

  const rng = makeRng(seed);
  const allowed = options.only ? new Set(options.only) : null;
  const candidates = allowed ? words.filter((w) => allowed.has(w.key)) : [...words];
  if (candidates.length === 0) return [];

  // 每个词随机指派一种启用的题型，再按该题型权重抽样
  const typed = candidates.map((word) => {
    const type = types[Math.floor(rng() * types.length) % types.length]!;
    return { word, type };
  });

  const picked = weightedSample(
    typed,
    (entry) => questionWeight(records.get(entry.word.key) ?? null, entry.type),
    size,
    rng,
  );

  return picked.map((entry) => makeQuestion(entry.word, entry.type, pool, rng));
}

function makeQuestion(
  word: Word,
  type: QuizType,
  pool: readonly Word[],
  rng: () => number,
): QuizQuestion {
  if (type === "spell") {
    return {
      key: word.key,
      word,
      type,
      prompt: displayMeaning(word.cn),
      hint: word.pos,
      choices: [],
      answer: word.word,
      accepted: acceptedSpellings(word.word),
    };
  }

  const byChinese = type === "en2cn";
  const answer = byChinese ? displayMeaning(word.cn) : word.word;
  const distractors = pickDistractors(word, pool, 3, rng, byChinese ? "cn" : "word");
  const choices = shuffle([answer, ...distractors], rng);
  return {
    key: word.key,
    word,
    type,
    prompt: byChinese ? word.word : displayMeaning(word.cn),
    hint: word.pos,
    choices,
    answer,
    accepted: [],
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/* ── 判分 ─────────────────────────────────────────────────────── */

export interface Judgement {
  correct: boolean;
  /** 用过提示或第二次才答对 */
  hinted: boolean;
  /** 写错的具体输入，便于结果页展示 */
  given: string;
}

export function judgeChoice(question: QuizQuestion, given: string): Judgement {
  return {
    correct: normalizeSpelling(given) === normalizeSpelling(question.answer),
    hinted: false,
    given,
  };
}

export function judgeSpelling(question: QuizQuestion, given: string): Judgement {
  const norm = normalizeSpelling(given);
  return {
    correct: norm.length > 0 && question.accepted.includes(norm),
    hinted: false,
    given,
  };
}

export function judge(question: QuizQuestion, given: string): Judgement {
  return question.type === "spell" ? judgeSpelling(question, given) : judgeChoice(question, given);
}

/**
 * 测试也是学习：把作答映射回 FSRS 评分档（§5 F3 回写 FSRS）。
 *
 * 关键口径：**选择题答对最多记 hard(2)，绝不记 good/easy。**
 *
 * 四选一即使完全不认识也有 25% 蒙对；把蒙对当「记住」会让 FSRS 把卡片
 * 排到几周后，而其实记忆根本没形成。实测三种题型各占 1/3 时，
 * 约 2/3 的复习信号都带这个假阳性。
 * 只有输出型（中→英、拼写）一次答对才算真的记住了。
 *
 *   选择题答对            → hard(2)   有提示/二次才对 → hard(2)
 *   中→英 一次答对         → good(3)
 *   拼写 一次答对          → easy(4)
 *   任何题型答错           → again(1)
 */
export function gradeFromQuiz(
  question: QuizQuestion,
  judgement: Judgement,
  attempts: number,
): 1 | 2 | 3 | 4 {
  if (!judgement.correct) return 1;
  if (judgement.hinted || attempts > 1) return 2;
  if (question.type === "spell") return 4;
  if (question.type === "cn2en") return 3;
  // en2cn：认出中文释义 ≠ 能想起英文，蒙对概率也最高，只给 hard
  return 2;
}
