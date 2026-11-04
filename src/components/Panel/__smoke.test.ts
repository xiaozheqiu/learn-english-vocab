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

/** 面板退化成单页「关于」后的 SSR 冒烟：只验证渲染不抛错、关键文案与数字在位。 */

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

describe("关于分区（§2.3）", () => {
  it("关于分区写明数据来源与版本号", () => {
    const html = render(createElement(AboutSection, { onOpenGuide: () => {} }));
    // 版本号来自构建时注入，不写死字面量 —— 否则每次发版都要改测试
    expect(html).toContain(`v${APP_VERSION}`);
    expect(html).toContain("4955");
    expect(html).toContain("本机浏览器");
  });

  it("面板收成单页后，检查更新与安装入口都落在关于里", () => {
    const checked: string[] = [];
    const installed: string[] = [];
    const html = render(
      createElement(AboutSection, {
        onOpenGuide: () => {},
        canInstall: true,
        onInstall: () => installed.push("install"),
        update: {
          reloading: false,
          checking: false,
          checkResult: "idle" as const,
          lastCheckedAt: null,
          check: () => checked.push("check"),
        },
      }),
    );
    expect(html).toContain('data-testid="check-update"');
    expect(html).toContain('data-testid="check-update-status"');
    expect(html).toContain("安装应用");
    // 没查过时不该编一个「上次检查」出来
    expect(html).not.toContain("上次检查");
  });

  it("「已是最新」时给出明确结论，不是只说在检查", () => {
    const html = render(
      createElement(AboutSection, {
        onOpenGuide: () => {},
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

  it("不支持安装与不传 update 时，两个入口都不出现", () => {
    const html = render(createElement(AboutSection, { onOpenGuide: () => {} }));
    expect(html).not.toContain("安装应用");
    expect(html).not.toContain('data-testid="check-update"');
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

  /**
   * 云端同步默认不出现 —— 没配 Supabase 的人（本地开发、e2e、首次 clone）
   * 拿到的应用必须和接入之前一模一样。
   */
  it("不传 cloud 时同步整块不渲染", () => {
    const html = render(createElement(AboutSection, { onOpenGuide: () => {} }));
    expect(html).not.toContain('data-testid="cloud-status"');
    expect(html).not.toContain('data-testid="cloud-login-form"');
    expect(html).not.toContain('data-testid="cloud-sync"');
    expect(html).not.toContain("跨设备同步");
  });

  it("disabled 等同于未接入，同样不渲染", () => {
    const html = render(
      createElement(AboutSection, { onOpenGuide: () => {}, cloud: "disabled" as const }),
    );
    expect(html).not.toContain('data-testid="cloud-status"');
  });

  it("未登录时给登录入口，且说明进度只在本机", () => {
    const html = render(
      createElement(AboutSection, {
        onOpenGuide: () => {},
        cloud: "signedOut" as const,
        onLogin: async () => null,
      }),
    );
    expect(html).toContain('data-testid="cloud-login-form"');
    expect(html).toContain('data-state="signedOut"');
    expect(html).toContain("进度只存在这台设备上");
    // 未登录不该出现「立即同步」
    expect(html).not.toContain('data-testid="cloud-sync"');
  });

  /**
   * 登录后不该有「同步」按钮。
   *
   * 同步是自动的（点词即推、打开/切回即拉），一个需要人手动催的同步按钮
   * 等于把设计缺陷摆在界面上。这条断言就是防止它被好心加回来。
   */
  it("已登录时只留退出登录，不再有手动同步按钮", () => {
    const html = render(
      createElement(AboutSection, {
        onOpenGuide: () => {},
        cloud: "synced" as const,
        onSignOut: () => {},
      }),
    );
    expect(html).toContain('data-state="synced"');
    expect(html).toContain("已与云端对齐");
    expect(html).not.toContain('data-testid="cloud-sync"');
    expect(html).toContain('data-testid="cloud-signout"');
  });

  it("同步中也不出现手动同步按钮", () => {
    const html = render(
      createElement(AboutSection, {
        onOpenGuide: () => {},
        cloud: "syncing" as const,
        onSignOut: () => {},
      }),
    );
    expect(html).toContain('data-state="syncing"');
    expect(html).not.toContain('data-testid="cloud-sync"');
  });

  it("失败时给出原因，并强调本地进度没受影响", () => {
    const html = render(
      createElement(AboutSection, {
        onOpenGuide: () => {},
        cloud: "error" as const,
        cloudError: "云端读取失败，稍后重试",
      }),
    );
    expect(html).toContain('data-state="error"');
    expect(html).toContain("云端读取失败");
  });

  it("没传 cloudError 时失败态有兜底文案，不渲染空行", () => {
    const html = render(
      createElement(AboutSection, {
        onOpenGuide: () => {},
        cloud: "error" as const,
      }),
    );
    expect(html).toContain("同步失败，本地进度未受影响");
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
