import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { LEVELS, PAGE_SIZES, type LevelFilter, type PageSize, type Prefs } from "@/lib/types";
import type { CheckResult, PwaUpdate } from "@/hooks/usePwaUpdate";
import type { VocabStore } from "@/hooks/useVocabStore";

export interface SettingsSectionProps {
  prefs: Prefs;
  setPrefs: VocabStore["setPrefs"];
  /** 版本检查入口；不传就整块隐藏（SSR 冒烟测试不需要它） */
  update?: PwaUpdate;
}

const levelOptions: { value: LevelFilter; label: string }[] = [
  ...LEVELS.map((level) => ({ value: level as LevelFilter, label: level })),
  { value: "ALL", label: "全部等级" },
];

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

/**
 * 设置分区（§2.3 / §4 / §5 F4）。
 *
 * 词表显示选项（每页条数、默认等级）+ 版本检查。
 * 学习节奏（留存率、题量、题型、新词上限）与锁屏 PIN 已随对应功能一并移除 ——
 * 这个应用现在就是一份可筛选、可标记掌握的词表。
 *
 * 版本检查放在设置里而不是顶栏：更新本来就会自己弹（发现新版是阻塞提示），
 * 手动入口只服务于「我想马上确认手机上是不是最新版」这一种心态。
 */
export function SettingsSection({ prefs, setPrefs, update }: SettingsSectionProps) {
  const hint = update ? resultText(update.checkResult, update.lastCheckedAt) : null;

  return (
    <div className="space-y-5">
      <section aria-labelledby="settings-list-title" className="space-y-3">
        <h3 id="settings-list-title" className="text-[13px] font-medium text-ink">
          词表
        </h3>

        <div className="flex items-center justify-between gap-2">
          <label htmlFor="pref-page-size" className="text-[13px] text-ink-soft">
            每页条数
          </label>
          <Select
            id="pref-page-size"
            value={String(prefs.pageSize)}
            onChange={(event) =>
              void setPrefs({ pageSize: Number(event.target.value) as PageSize })
            }
            className="h-11 w-[104px]"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / 页
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label htmlFor="pref-default-level" className="text-[13px] text-ink-soft">
            默认等级
          </label>
          <Select
            id="pref-default-level"
            value={prefs.defaultLevel}
            onChange={(event) => void setPrefs({ defaultLevel: event.target.value as LevelFilter })}
            className="h-11 w-[104px]"
          >
            {levelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-[12px] leading-5 text-ink-mute">
          打开词表页时默认落到这个等级；「全部等级」会按需加载全部分包。
        </p>
      </section>

      {update && (
        <section aria-labelledby="settings-update-title" className="border-t border-line pt-4">
          <h3 id="settings-update-title" className="text-[13px] font-medium text-ink">
            版本
          </h3>
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
            ) : update.checkResult === "latest" ? (
              <Check className="h-4 w-4" aria-hidden="true" />
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
        </section>
      )}

      <section aria-labelledby="settings-about-title" className="border-t border-line pt-4">
        <h3 id="settings-about-title" className="text-[13px] font-medium text-ink">
          关于这个应用
        </h3>
        <p className="mt-1 text-[12px] leading-5 text-ink-mute">
          纯前端静态词表：按等级 / 档位 / 牛津官方词表筛选与搜索，
          标记「已掌握」后进度只存在本机浏览器。
        </p>
      </section>
    </div>
  );
}
