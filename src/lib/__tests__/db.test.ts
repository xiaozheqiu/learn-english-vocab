import { describe, expect, it } from "vitest";
import { DEFAULT_META, isMemoryMode, normalizePrefs, parseExport, probeStorage } from "../db";
import { DEFAULT_PREFS } from "../types";

describe("导出/导入解析", () => {
  it("合法载荷被完整接收", () => {
    const payload = {
      version: 3,
      exportedAt: "2026-03-10T00:00:00.000Z",
      mastery: ["A1|abandon|v."],
      prefs: DEFAULT_PREFS,
    };
    const parsed = parseExport(payload);
    expect(parsed.mastery).toEqual(["A1|abandon|v."]);
    expect(parsed.prefs).toEqual(DEFAULT_PREFS);
  });

  it("v2 老备份里的 srs / days 被忽略，mastery 照常导入", () => {
    const parsed = parseExport({
      version: 2,
      mastery: ["K"],
      srs: [{ key: "K", due: 0, stability: 1, difficulty: 5 }],
      days: [{ day: "2026-03-10", reviewed: 3 }],
    });
    expect(parsed.mastery).toEqual(["K"]);
    expect("srs" in parsed).toBe(false);
    expect(parsed.version).toBe(3);
  });

  it("字符串输入也能解析", () => {
    const parsed = parseExport(JSON.stringify({ mastery: ["k"] }));
    expect(parsed.mastery).toEqual(["k"]);
  });

  it("脏数据被过滤而不是整包失败", () => {
    const parsed = parseExport({
      mastery: ["ok", 123, null],
      prefs: { pageSize: 100 },
    });
    expect(parsed.mastery).toEqual(["ok"]);
    expect(parsed.prefs.pageSize).toBe(100);
    expect(parsed.prefs.defaultLevel).toBe(DEFAULT_PREFS.defaultLevel);
  });

  it("非法输入抛错", () => {
    expect(() => parseExport("null")).toThrow();
  });
});

describe("默认值", () => {
  it("默认 meta 只有偏好与迁移标记", () => {
    expect(DEFAULT_META.migratedFromLocal).toBe(false);
    expect("pinHash" in DEFAULT_META).toBe(false);
    expect("lockEnabled" in DEFAULT_META).toBe(false);
    expect(DEFAULT_PREFS.pageSize).toBe(20);
  });
});

/**
 * 偏好归一：复习/测试/锁屏的字段已随功能移除，
 * 老库里存着也必须被丢掉，不能又流回界面上。
 */
describe("偏好归一", () => {
  it("只保留每页条数与默认等级", () => {
    const prefs = normalizePrefs({
      pageSize: 50,
      defaultLevel: "B2",
      sessionSize: 200,
      reviewSize: 300,
      quizSize: 30,
      retention: 0.92,
      quizTypes: ["spell"],
      includeExtended: true,
      cefrCap: "b1",
      autoLockMinutes: 0,
    });
    expect(prefs).toEqual({ pageSize: 50, defaultLevel: "B2" });
  });

  it("完全缺失或脏值时给全套默认", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({})).toEqual(DEFAULT_PREFS);
  });

  it("每页条数上限收到 200 后，老库的 500 会归到 200", () => {
    expect(normalizePrefs({ pageSize: 500 }).pageSize).toBe(200);
    expect(normalizePrefs({ pageSize: 200 }).pageSize).toBe(200);
    expect(normalizePrefs({ pageSize: 20 }).pageSize).toBe(20);
    expect(normalizePrefs({ pageSize: 999 }).pageSize).toBe(200);
    expect(normalizePrefs({ pageSize: "abc" }).pageSize).toBe(20);
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
