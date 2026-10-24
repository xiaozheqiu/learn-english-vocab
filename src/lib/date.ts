/** 本地时区日期工具（§6 lib/date.ts） */

export const DAY_MS = 86_400_000;

export type DateInput = Date | number | string;

export function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** 本地日期键 YYYY-MM-DD（不做 UTC 换算，跨时区不会串天） */
export function dayKey(value: DateInput = new Date()): string {
  const d = toDate(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 本地当天 00:00 */
export function startOfDay(value: DateInput = new Date()): Date {
  const d = toDate(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** 两个时刻相差的自然天数（按本地日历，不是 24h 整除） */
export function diffDays(from: DateInput, to: DateInput = new Date()): number {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  return Math.round((b - a) / DAY_MS);
}

/** 完整天数差（毫秒直除，用于逾期判定） */
export function elapsedDays(from: DateInput, to: DateInput = new Date()): number {
  const delta = toDate(to).getTime() - toDate(from).getTime();
  return Math.max(0, Math.floor(delta / DAY_MS));
}

/** 按本地日历加天数，时分秒保持不变（跨月、跨夏令时由 Date 自己处理） */
export function addDays(value: DateInput, days: number): Date {
  const d = toDate(value);
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * 间隔的人类读法：「今天到期」「逾期 3 天」「2 天后」「3 个月后」。
 * §1.5 的标签体系：>= 21 天用月/年，避免出现「87 天后」这种读不出量的说法。
 */
export function formatInterval(due: DateInput, now: DateInput = new Date()): string {
  const dueMs = toDate(due).getTime();
  const nowMs = toDate(now).getTime();
  const days = Math.ceil((dueMs - nowMs) / DAY_MS);

  if (days <= 0) {
    const overdue = Math.floor((nowMs - dueMs) / DAY_MS);
    if (overdue < 1) return "今天到期";
    return `逾期 ${overdue} 天`;
  }
  if (days === 1) return "明天";
  if (days < 21) return `${days} 天后`;
  if (days < 60) return "1 个月后";
  if (days < 365) return `${Math.round(days / 30)} 个月后`;
  const years = days / 365;
  return years < 2 ? "1 年后" : `${Math.round(years)} 年后`;
}

/** 评分按钮上印的间隔：「1 天」「3 天」「3 个月」 */
export function formatScheduledDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "<1 天";
  if (days === 1) return "1 天";
  if (days < 21) return `${Math.round(days)} 天`;
  if (days < 60) return "1 个月";
  if (days < 365) return `${Math.round(days / 30)} 个月`;
  const years = days / 365;
  return years < 2 ? "1 年" : `${Math.round(years)} 年`;
}

/** 未来 n 天的本地日期键，用于 7 天到期柱 */
export function nextDays(count: number, from: DateInput = new Date()): string[] {
  const base = startOfDay(from);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    out.push(dayKey(d));
  }
  return out;
}
