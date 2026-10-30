import { BookOpen, Database, Info, Loader2, MonitorDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CheckResult, PwaUpdate } from "@/hooks/usePwaUpdate";

/**
 * 版本信息来自构建时注入（vite.config.js 的 define），不再手写。
 *
 * 手写的版本号常年不动（自 v2.0.0 之后 11 个提交都没改），
 * 而 PWA 是静默更新的 —— 只看版本号无法判断手机上是不是最新版。
 * 加上提交 sha 与构建时间，才能对着 GitHub 上的提交一眼确认。
 */
export const APP_VERSION = __APP_VERSION__;
export const BUILD_SHA = __BUILD_SHA__;
export const BUILD_TIME = __BUILD_TIME__;
export const BUILD_FINGERPRINT = __BUILD_FINGERPRINT__;

/** 构建时间只显示到分钟，用本地时区 */
export function formatBuildTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** 手动检查的结论文案；checking 由按钮自己表达，这里只处理终态 */
function resultText(result: CheckResult, lastCheckedAt: number | null): string | null {
  if (result === "latest") return "已经是最新版本";
  if (result === "found") return "发现新版本，正在自动更新…";
  if (result === "unsupported") return "当前环境不支持版本检查（未注册 Service Worker）";
  if (result === "error") return "检查失败，可能没联网，稍后再试";
  if (lastCheckedAt) {
    const time = new Date(lastCheckedAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `上次检查 ${pad(time.getHours())}:${pad(time.getMinutes())}`;
  }
  return null;
}

export interface AboutSectionProps {
  onOpenGuide: () => void;
  /** 浏览器允许安装时才有入口；不传就整块隐藏（SSR 冒烟测试也不传） */
  canInstall?: boolean;
  onInstall?: () => void;
  /** 手动检查更新的入口；不传就隐藏 */
  update?: PwaUpdate;
}

/**
 * 关于（§2.3 / §4.1 / §11）：词性对照表入口、数据来源、版本、检查更新、安装。
 *
 * 面板收成单页之后，这里是唯一还带动作的地方：
 * 「检查更新」贴着版本号（它回答的正是「我这是不是最新版」），
 * 「安装到桌面」是浏览器允许时的一次性入口。这两个能力原本分别住在设置分区与
 * 数据分区，那两个分区连同导出 / 导入 / 清空一并移除，但能力本身留着。
 */
export function AboutSection({ onOpenGuide, canInstall, onInstall, update }: AboutSectionProps) {
  const hint = update ? resultText(update.checkResult, update.lastCheckedAt) : null;

  return (
    <div className="space-y-4">
      <section aria-labelledby="about-guide-title">
        <h3 id="about-guide-title" className="text-[13px] font-medium text-ink">
          词性对照表
        </h3>
        <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">
          名词、动词、形容词等缩写与用法说明。
        </p>
        <Button variant="outline" size="touch" className="mt-1.5 w-full" onClick={onOpenGuide}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          打开词性对照表
        </Button>
      </section>

      <section aria-labelledby="about-source-title" className="border-t border-line pt-3">
        <h3
          id="about-source-title"
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink"
        >
          <Database className="h-3.5 w-3.5 text-ink-mute" aria-hidden="true" />
          数据来源
        </h3>
        <ul className="mt-1 space-y-1 text-[12px] leading-5 text-ink-soft">
          <li className="tnum">Oxford 5000 词表，共 5323 条，覆盖 A1–C1 五个等级</li>
          <li>词性与中文释义取自词表原数据，未做改写</li>
          <li>词表只显示单词与词性；释义不展示、也不参与搜索，点单词跳三方词典查</li>
          <li>已掌握标记全部保存在本机浏览器，不上传、无服务端</li>
        </ul>
      </section>

      <section aria-labelledby="about-version-title" className="border-t border-line pt-3">
        <h3
          id="about-version-title"
          className="flex items-center gap-1.5 text-[13px] font-medium text-ink"
        >
          <Info className="h-3.5 w-3.5 text-ink-mute" aria-hidden="true" />
          版本
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-soft tnum">
          <Badge variant="brand">v{APP_VERSION}</Badge>
          <span data-build-sha>{BUILD_SHA}</span>
          <span>{formatBuildTime(BUILD_TIME)}</span>
        </p>
        <p className="mt-1 text-[11px] leading-5 text-ink-mute tnum">
          构建 {BUILD_FINGERPRINT} · 更新后这里会变，可据此确认拿到的是哪一版
        </p>

        {update && (
          <>
            <Button
              variant="outline"
              size="touch"
              className="mt-2 w-full"
              onClick={update.check}
              disabled={update.checking}
              data-testid="check-update"
            >
              {update.checking ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              {update.checking ? "正在检查…" : "检查更新"}
            </Button>
            <p
              className="mt-1.5 text-[12px] leading-5 text-ink-mute"
              role="status"
              aria-live="polite"
              data-testid="check-update-status"
            >
              {hint ?? "有新版本会自动更新并刷新页面；这里只是手动催一次检查。"}
            </p>
          </>
        )}
      </section>

      {canInstall && onInstall && (
        <section aria-labelledby="about-install-title" className="border-t border-line pt-3">
          <h3 id="about-install-title" className="text-[13px] font-medium text-ink">
            安装到桌面
          </h3>
          <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">装成独立应用，断网也能查词。</p>
          <Button size="touch" className="mt-1.5 w-full" onClick={onInstall}>
            <MonitorDown className="h-4 w-4" aria-hidden="true" />
            安装应用
          </Button>
        </section>
      )}

      <p className="border-t border-line pt-3 text-[12px] leading-5 text-ink-soft">
        React + TypeScript · 纯前端离线可用
      </p>
    </div>
  );
}
