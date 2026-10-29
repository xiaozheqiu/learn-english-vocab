/** 本地时区日期工具（§6 lib/date.ts） */

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
