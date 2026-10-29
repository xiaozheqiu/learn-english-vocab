import { describe, expect, it } from "vitest";
import { dayKey, toDate } from "../date";

const T0 = new Date("2026-03-10T10:30:00+08:00");

describe("本地日期工具", () => {
  it("dayKey 用本地时区，不跨天", () => {
    expect(dayKey(T0)).toBe("2026-03-10");
    // 本地 00:05 仍是当天（UTC 会是前一天）
    expect(dayKey(new Date("2026-03-10T00:05:00+08:00"))).toBe("2026-03-10");
    expect(dayKey(new Date("2026-03-10T23:59:00+08:00"))).toBe("2026-03-10");
  });

  it("dayKey 接受时间戳与 ISO 字符串", () => {
    expect(dayKey(T0.getTime())).toBe("2026-03-10");
    expect(dayKey("2026-03-10T10:30:00+08:00")).toBe("2026-03-10");
  });

  it("toDate 保留 Date 实例，其它输入交给 Date 解析", () => {
    expect(toDate(T0)).toBe(T0);
    expect(toDate(T0.getTime()).getTime()).toBe(T0.getTime());
  });
});
