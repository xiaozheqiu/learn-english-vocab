import { describe, expect, it } from "vitest";
import {
  applyGrade,
  isDue,
  newCardRecord,
  previewGrades,
  retrievability,
  scheduler,
  toFsrsCard,
  statusOf,
  MAX_INTERVAL,
} from "../srs";

const T0 = new Date("2026-01-01T09:00:00+08:00");

describe("FSRS 排期", () => {
  it("四档预览间隔单调递增", () => {
    const preview = previewGrades(null, T0);
    expect(preview.map((p) => p.grade)).toEqual([1, 2, 3, 4]);
    const days = preview.map((p) => p.days);
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i]!).toBeGreaterThan(days[i - 1]!);
    }
  });

  it("按钮印的间隔 = 提交后实际排期（验收 4）", () => {
    for (const grade of [1, 2, 3, 4] as const) {
      const preview = previewGrades(null, T0);
      const printed = preview.find((p) => p.grade === grade)!.days;
      const applied = applyGrade(null, grade, T0);
      expect(applied.days).toBe(printed);
    }
  });

  it("同一词连续两次「记得」，第二次间隔 > 第一次（验收 5）", () => {
    const first = applyGrade(newCardRecord("k", T0), 3, T0);
    const secondAt = new Date(first.record.due);
    const second = applyGrade(first.record, 3, secondAt);
    expect(second.record.scheduled_days).toBeGreaterThan(first.record.scheduled_days);
    expect(second.days).toBeGreaterThan(first.days);
  });

  it("答错后 stability 显著下降，到期回到 1 天内（验收 6）", () => {
    let record = newCardRecord("k", T0);
    let at = T0;
    for (let i = 0; i < 3; i += 1) {
      const out = applyGrade(record, 4, at);
      record = out.record;
      at = new Date(record.due);
    }
    expect(record.stability).toBeGreaterThan(5);
    const lapse = applyGrade(record, 1, at);
    expect(lapse.record.stability).toBeLessThan(record.stability);
    expect(lapse.days).toBeLessThanOrEqual(1);
  });

  it("间隔不超过 maximum_interval", () => {
    let record = newCardRecord("k", T0);
    let at = T0;
    for (let i = 0; i < 40; i += 1) {
      record = applyGrade(record, 4, at).record;
      at = new Date(record.due);
    }
    expect(record.scheduled_days).toBeLessThanOrEqual(MAX_INTERVAL);
  });

  it("到期判定按 due <= now", () => {
    const record = newCardRecord("k", T0);
    const out = applyGrade(record, 3, T0).record;
    expect(isDue(out, T0)).toBe(false);
    expect(isDue(out, new Date(out.due))).toBe(true);
    expect(isDue(out, new Date(out.due + 1000))).toBe(true);
  });

  it("新词可提取强度为 0", () => {
    expect(retrievability(newCardRecord("k", T0), T0)).toBe(0);
  });

  it("留存率越高，排期越短（更保守）", () => {
    const r90 = applyGrade(newCardRecord("k", T0), 3, T0, 0.9);
    const r95 = applyGrade(newCardRecord("k", T0), 3, T0, 0.95);
    expect(r95.days).toBeLessThanOrEqual(r90.days);

    // R 只由 stability + 已过天数决定，与 request_retention 无关：调高留存率的作用是压缩间隔
    const first90 = applyGrade(newCardRecord("k", T0), 4, T0, 0.9);
    const first95 = applyGrade(newCardRecord("k", T0), 4, T0, 0.95);
    const second90 = applyGrade(first90.record, 4, new Date(first90.record.due), 0.9);
    const second95 = applyGrade(first95.record, 4, new Date(first95.record.due), 0.95);
    expect(second90.days).toBeGreaterThan(second95.days);
  });

  it("状态左栏分类", () => {
    const fresh = newCardRecord("k", T0);
    expect(statusOf(fresh, false, T0).kind).toBe("new");
    expect(statusOf(fresh, true, T0).kind).toBe("mastered");
    const due = applyGrade(fresh, 3, T0).record;
    expect(statusOf(due, false, new Date(due.due + 86_400_000)).kind).toBe("due");
    expect(statusOf(due, false, new Date(due.due + 86_400_000)).label).toContain("逾期");
  });

  it("留存率越界会被夹到 0.8–0.95", () => {
    expect(() => scheduler(0.5)).not.toThrow();
    expect(() => scheduler(0.99)).not.toThrow();
  });

  it("「很熟」不会一路排到几年后（长期记忆取向：一年内至少复查一次）", () => {
    let record = newRecord();
    let at = T0;
    for (let i = 0; i < 6; i += 1) {
      const out = applyGrade(record, 4, at);
      record = out.record;
      at = new Date(record.due);
      expect(out.days).toBeLessThanOrEqual(MAX_INTERVAL);
    }
    // 关键回归：FSRS 默认会给到 1252 天，一次拼写正确换三年半空窗
    expect(record.scheduled_days).toBeLessThanOrEqual(MAX_INTERVAL);
  });

  it("答错永远回到 1 天，不会因为反复答错越排越远", () => {
    let record = newRecord();
    let at = T0;
    for (let i = 0; i < 5; i += 1) {
      const out = applyGrade(record, 1, at);
      record = out.record;
      expect(out.days).toBe(1);
      at = new Date(record.due);
    }
  });
});

function newRecord() {
  return applyGrade(null, 3, T0).record;
}

/**
 * `retrievability` 为了性能改成了闭式公式（省掉每张卡的 Card 对象构造）。
 * 这里对 ts-fsrs 的库实现做逐值交叉校验 —— 公式一旦漂移，
 * 「按 R 升序排队列」和「平均留存率」都会静默变味。
 */
describe("可提取强度：闭式公式 vs 库实现", () => {
  it("在真实参数网格上与 get_retrievability 一致", () => {
    const f = scheduler(0.9);
    let checked = 0;
    for (const stability of [0.5, 1, 3, 10, 40, 120, 365]) {
      for (const elapsedDays of [0, 1, 3, 7, 14, 30, 90, 200, 365]) {
        const record = {
          ...newCardRecord("k", T0),
          reps: 3,
          state: 2 as const,
          stability,
          difficulty: 5,
          elapsed_days: elapsedDays,
          scheduled_days: elapsedDays,
          last_review: T0.getTime(),
        };
        const now = new Date(T0.getTime() + elapsedDays * 86_400_000);
        const expected = f.get_retrievability(toFsrsCard(record), now, false);
        const actual = retrievability(record, now, 0.9);
        // 库实现会 roundTo(…, 8)，允许 1e-7 的舍入差
        expect(Math.abs(actual - expected)).toBeLessThan(1e-7);
        checked += 1;
      }
    }
    expect(checked).toBe(63);
  });

  it("新词与零 stability 返回 0", () => {
    expect(retrievability(newCardRecord("k", T0), T0)).toBe(0);
    expect(retrievability({ ...newCardRecord("k", T0), reps: 3, stability: 0 }, T0)).toBe(0);
  });

  it("缺 last_review 的历史记录用 due - scheduled_days 反推", () => {
    const record = {
      ...newCardRecord("k", T0),
      reps: 3,
      state: 2 as const,
      stability: 10,
      elapsed_days: 0,
      scheduled_days: 10,
      due: T0.getTime() + 10 * 86_400_000,
    };
    delete (record as { last_review?: number }).last_review;
    // due 前 10 天就是上次复习日；此刻刚好 20 天没复习
    const now = new Date(T0.getTime() + 20 * 86_400_000);
    const value = retrievability(record, now, 0.9);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });
});
