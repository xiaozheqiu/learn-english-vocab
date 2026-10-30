import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AboutSection,
  APP_VERSION,
  BUILD_FINGERPRINT,
  BUILD_SHA,
  formatBuildTime,
} from "./sections/AboutSection";
import { DataSection } from "./sections/DataSection";
import { SettingsSection } from "./sections/SettingsSection";
import { DEFAULT_PREFS } from "@/lib/types";
import type { VocabStore } from "@/hooks/useVocabStore";

/** 面板 3 个分区的 SSR 冒烟：只验证渲染不抛错、关键文案与数字在位。 */

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

describe("面板分区（§2.3）", () => {
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
    expect(html).toContain("清空掌握标记");
    expect(html).toContain("偏好会保留");
    expect(html).not.toContain("安装应用"); // canInstall=false 时不显示
  });

  it("设置分区只剩词表偏好，学习节奏与锁屏设置已移除", () => {
    const html = render(
      createElement(SettingsSection, {
        prefs: DEFAULT_PREFS,
        setPrefs: async () => {},
      }),
    );
    expect(html).toContain("每页条数");
    expect(html).toContain("默认等级");
    // 已随功能移除的设置项不得回到界面上
    expect(html).not.toContain("期望留存率");
    expect(html).not.toContain("自动锁定");
    expect(html).not.toContain("PIN");
  });

  it("设置分区带版本检查入口，且不拦着用户自己催一次", () => {
    const checked: string[] = [];
    const html = render(
      createElement(SettingsSection, {
        prefs: DEFAULT_PREFS,
        setPrefs: async () => {},
        update: {
          reloading: false,
          checking: false,
          checkResult: "idle" as const,
          lastCheckedAt: null,
          check: () => checked.push("check"),
        },
      }),
    );
    expect(html).toContain("检查更新");
    expect(html).toContain('data-testid="check-update"');
    expect(html).toContain('data-testid="check-update-status"');
    // 没查过时不该编一个「上次检查」出来
    expect(html).not.toContain("上次检查");
  });

  it("检查出「已是最新」时给出明确结论，而不是只说在检查", () => {
    const html = render(
      createElement(SettingsSection, {
        prefs: DEFAULT_PREFS,
        setPrefs: async () => {},
        update: {
          reloading: false,
          checking: false,
          checkResult: "latest" as const,
          lastCheckedAt: Date.parse("2026-10-30T08:00:00Z"),
          check: () => {},
        },
      }),
    );
    expect(html).toContain("已经是最新版本");
  });

  it("关于分区写明数据来源与版本号", () => {
    const html = render(createElement(AboutSection, { onOpenGuide: () => {} }));
    // 版本号来自构建时注入，不写死字面量 —— 否则每次发版都要改测试
    expect(html).toContain(`v${APP_VERSION}`);
    expect(html).toContain("5323");
    expect(html).toContain("本机浏览器");
  });

  it("关于分区显示构建标识，便于确认是否拿到最新版", () => {
    const html = render(createElement(AboutSection, { onOpenGuide: () => {} }));
    // 提交 sha 与构建指纹都在，且不是空串
    expect(html).toContain(`data-build-sha`);
    expect(html).toContain(BUILD_SHA);
    expect(html).toContain(BUILD_FINGERPRINT);
    expect(BUILD_SHA.length).toBeGreaterThan(0);
    expect(BUILD_FINGERPRINT.length).toBeGreaterThan(0);
  });
});

describe("构建时间格式化", () => {
  it("ISO 时间转成本地可读的到分钟格式", () => {
    // 用带时区偏移的输入，避免测试机时区影响判定
    const out = formatBuildTime("2026-10-24T13:45:18.000Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("非法时间原样返回，不抛错", () => {
    expect(formatBuildTime("not-a-date")).toBe("not-a-date");
  });
});
