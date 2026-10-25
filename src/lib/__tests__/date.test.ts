import { describe, expect, it } from "vitest";
import {
  addDays,
  dayKey,
  diffDays,
  formatInterval,
  formatScheduledDays,
  nextDays,
  startOfDay,
} from "../date";

const T0 = new Date("2026-03-10T10:30:00+08:00");

describe("本地日期工具", () => {
  it("dayKey 用本地时区，不跨天", () => {
    expect(dayKey(T0)).toBe("2026-03-10");
    // 本地 00:05 仍是当天（UTC 会是前一天）
    expect(dayKey(new Date("2026-03-10T00:05:00+08:00"))).toBe("2026-03-10");
    expect(dayKey(new Date("2026-03-10T23:59:00+08:00"))).toBe("2026-03-10");
  });

  it("diffDays 按本地日历折算", () => {
    expect(diffDays("2026-03-08T00:00:00+08:00", "2026-03-10T00:00:00+08:00")).toBe(2);
    expect(diffDays(T0, T0)).toBe(0);
  });

  it("startOfDay 归零", () => {
    const start = startOfDay(T0);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(dayKey(start)).toBe("2026-03-10");
  });

  it("addDays 跨月正确", () => {
    expect(dayKey(addDays(new Date("2026-01-31T12:00:00+08:00"), 1))).toBe("2026-02-01");
  });

  it("formatInterval 覆盖今天/逾期/天/月/年", () => {
    expect(formatInterval(new Date(T0.getTime() - 1000), T0)).toBe("今天到期");
    expect(formatInterval(new Date(T0.getTime() - 3 * 86_400_000), T0)).toBe("逾期 3 天");
    expect(formatInterval(addDays(T0, 1), T0)).toBe("明天");
    expect(formatInterval(addDays(T0, 2), T0)).toBe("2 天后");
    expect(formatInterval(addDays(T0, 40), T0)).toBe("1 个月后");
    expect(formatInterval(addDays(T0, 90), T0)).toBe("3 个月后");
    expect(formatInterval(addDays(T0, 400), T0)).toBe("1 年后");
    expect(formatInterval(addDays(T0, 800), T0)).toBe("2 年后");
  });

  it("formatScheduledDays 给按钮用", () => {
    expect(formatScheduledDays(1)).toBe("1 天");
    expect(formatScheduledDays(8)).toBe("8 天");
    expect(formatScheduledDays(21)).toBe("1 个月");
    expect(formatScheduledDays(90)).toBe("3 个月");
    expect(formatScheduledDays(365)).toBe("1 年");
    expect(formatScheduledDays(0)).toBe("<1 天");
  });

  it("nextDays 给出今天起 n 天", () => {
    const days = nextDays(7, T0);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-03-10");
    expect(days[6]).toBe("2026-03-16");
  });
});
