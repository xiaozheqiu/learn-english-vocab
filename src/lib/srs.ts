/**
 * FSRS 封装（§5 F2 / §6 lib/srs.ts）
 *
 * 口径：ts-fsrs 5.4.2、FSRS-5 默认权重、本地计算。
 * enable_short_term=false —— 背单词是日粒度，不要 1 分钟/10 分钟的当日循环。
 */
import {
  fsrs,
  createEmptyCard,
  generatorParameters,
  State,
  type Card,
  type RecordLogItem,
} from "ts-fsrs";
import { DAY_MS, elapsedDays, formatScheduledDays } from "./date";
import type { SrsCardRecord, StatusInfo } from "./types";

/** FSRS-5 默认权重（19 个）。ts-fsrs 会自动补齐到 21 个（FSRS-6 兼容）。 */
export const FSRS5_DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
] as const;

/**
 * 单张卡的最长间隔。
 *
 * 压到 90 天是为了「长期记住」而不是为了冲刺：FSRS 对「一直很熟」的卡会排到
 * 1252 天，那等于这个词三年多不再被验证。上限 90 天保证任何词至少每季度
 * 见一次面。要更宽松可以调回 365，代价是长期记忆的稳定性下降。
 */
export const MAX_INTERVAL = 90;
export const DEFAULT_RETENTION = 0.9;
export const RATING_LABELS = ["忘记", "模糊", "记得", "很熟"] as const;
export type Grade = 1 | 2 | 3 | 4;

export const GRADES: readonly Grade[] = [1, 2, 3, 4];

const cache = new Map<string, ReturnType<typeof fsrs>>();

/** 按 retention 缓存实例：留存率可调，换参数就换实例 */
export function scheduler(retention: number = DEFAULT_RETENTION) {
  const rounded = Math.min(0.95, Math.max(0.8, retention));
  const k = rounded.toFixed(2);
  const hit = cache.get(k);
  if (hit) return hit;
  const params = generatorParameters({
    request_retention: rounded,
    maximum_interval: MAX_INTERVAL,
    enable_short_term: false,
    enable_fuzz: false,
    w: FSRS5_DEFAULT_W,
  });
  const instance = fsrs(params);
  cache.set(k, instance);
  return instance;
}

type FsrsGrade = Parameters<ReturnType<typeof fsrs>["next"]>[2];

/** 本地 1–4 → ts-fsrs 的 Grade（Again/Hard/Good/Easy，不含 Manual） */
function toFsrsGrade(grade: Grade): FsrsGrade {
  return grade as unknown as FsrsGrade;
}

/* ── 序列化：Date ⇄ epoch ms ─────────────────────────────────── */

export function newCardRecord(key: string, now: Date = new Date()): SrsCardRecord {
  const card = createEmptyCard(now);
  return {
    key,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: 0,
    lapses: 0,
    state: 0,
    right: 0,
    wrong: 0,
  };
}

export function toFsrsCard(record: SrsCardRecord): Card {
  return {
    due: new Date(record.due),
    stability: record.stability,
    difficulty: record.difficulty,
    elapsed_days: record.elapsed_days,
    scheduled_days: record.scheduled_days,
    learning_steps: record.learning_steps,
    reps: record.reps,
    lapses: record.lapses,
    state: record.state as State,
    ...(record.last_review ? { last_review: new Date(record.last_review) } : {}),
  };
}

export function mergeRecord(record: SrsCardRecord, card: Card): SrsCardRecord {
  return {
    ...record,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as SrsCardRecord["state"],
    ...(card.last_review ? { last_review: card.last_review.getTime() } : {}),
  };
}

/* ── 核心运算 ─────────────────────────────────────────────────── */

/** 四档预览：每档的卡片与间隔，用于「按钮上直接印下次间隔」 */
export interface GradePreview {
  grade: Grade;
  label: string;
  /** 排期天数（按天取整，与提交后实际 due 一致） */
  days: number;
  /** 印在按钮上的文案 */
  text: string;
  item: RecordLogItem;
}

export function previewGrades(
  record: SrsCardRecord | null,
  now: Date = new Date(),
  retention: number = DEFAULT_RETENTION,
): GradePreview[] {
  const f = scheduler(retention);
  const card = record ? toFsrsCard(record) : createEmptyCard(now);
  const log = f.repeat(card, now) as Record<1 | 2 | 3 | 4, RecordLogItem>;
  return GRADES.map((grade) => {
    const raw = log[grade];
    // 与 applyGrade 同一套收敛规则，保证「所见即所得」
    const item: RecordLogItem = { ...raw, card: normalizeDue(raw.card, grade, now) };
    const days = scheduledDaysFrom(item.card, now);
    return {
      grade,
      label: RATING_LABELS[grade - 1]!,
      days,
      text: formatScheduledDays(days),
      item,
    };
  });
}

/**
 * 实际排期天数。
 * ts-fsrs 在 enable_short_term=false 时给出整日间隔，但仍按毫秒对齐 due；
 * 用 ceil 向上取整，保证「按钮印 3 天」⇒「3 天后到期」不会提前一天出现。
 */
export function scheduledDaysFrom(card: Card, now: Date): number {
  const delta = card.due.getTime() - now.getTime();
  if (delta <= 0) return 0;
  return Math.max(1, Math.ceil(delta / DAY_MS));
}

/**
 * 排期收敛（§9 验收 6 / 4）：
 * - again 必须回到 1 天内。enable_short_term=false 时 ts-fsrs 会把「答错」按新
 *   stability 排到十几天后，与产品口径（忘记 = 明天再来）冲突，这里按日粒度夹到 1 天。
 * - 任何一档都不得超过 maximum_interval；ts-fsrs 内部按毫秒差算天数，跨夏令时会多出 1–2 天。
 */
function normalizeDue(card: Card, grade: Grade, now: Date): Card {
  const oneDay = now.getTime() + DAY_MS;
  const cap = now.getTime() + MAX_INTERVAL * DAY_MS;
  const wanted = grade === 1 ? Math.min(card.due.getTime(), oneDay) : card.due.getTime();
  const due = Math.min(Math.max(wanted, now.getTime() + 1000), cap);
  // scheduled_days 同步收敛，保证记录、排序、状态栏三处读同一个数
  return { ...card, due: new Date(due), scheduled_days: Math.ceil((due - now.getTime()) / DAY_MS) };
}

/** 提交一次评分，返回新记录（不改入参） */
export function applyGrade(
  record: SrsCardRecord | null,
  grade: Grade,
  now: Date = new Date(),
  retention: number = DEFAULT_RETENTION,
): { record: SrsCardRecord; before: SrsCardRecord | null; days: number } {
  const f = scheduler(retention);
  const card = record ? toFsrsCard(record) : createEmptyCard(now);
  const { card: raw } = f.next(card, now, toFsrsGrade(grade));
  const nextCard = normalizeDue(raw, grade, now);
  const base = record ?? newCardRecord("", now);
  const merged = mergeRecord(base, nextCard);
  return {
    record: merged,
    before: record,
    days: scheduledDaysFrom(nextCard, now),
  };
}

/* ── 可提取强度：闭式公式（性能关键路径）─────────────────────────
 *
 * `computeStats` 每次 store 变化都要遍历全库 5323 张卡，而 ts-fsrs 的
 * `get_retrievability` 每张卡都要 TypeConvert.card 造一个完整 Card 对象 +
 * 建 Date，实测 5323 次约 2.5ms，占整个统计耗时的 2/3。
 *
 * FSRS 的遗忘曲线本身是闭式的（decay = w[20]，本项目固定 0.5）：
 *   R(t, S) = (1 + factor · t / S) ^ (−decay)
 *   factor  = exp(−ln(0.9) / decay) − 1        （与 ts-fsrs 的 computeDecayFactor 同式）
 * 这里直接算公式，省掉对象构造。正确性由 srs.test.ts 对库实现做逐值交叉校验。
 */
const FORGETTING_DECAY = 0.5;
/** 与 ts-fsrs `computeDecayFactor` 一致：exp(pow(-0.5, -1) * ln0.9) - 1 */
const FORGETTING_FACTOR = Number(
  (Math.exp((-1 / FORGETTING_DECAY) * Math.log(0.9)) - 1).toFixed(8),
);

/** 当前可提取强度 R（0–1）。未评分的新词按 0 处理 */
export function retrievability(
  record: SrsCardRecord,
  now: Date = new Date(),
  _retention: number = DEFAULT_RETENTION,
): number {
  if (record.reps <= 0 || record.stability <= 0) return 0;
  // 导入的历史记录可能缺 last_review，用 due - scheduled_days 反推
  const lastReview = record.last_review ?? record.due - record.scheduled_days * DAY_MS;
  // ts-fsrs 用 floor(天差)，且负数夹到 0
  const elapsed = Math.max(0, Math.floor((now.getTime() - lastReview) / DAY_MS));
  const r = Math.pow(1 + (FORGETTING_FACTOR * elapsed) / record.stability, -FORGETTING_DECAY);
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
}

/** 是否到期 */
export function isDue(record: SrsCardRecord, now: Date = new Date()): boolean {
  return record.reps > 0 && record.due <= now.getTime();
}

/** 状态左栏分类（§1.5） */
export function statusOf(
  record: SrsCardRecord | null,
  mastered: boolean,
  now: Date = new Date(),
): StatusInfo {
  if (mastered) {
    return { kind: "mastered", label: "已掌握", rail: "rail-mastered" };
  }
  if (!record || record.reps <= 0) {
    return { kind: "new", label: "", rail: "" };
  }
  const label = formatIntervalFromRecord(record, now);
  if (record.due <= now.getTime()) {
    return { kind: "due", label, rail: "rail-due" };
  }
  if (record.scheduled_days >= 21) {
    return { kind: "solid", label, rail: "rail-solid" };
  }
  return { kind: "learning", label, rail: "rail-learning" };
}

function formatIntervalFromRecord(record: SrsCardRecord, now: Date): string {
  const due = record.due;
  const nowMs = now.getTime();
  const days = Math.ceil((due - nowMs) / DAY_MS);
  if (days <= 0) {
    const overdue = Math.floor((nowMs - due) / DAY_MS);
    return overdue < 1 ? "今天到期" : `逾期 ${overdue} 天`;
  }
  if (days === 1) return "明天";
  if (days < 21) return `${days} 天后`;
  if (days < 60) return "1 个月后";
  if (days < 365) return `${Math.round(days / 30)} 个月后`;
  const years = days / 365;
  return years < 2 ? "1 年后" : `${Math.round(years)} 年`;
}

/** 遗忘天数（用于 overdue 排序） */
export function overdueDays(record: SrsCardRecord, now: Date = new Date()): number {
  if (record.due > now.getTime()) return 0;
  return elapsedDays(record.due, now);
}
