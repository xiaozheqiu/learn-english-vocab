import { describe, expect, it } from "vitest";
import { DEFAULT_META, normalizePrefs, parseExport } from "../db";
import { DEFAULT_PREFS } from "../types";
import { DAY_MS } from "../date";

describe("导出/导入解析", () => {
  it("合法载荷被完整接收", () => {
    const payload = {
      version: 2,
      exportedAt: "2026-03-10T00:00:00.000Z",
      mastery: ["A1|abandon|v."],
      srs: [{ key: "A1|ability|n.", due: 0, stability: 1, difficulty: 5 }],
      days: [{ day: "2026-03-10", reviewed: 3, correct: 2, wrong: 1, newWords: 1 }],
      prefs: DEFAULT_PREFS,
    };
    const parsed = parseExport(payload);
    expect(parsed.mastery).toEqual(["A1|abandon|v."]);
    expect(parsed.srs).toHaveLength(1);
    expect(parsed.days).toHaveLength(1);
  });

  it("字符串输入也能解析", () => {
    const parsed = parseExport(JSON.stringify({ mastery: ["k"], srs: [], days: [] }));
    expect(parsed.mastery).toEqual(["k"]);
  });

  it("脏数据被过滤而不是整包失败", () => {
    const parsed = parseExport({
      mastery: ["ok", 123, null],
      srs: [{ key: "k", due: 0, stability: 1 }, { bad: true }],
      days: [{ day: "2026-03-10", reviewed: 1 }, { day: 5 }],
      prefs: { pageSize: 100 },
    });
    expect(parsed.mastery).toEqual(["ok"]);
    expect(parsed.srs).toHaveLength(1);
    expect(parsed.days).toHaveLength(1);
    expect(parsed.prefs.pageSize).toBe(100);
    // 缺省项用默认值补齐
    expect(parsed.prefs.retention).toBe(DEFAULT_PREFS.retention);
  });

  it("非法输入抛错", () => {
    expect(() => parseExport("null")).toThrow();
  });
});

describe("默认值", () => {
  it("默认 meta 未开机锁屏、未完成 setup", () => {
    expect(DEFAULT_META.lockEnabled).toBe(false);
    expect(DEFAULT_META.setupDone).toBe(false);
    expect(DEFAULT_META.pinHash).toBeNull();
    expect(DEFAULT_PREFS.pageSize).toBe(20);
    expect(DEFAULT_PREFS.newPerDay).toBeGreaterThan(0);
    expect(DEFAULT_PREFS.retention).toBe(0.9);
  });

  it("DAY_MS 是常量 24h", () => {
    expect(DAY_MS).toBe(86_400_000);
  });
});

/**
 * 偏好拆分：早期只有一个 sessionSize（复习/测试共用），现在拆成
 * reviewSize（清账，大）与 quizSize（练手感，小）。
 */
describe("偏好归一与迁移", () => {
  it("老库只有 sessionSize 时，值迁到 reviewSize，quizSize 用默认值", () => {
    const prefs = normalizePrefs({ pageSize: 20, sessionSize: 200 });
    expect(prefs.reviewSize).toBe(200);
    expect(prefs.quizSize).toBe(50);
  });

  it("sessionSize 落在两档之间时取最近的一档", () => {
    // 90 更靠 50 但这只影响复习题量（落在 150 与 50 之间时仍归到最近候选）
    expect(normalizePrefs({ pageSize: 20, sessionSize: 90 }).reviewSize).toBe(150);
    // 测试题量永远是独立默认值，不跟着 sessionSize 跑
    expect(normalizePrefs({ pageSize: 20, sessionSize: 90 }).quizSize).toBe(50);
    expect(normalizePrefs({ pageSize: 20, sessionSize: 260 }).reviewSize).toBe(300);
    expect(normalizePrefs({ pageSize: 20, sessionSize: 400 }).reviewSize).toBe(500);
  });

  it("新词上限被夹进 20–80（老库里的 15 抬到 20，超出的 120 收到 80）", () => {
    // 低于下限：抬到 20（每天 20 个约 267 天覆盖全库，是可持续的下限）
    expect(normalizePrefs({ pageSize: 20, newPerDay: 15 }).newPerDay).toBe(20);
    expect(normalizePrefs({ pageSize: 20, newPerDay: 5 }).newPerDay).toBe(20);
    // 高于上限：收到 80（120 个/天的复习量压不住）
    expect(normalizePrefs({ pageSize: 20, newPerDay: 120 }).newPerDay).toBe(80);
    expect(normalizePrefs({ pageSize: 20, newPerDay: 200 }).newPerDay).toBe(80);
    // 区间内按步长取整
    expect(normalizePrefs({ pageSize: 20, newPerDay: 75 }).newPerDay).toBe(80);
    expect(normalizePrefs({ pageSize: 20, newPerDay: 34 }).newPerDay).toBe(30);
    expect(normalizePrefs({ pageSize: 20, newPerDay: 60 }).newPerDay).toBe(60);
  });

  it("完全缺失或脏值时给全套默认", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({})).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ pageSize: 20, quizSize: "abc" }).quizSize).toBe(50);
  });

  it("每页条数上限收到 200 后，老库的 500 会归到 200", () => {
    expect(normalizePrefs({ pageSize: 500 }).pageSize).toBe(200);
    expect(normalizePrefs({ pageSize: 200 }).pageSize).toBe(200);
    expect(normalizePrefs({ pageSize: 20 }).pageSize).toBe(20);
    expect(normalizePrefs({ pageSize: 999 }).pageSize).toBe(200);
  });

  it("已经是新结构时原样保留", () => {
    const prefs = normalizePrefs({
      pageSize: 50, defaultLevel: "B2", newPerDay: 70, reviewSize: 200, quizSize: 30,
      retention: 0.92, autoLockMinutes: 0, quizTypes: ["spell"],
    });
    expect(prefs.reviewSize).toBe(200);
    expect(prefs.quizSize).toBe(30);
    expect(prefs.newPerDay).toBe(70);
    expect(prefs.retention).toBe(0.92);
  });
});
