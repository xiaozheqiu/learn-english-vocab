import { Select } from "@/components/ui/select";
import { LEVELS, PAGE_SIZES, type LevelFilter, type PageSize, type Prefs } from "@/lib/types";
import type { VocabStore } from "@/hooks/useVocabStore";

export interface SettingsSectionProps {
  prefs: Prefs;
  setPrefs: VocabStore["setPrefs"];
}

const levelOptions: { value: LevelFilter; label: string }[] = [
  ...LEVELS.map((level) => ({ value: level as LevelFilter, label: level })),
  { value: "ALL", label: "全部等级" },
];

/**
 * 设置分区（§2.3 / §4 / §5 F4）。
 *
 * 只有词表本身的显示选项：每页条数与默认等级。
 * 学习节奏（留存率、题量、题型、新词上限）与锁屏 PIN 已随对应功能一并移除 ——
 * 这个应用现在就是一份可筛选、可标记掌握的词表。
 */
export function SettingsSection({ prefs, setPrefs }: SettingsSectionProps) {
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

      <section aria-labelledby="settings-about-title" className="border-t border-line pt-4">
        <h3 id="settings-about-title" className="text-[13px] font-medium text-ink">
          关于这个应用
        </h3>
        <p className="mt-1 text-[12px] leading-5 text-ink-mute">
          纯前端静态词表：按等级 / 档位 / CEFR / 牛津官方词表筛选与搜索，
          标记「已掌握」后进度只存在本机浏览器。
        </p>
      </section>
    </div>
  );
}
