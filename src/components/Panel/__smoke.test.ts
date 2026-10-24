import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AboutSection } from "./sections/AboutSection";
import { DataSection } from "./sections/DataSection";
import { LearnSection } from "./sections/LearnSection";
import { SettingsSection } from "./sections/SettingsSection";
import { DEFAULT_PREFS } from "@/lib/types";
import { NO_ATTEMPTS } from "@/lib/lock";
import type { LockApi } from "@/hooks/useLock";
import type { Stats } from "@/lib/session";
import type { VocabStore } from "@/hooks/useVocabStore";

/** 浮窗 4 个分区的 SSR 冒烟：只验证渲染不抛错、关键文案与数字在位。 */

const STATS: Stats = {
  todayReviewed: 12,
  todayCorrect: 10,
  todayAccuracy: 10 / 12,
  streak: 5,
  learned: 120,
  masteryCount: 40,
  averageRetrievability: 0.87,
  forecast: [
    { day: "2026-10-24", label: "今天", count: 12 },
    { day: "2026-10-25", label: "六", count: 3 },
    { day: "2026-10-26", label: "日", count: 0 },
    { day: "2026-10-27", label: "一", count: 9 },
    { day: "2026-10-28", label: "二", count: 1 },
    { day: "2026-10-29", label: "三", count: 4 },
    { day: "2026-10-30", label: "四", count: 2 },
  ],
  dueToday: 12,
  newToday: 8,
  masteredInCooldown: 40,
};

const LOCK: LockApi = {
  ready: true,
  lockEnabled: true,
  setupDone: true,
  unlocked: true,
  attempts: NO_ATTEMPTS,
  autoLockMinutes: 30,
  lockoutLeft: 0,
  completeSetup: async () => {},
  unlock: async () => "ok",
  lockNow: () => {},
  resetPin: async () => {},
  disableLock: async () => {},
  setAutoLock: async () => {},
};

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

describe("浮窗分区（§2.3）", () => {
  it("学习分区显示今日数、留存率百分比与两周预测柱", () => {
    const html = render(
      createElement(LearnSection, {
        stats: STATS,
        prefs: DEFAULT_PREFS,
        today: "2026-10-24",
        onPrefsChange: () => {},
      }),
    );
    expect(html).toContain("今日复习");
    expect(html).toContain("90%"); // 0.9 → 显示百分比
    expect(html).toContain("今天");
    expect(html).toContain("连续天数");
    // 柱高用百分比 style（允许的唯一 inline style）
    expect(html).toMatch(/height:\s*\d+%/);
    expect(html).toContain("bg-brand-500");
  });

  it("数据分区给出导出、导入与清空的入口", () => {
    const html = render(
      createElement(DataSection, {
        store: {
          exportData: async () => ({}),
          importData: async () => {},
          wipeProgress: async () => {},
          refresh: async () => {},
        } as Pick<VocabStore, "exportData" | "importData" | "wipeProgress" | "refresh">,
        canInstall: false,
        onInstall: () => {},
      }),
    );
    expect(html).toContain("导出");
    expect(html).toContain("导入备份");
    expect(html).toContain("清空学习进度");
    expect(html).toContain("偏好和锁屏 PIN 会保留");
    expect(html).not.toContain("安装应用"); // canInstall=false 时不显示
  });

  it("设置分区含每页条数、自动锁定与锁屏开关，PIN 表单默认收起", () => {
    const html = render(
      createElement(SettingsSection, {
        prefs: DEFAULT_PREFS,
        setPrefs: async () => {},
        lock: LOCK,
        onLockNow: () => {},
      }),
    );
    expect(html).toContain("每页条数");
    expect(html).toContain("默认等级");
    expect(html).toContain("自动锁定");
    expect(html).toContain("修改 PIN");
    expect(html).toContain("学习数据不加密");
    // 未点开时不出现旧 PIN 输入框
    expect(html).not.toContain("旧 PIN");
  });

  it("关于分区写明 PIN 的真实定位与版本号", () => {
    const html = render(createElement(AboutSection, { onOpenGuide: () => {} }));
    expect(html).toContain("v2.0.0");
    expect(html).toContain("学习数据未加密；重置不会删除数据");
    expect(html).toContain("5323");
  });
});
