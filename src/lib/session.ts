/**
 * 复习队列、统计、连续打卡（§5 F2 / F5 / §6 lib/session.ts）
 * 纯函数：输入快照，输出计划，不碰存储。
 */
import { dayKey, nextDays, startOfDay } from "./date";
import { isDue, isLeech, isShelvedAsLeech, retrievability } from "./srs";
import {
  CEFR_RANK,
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
export function isShelved(mastered: ReadonlyMap<string, number>, key: string, now: Date): boolean {
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
  prefs: Pick<Prefs, "reviewSize" | "retention" | "includeExtended" | "cefrCap">;
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
  const includeExtended = prefs.includeExtended === true;
  /*
   * CEFR 上限：只给「不超过这个难度」的新词。
   *
   * 空串 = 不限。分级来自牛津义项级标注，是最可靠的难度信号：
   * 同一个词的不同义项能跨 4 级（above: a1 的「在上方」到 c2 的「自视过高」），
   * 整词标签做不到这点。用它排序比按词频排序更贴近「读得懂、用得上」。
   */
  const cefrCap = prefs.cefrCap ?? "";

  const due: ReviewItem[] = [];
  const fresh: ReviewItem[] = [];

  for (const word of input.words) {
    // 免检期内的已掌握词跳过；过了冷却期照常进队，考一次再续期
    if (isShelved(mastered, word.key, now)) continue;
    /*
     * extended 档不进复习队列。
     *
     * 这一档是「词频 >5000 或词典无数据」的词 —— genocide/asylum/notwithstanding
     * 这类，对听懂日常对话的边际收益接近零，却要占 6–8 秒/张的复习成本。
     * 它们仍然留在词表里可查、可手动加回队列（见 prefs.includeExtended）。
     */
    if (word.tier === "extended" && !includeExtended) continue;
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
    /*
     * 顽固词挡在主队列外（冷却期内）。
     * 这是本应用唯一「主动放弃」某张卡的机制，理由见 LEECH_THRESHOLD 的注释：
     * 反复忘记的词每天占 6–8 秒却始终记不住，会把整轮复习拖成消耗战。
     * 冷却结束后 isShelvedAsLeech 返回 false，它会自己回来考一次。
     */
    if (isShelvedAsLeech(record, now)) continue;
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
  /*
   * 新词按口语词频顺序取，不按数据原始顺序。
   *
   * 数据文件是字母序，直接 slice 会先把 abandon / abolish / abrupt 这批
   * 抽象书面词灌给用户 —— 它们互相干扰强、口语里几乎不出现，背了也用不上。
   * rank 由 scripts/gen-tiers.py 按 ECDICT 词频生成，A 档（前 2899）覆盖
   * 日常文本约 85%。rank 为 0（分档文件缺失）的排到最后，退化为原顺序。
   */
  /*
   * 新词排序：先按 CEFR 难度，再按口语词频。
   *
   * 只按词频排的问题：the / be / of 固然最高频，但它们的 CEFR 是 a1，
   * 而 frequency 排到第 3000 位的词可能已经是 c1 —— 两个信号回答的问题不同。
   * CEFR 回答「这个词有多难」，词频回答「这个词多常用」。先难后常用，
   * 保证你在任何时候打开，最先遇到的是「又常用又不难」的词。
   * 牛津未标分级（空串）的排在有分级的之后，但仍早于 extended 档。
   */
  const cefrRank = (word: { cefr: string }) =>
    word.cefr ? CEFR_RANK[word.cefr as keyof typeof CEFR_RANK] : 99;
  fresh.sort((a, b) => {
    const ca = cefrRank(a.word);
    const cb = cefrRank(b.word);
    if (ca !== cb) return ca - cb;
    const ra = a.word.rank || Number.MAX_SAFE_INTEGER;
    const rb = b.word.rank || Number.MAX_SAFE_INTEGER;
    return ra === rb ? a.word.key.localeCompare(b.word.key) : ra - rb;
  });
  // 难度上限：超过 cap 的新词这一轮先不给（不是删除，仍在池子里）
  const capped = cefrCap
    ? fresh.filter((item) => cefrRank(item.word) <= CEFR_RANK[cefrCap])
    : fresh;
  const freshBatch = capped.slice(0, Math.min(NEW_BATCH, limit));
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
  /** 日常档词数（进复习队列的那部分） */
  coreTotal: number;
  /** 认脸档词数（默认不进复习队列） */
  extendedTotal: number;
  /** 日常档里已学过的条数，用于真实进度条 */
  coreLearned: number;
  /** 顽固词总数（累计忘记 ≥ LEECH_THRESHOLD） */
  leechCount: number;
  /** 其中正被挡在主队列外的（冷却期内） */
  leechShelved: number;
}

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export interface StatsInput {
  words: readonly Word[];
  records: ReadonlyMap<string, SrsCardRecord>;
  mastered: ReadonlyMap<string, number>;
  days: ReadonlyMap<string, DayRecord>;
  prefs: Pick<Prefs, "retention" | "includeExtended">;
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
    return {
      day,
      label: day === dayKey(now) ? "今天" : (WEEK_LABELS[date.getDay()] ?? ""),
      start: date.getTime(),
      end: end.getTime(),
    };
  });
  const counts = new Array<number>(bounds.length).fill(0);

  const scored: number[] = [];
  let learned = 0;
  let masteredInCooldown = 0;
  let dueToday = 0;
  let coreTotal = 0;
  let extendedTotal = 0;
  let coreLearned = 0;
  let leechCount = 0;
  let leechShelved = 0;
  // 口径与 buildReviewPlan 保持一致：extended 档在不开启时压根不进队列
  const includeExtended = (input.prefs as { includeExtended?: boolean }).includeExtended === true;
  const nowMs = now.getTime();

  for (const word of input.words) {
    const shelved = isShelved(input.mastered, word.key, now);
    if (shelved) {
      masteredInCooldown += 1;
      continue;
    }
    if (word.tier === "extended") {
      extendedTotal += 1;
      // extended 档默认不进复习队列（见 buildReviewPlan），因此也不该计入到期数
      if (!includeExtended) continue;
    } else coreTotal += 1;
    const record = input.records.get(word.key);
    if (record && record.reps > 0) {
      learned += 1;
      if (word.tier !== "extended") coreLearned += 1;
      if (isLeech(record)) leechCount += 1;
      /*
       * 被 leech 挡住的词不计入「今天到期」，也不能进预测柱。
       *
       * 否则底部导航会显示「待复习 3」，点进去队列里只有 1 个 ——
       * 用户会以为复习页丢了词。这个数字必须与 buildReviewPlan 的口径一致：
       * 凡是不进队列的，都不该在「今天待复习」里出现。
       */
      const blocked = isShelvedAsLeech(record, now);
      if (blocked) {
        leechShelved += 1;
        continue;
      }
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
    todayAccuracy: today && today.reviewed > 0 ? today.correct / today.reviewed : 0,
    streak: computeStreak(input.days, now),
    learned,
    masteryCount: input.mastered.size,
    averageRetrievability: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0,
    forecast,
    dueToday,
    newToday: today?.newWords ?? 0,
    masteredInCooldown,
    coreTotal,
    extendedTotal,
    coreLearned,
    leechCount,
    leechShelved,
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
