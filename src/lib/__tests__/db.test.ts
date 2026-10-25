import { describe, expect, it } from "vitest";
import { DEFAULT_META, isMemoryMode, normalizePrefs, parseExport, probeStorage } from "../db";
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

  it("老库里的 newPerDay 字段被丢弃（新词不再有每日配额）", () => {
    const prefs = normalizePrefs({ pageSize: 20, newPerDay: 60 });
    expect("newPerDay" in prefs).toBe(false);
    expect(prefs.pageSize).toBe(20);
    // 其余字段照常保留
    expect(prefs.reviewSize).toBe(300);
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
      pageSize: 50,
      defaultLevel: "B2",
      reviewSize: 200,
      quizSize: 30,
      retention: 0.92,
      autoLockMinutes: 0,
      quizTypes: ["spell"],
    });
    expect(prefs.reviewSize).toBe(200);
    expect(prefs.quizSize).toBe(30);
    expect(prefs.retention).toBe(0.92);
  });
});

/**
 * 降级判定的两条路径必须都算「内存态」。
 *
 * 这是曾经漏掉的一类静默丢数据：隐私模式下 `indexedDB` 这个 API 是存在的
 * （所以 `isMemoryMode()` 返回 false，界面不提示），但真正 openDB 会抛，
 * 于是所有写入落到内存里 —— 用户关掉页面进度全没，而且没有任何告警。
 */
describe("存储降级判定", () => {
  it("没有 indexedDB：同步就判定为内存态，探测也失败", async () => {
    expect(isMemoryMode()).toBe(true);
    expect(await probeStorage()).toBe(false);
  });

  it("indexedDB 存在但 open 抛错（隐私模式）：同步看不出来，异步探测必须发现", async () => {
    const original = globalThis.indexedDB;
    // 模拟 Safari 隐私模式：API 在，但 open() 直接抛 SecurityError
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        open: () => {
          throw new Error("SecurityError: storage disabled");
        },
      },
    });
    try {
      // 同步检查被 API 的存在骗过 —— 这正是线上那个静默丢数据的入口
      expect(isMemoryMode()).toBe(false);
      // 异步探测必须能揭穿它
      expect(await probeStorage()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: original,
      });
    }
  });
});
