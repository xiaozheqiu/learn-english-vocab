/**
 * 复习队列、统计、连续打卡（§5 F2 / F5 / §6 lib/session.ts）
 * 纯函数：输入快照，输出计划，不碰存储。
 */
import { dayKey, nextDays, startOfDay } from "./date";
import { isDue, retrievability } from "./srs";
import {
  MASTERY_COOLDOWN_DAYS,
  type DayRecord,
  type Prefs,
  type SrsCardRecord,
  type Word,
} from "./types";

const COOLDOWN_MS = MASTERY_COOLDOWN_DAYS * 86_400_000;

/**
 * 单轮里最多放多少张**全新**的词。
 *
 * 不做每日配额，但一轮灌 300 个新词同样不合理：来不及记，也做不完。
 * 20 张大约是 3–5 分钟的节奏，做完想继续就再来一轮。
 */
export const NEW_BATCH = 20;

/**
 * 「已掌握」是否需要重新抽查。
 *
 * 旧版把 mastered 当成永久排除：点一次就再也不进任何队列，
 * 点错了（或当时只是眼熟）这个词就永远漏掉了 —— 和「长期记得」直接矛盾。
 * 现在按标记时间给一张免检期（MASTERY_COOLDOWN_DAYS，默认 30 天），
 * 到期后自动回到复习队列考一次；那次答对就重新发放。所以这个按钮是「降频」，不是「毕业」。
 */
export function masteryDueAt(at: number): number {
  return at + COOLDOWN_MS;
}

export function isMasteryRecheckDue(
  mastered: ReadonlyMap<string, number>,
  key: string,
  now: Date,
): boolean {
  const at = mastered.get(key);
  if (at === undefined) return false;
  return now.getTime() >= masteryDueAt(at);
}

/** 仍在免检期内的已掌握词：这些才是真正要排除的 */
export function isShelved(
  mastered: ReadonlyMap<string, number>,
  key: string,
  now: Date,
): boolean {
  const at = mastered.get(key);
  if (at === undefined) return false;
  return now.getTime() < masteryDueAt(at);
}

export interface ReviewItem {
  word: Word;
  record: SrsCardRecord | null;
  /** 当前可提取强度；新词为 0 */
  r: number;
  /** 逾期天数，排序次级键 */
  overdue: number;
  /**
   * 本轮补考标记：由复习会话在答错后追加时置 true。
   * 补考不再触发二次追加，否则一张反复答错的卡会把整轮拖住。
   */
  retry?: boolean;
}

export interface ReviewPlan {
  items: ReviewItem[];
  /** 队列中到期卡数量（截断前） */
  dueTotal: number;
  /** 队列中新词数量（截断前） */
  newTotal: number;
  /** 本次题量上限 */
  limit: number;
  /**
   * 本次装不下、留到明天的到期卡数。
   *
   * 每天 60 个新词时到期峰值能到 265 张，单次做不完全正常；断了几天更会攒起来。
   * 这部分不丢，但要让人看得见 —— 否则「慢慢处理」会变成「不知道欠了多少」。
   */
  carryOver: number;
}

export interface BuildPlanInput {
  words: readonly Word[];
  records: ReadonlyMap<string, SrsCardRecord>;
  /** key → 「已掌握」标记时间 */
  mastered: ReadonlyMap<string, number>;
  prefs: Pick<Prefs, "reviewSize" | "retention">;
  now?: Date;
}

/**
 * 队列构成：
 * 1. 取 due ≤ now 且未手动标记已掌握，按 R 升序（R 相同则逾期久的先）
 * 2. 再补「从未评分」的新词
 * 3. 按单轮题量（reviewSize）截断
 *
 * 新词没有每日配额，但也不是「一次灌满」：一轮里新词最多占
 * `NEW_BATCH` 张。原因是全灌会给出 300 张全新词 —— 一屏里全是从没见过的词，
 * 既做不完也记不住。给一批、做完再来一轮，节奏仍完全由用户决定。
 */
export function buildReviewPlan(input: BuildPlanInput): ReviewPlan {
  const now = input.now ?? new Date();
  const { records, mastered, prefs } = input;

  const due: ReviewItem[] = [];
  const fresh: ReviewItem[] = [];

  for (const word of input.words) {
    // 免检期内的已掌握词跳过；过了冷却期照常进队，考一次再续期
    if (isShelved(mastered, word.key, now)) continue;
    const record = records.get(word.key) ?? null;
    if (!record || record.reps <= 0) {
      // 已掌握但到期抽查的词算「到期」，其余算新词
      if (mastered.has(word.key)) {
        due.push({ word, record, r: 0, overdue: 0 });
        continue;
      }
      fresh.push({ word, record, r: 0, overdue: 0 });
      continue;
    }
    if (!isDue(record, now)) continue;
    const overdue = Math.max(0, Math.floor((now.getTime() - record.due) / 86_400_000));
    due.push({
      word,
      record,
      r: retrievability(record, now, prefs.retention),
      overdue,
    });
  }

  due.sort((a, b) => (a.r === b.r ? b.overdue - a.overdue : a.r - b.r));

  // 到期卡优先；新词每轮最多给一批，剩下的留到下一轮
  const limit = Math.max(1, prefs.reviewSize);
  const freshBatch = fresh.slice(0, Math.min(NEW_BATCH, limit));
  const merged = [...due, ...freshBatch];
  const items = merged.slice(0, limit);
  return {
    items,
    dueTotal: due.length,
    newTotal: Math.max(0, items.length - due.length),
    limit,
    carryOver: Math.max(0, merged.length - items.length),
  };
}

/* ── 统计（F5）────────────────────────────────────────────────── */

export interface Stats {
  todayReviewed: number;
  todayCorrect: number;
  /** 0–1，无作答时为 0 */
  todayAccuracy: number;
  streak: number;
  learned: number;
  masteryCount: number;
  /** 全库平均留存率，只算已评分的卡 */
  averageRetrievability: number;
  /** 未来 7 天（含今天）每天到期数 */
  forecast: { day: string; label: string; count: number }[];
  dueToday: number;
  newToday: number;
  /** 已掌握且仍在免检期内的词数（不重复算进 learned） */
  masteredInCooldown: number;
}

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export interface StatsInput {
  words: readonly Word[];
  records: ReadonlyMap<string, SrsCardRecord>;
  mastered: ReadonlyMap<string, number>;
  days: ReadonlyMap<string, DayRecord>;
  prefs: Pick<Prefs, "retention">;
  now?: Date;
}

export function computeStats(input: StatsInput): Stats {
  const now = input.now ?? new Date();
  const today = input.days.get(dayKey(now));

  /*
   * 一趟遍历算完所有按词聚合的量。
   *
   * 之前是 1 趟（learned / R）+ 1 趟（免检计数）+ 7 趟（未来 7 天预测），
   * 全库 5323 条时 9 趟。现在合并成一趟：把 7 天的区间边界先算好，
   * 每张卡按 due 落进对应桶。
   */
  const forecastDays = nextDays(7, now);
  const bounds = forecastDays.map((day) => {
    const date = new Date(`${day}T00:00:00`);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    return { day, label: day === dayKey(now) ? "今天" : WEEK_LABELS[date.getDay()] ?? "", start: date.getTime(), end: end.getTime() };
  });
  const counts = new Array<number>(bounds.length).fill(0);

  const scored: number[] = [];
  let learned = 0;
  let masteredInCooldown = 0;
  let dueToday = 0;
  const nowMs = now.getTime();

  for (const word of input.words) {
    const shelved = isShelved(input.mastered, word.key, now);
    if (shelved) {
      masteredInCooldown += 1;
      continue;
    }
    const record = input.records.get(word.key);
    if (record && record.reps > 0) {
      learned += 1;
      scored.push(retrievability(record, now, input.prefs.retention));
      if (record.due <= nowMs) dueToday += 1;
      for (let i = 0; i < bounds.length; i += 1) {
        const b = bounds[i]!;
        if (record.due >= b.start && record.due < b.end) {
          counts[i] = (counts[i] ?? 0) + 1;
          break;
        }
      }
      continue;
    }
    // 到期抽查的已掌握词也算「今天待复习」
    if (isMasteryRecheckDue(input.mastered, word.key, now)) dueToday += 1;
  }

  const forecast = bounds.map((b, i) => ({ day: b.day, label: b.label, count: counts[i] ?? 0 }));

  return {
    todayReviewed: today?.reviewed ?? 0,
    todayCorrect: today?.correct ?? 0,
    todayAccuracy:
      today && today.reviewed > 0 ? today.correct / today.reviewed : 0,
    streak: computeStreak(input.days, now),
    learned,
    masteryCount: input.mastered.size,
    averageRetrievability: scored.length
      ? scored.reduce((a, b) => a + b, 0) / scored.length
      : 0,
    forecast,
    dueToday,
    newToday: today?.newWords ?? 0,
    masteredInCooldown,
  };
}

/**
 * 连续打卡：从今天（或昨天，若今天还没学）往前数连续有作答的天数。
 * 今天没学但昨天学了，仍算「连续中」，不然一觉醒来就清零太反直觉。
 */
export function computeStreak(
  days: ReadonlyMap<string, DayRecord>,
  now: Date = new Date(),
): number {
  const active = (day: string) => {
    const record = days.get(day);
    return Boolean(record && record.reviewed > 0);
  };

  const cursor = startOfDay(now);
  if (!active(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!active(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (active(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
