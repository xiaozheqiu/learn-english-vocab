import { useState } from "react";
import { KeyRound, Lock, ShieldQuestion, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { loadSnapshot } from "@/lib/db";
import { explainPinError, isValidPin, PIN_MAX, PIN_MIN, pinHashBackend, verifyPin } from "@/lib/lock";
import {
  LEVELS,
  PAGE_SIZES,
  type LevelFilter,
  type PageSize,
  type Prefs,
} from "@/lib/types";
import type { LockApi } from "@/hooks/useLock";
import type { VocabStore } from "@/hooks/useVocabStore";
import { cn } from "@/lib/utils";

/** 自动锁定候选（分钟，0 = 不自动锁） */
const AUTO_LOCK_OPTIONS = [0, 5, 15, 30, 60] as const;

export interface SettingsSectionProps {
  prefs: Prefs;
  setPrefs: VocabStore["setPrefs"];
  lock: LockApi;
  onLockNow: () => void;
}

type PinMode = "set" | "change" | null;

/**
 * 设置分区（§2.3 / §4 / §5 F4）。
 * 偏好写 store.setPrefs；锁屏相关全部走 lock（PIN 只存哈希，重置不影响学习数据）。
 */
export function SettingsSection({ prefs, setPrefs, lock, onLockNow }: SettingsSectionProps) {
  const [pinMode, setPinMode] = useState<PinMode>(null);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinNotice, setPinNotice] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  const resetPinForm = () => {
    setPinMode(null);
    setOldPin("");
    setNewPin("");
    setConfirmPin("");
    setPinError("");
  };

  const submitPin = async () => {
    setPinError("");
    setPinNotice("");

    if (!isValidPin(newPin)) {
      setPinError(`新 PIN 需为 ${PIN_MIN}–${PIN_MAX} 位数字`);
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("两次输入的新 PIN 不一致");
      return;
    }

    setPinBusy(true);
    try {
      if (pinMode === "change") {
        if (oldPin.length < PIN_MIN) {
          setPinError(`请先输入旧 PIN（${PIN_MIN}–${PIN_MAX} 位数字）`);
          return;
        }
        // 旧 PIN 用 PBKDF2 校验（比对哈希，不碰明文）；错误就地提示，
        // 不走 lock.unlock 的失败计数，免得在设置里被误锁 30 秒。
        // lock 暴露 verifyPin 时优先用它，否则退回 lib/lock + 已存哈希。
        const ok = await checkOldPinWith(lock, oldPin);
        if (!ok) {
          setPinError("旧 PIN 不正确");
          return;
        }
      }
      await lock.resetPin(newPin);
      setPinNotice(pinMode === "change" ? "PIN 已修改" : "已开启锁屏并设置 PIN");
      resetPinForm();
    } catch (error) {
      setPinError(explainPinError(error));
    } finally {
      setPinBusy(false);
    }
  };

  const toggleLock = async (next: boolean) => {
    setPinNotice("");
    setPinError("");
    if (next) {
      // 开启锁屏必须先有 PIN：直接进入设置流程
      setConfirmDisable(false);
      setPinMode("set");
      setOldPin("");
      setNewPin("");
      setConfirmPin("");
      return;
    }
    // 关闭只走确认框里的按钮：开关本身只负责把确认框叫出来，避免一次误触直接关掉
    setConfirmDisable(true);
  };

  const disableLockNow = async () => {
    setToggleBusy(true);
    try {
      await lock.disableLock();
      setConfirmDisable(false);
      resetPinForm();
      setPinNotice("已关闭锁屏");
    } finally {
      setToggleBusy(false);
    }
  };

  const levelOptions: { value: LevelFilter; label: string }[] = [
    ...LEVELS.map((level) => ({ value: level as LevelFilter, label: level })),
    { value: "ALL", label: "全部等级" },
  ];

  return (
    <div className="space-y-5">
      {/* 词表偏好 */}
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
            onChange={(event) =>
              void setPrefs({ defaultLevel: event.target.value as LevelFilter })
            }
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

      {/* 锁屏 */}
      <section aria-labelledby="settings-lock-title" className="space-y-2 border-t border-line pt-4">
        <h3 id="settings-lock-title" className="text-[13px] font-medium text-ink">
          锁屏
        </h3>

        <button
          type="button"
          role="switch"
          aria-checked={lock.lockEnabled}
          disabled={toggleBusy}
          onClick={() => void toggleLock(!lock.lockEnabled)}
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-2 rounded-btn border px-3 text-left text-[13px] transition-colors",
            lock.lockEnabled
              ? "border-brand/40 bg-brand-wash text-brand-ink"
              : "border-line bg-card text-ink-soft hover:border-brand/40",
          )}
        >
          <span className="flex items-center gap-1.5">
            {lock.lockEnabled ? (
              <Lock className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Unlock className="h-4 w-4" aria-hidden="true" />
            )}
            启动时需要 PIN
          </span>
          <span
            className={cn(
              "relative h-6 w-10 shrink-0 rounded-full transition-colors",
              lock.lockEnabled ? "bg-brand" : "bg-line",
            )}
            aria-hidden="true"
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                lock.lockEnabled ? "translate-x-[18px]" : "translate-x-0.5",
              )}
            />
          </span>
        </button>

        {!lock.lockEnabled && (
          <p className="text-[12px] leading-5 text-ink-mute">
            未开启时打开应用直接进入词表。开启需要设置 4–6 位数字 PIN。
          </p>
        )}

        {confirmDisable && lock.lockEnabled && (
          <div className="rounded-btn border border-due/30 bg-due-wash px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-[12px] font-medium leading-5 text-due" role="alert">
              <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              关闭后任何人拿起这台设备都能直接看词表与进度。
            </p>
            <div className="mt-2 flex gap-1.5">
              <Button
                size="touch"
                variant="danger"
                className="flex-1"
                disabled={toggleBusy}
                onClick={() => void disableLockNow()}
              >
                确认关闭
              </Button>
              <Button
                size="touch"
                variant="outline"
                className="flex-1"
                disabled={toggleBusy}
                onClick={() => setConfirmDisable(false)}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 自动锁定常驻可改（写进 prefs.autoLockMinutes），锁屏关闭时只是暂不生效 */}
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="pref-auto-lock" className="text-[13px] text-ink-soft">
            自动锁定
          </label>
          <Select
            id="pref-auto-lock"
            value={String(lock.autoLockMinutes)}
            onChange={(event) => void lock.setAutoLock(Number(event.target.value))}
            className="h-11 w-[124px]"
          >
            {AUTO_LOCK_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? "不自动锁" : `${minutes} 分钟`}
              </option>
            ))}
          </Select>
        </div>
        {lock.autoLockMinutes === 0 ? (
          <p className="text-[12px] leading-5 text-ink-mute">
            需手动锁定：关掉标签页，或用下面的「立即锁定」。
          </p>
        ) : (
          !lock.lockEnabled && (
            <p className="text-[12px] leading-5 text-ink-mute">
              开启上面的锁屏后，这个时长才会生效。
            </p>
          )
        )}

        {/* 用局域网 IP（http）打开时没有 WebCrypto，PIN 走纯 JS 的 PBKDF2，慢一个量级 */}
        {pinHashBackend() === "js" && (
          <p className="text-[12px] leading-5 text-ink-mute">
            当前不是安全上下文（用 IP 地址打开），PIN 哈希走兼容实现，设置时大约多花 0.2 秒。
          </p>
        )}

        {lock.lockEnabled && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="touch"
              className="flex-1"
              onClick={() => {
                setConfirmDisable(false);
                setPinNotice("");
                setPinError("");
                setPinMode("change");
              }}
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              修改 PIN
            </Button>
            <Button variant="outline" size="touch" className="flex-1" onClick={onLockNow}>
              <Lock className="h-4 w-4" aria-hidden="true" />
              立即锁定
            </Button>
          </div>
        )}

        {/* PIN 表单：旧 PIN（仅修改时）→ 新 PIN → 再次输入 */}
        {pinMode && (
          <form
            className="rounded-card border border-line bg-paper/60 px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPin();
            }}
          >
            <p className="text-[13px] font-medium text-ink">
              {pinMode === "change" ? "修改 PIN" : "设置 PIN"}
            </p>

            {pinMode === "change" && (
              <div className="mt-2">
                <label htmlFor="pin-old" className="text-[12px] text-ink-soft">
                  旧 PIN
                </label>
                <Input
                  id="pin-old"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={PIN_MAX}
                  value={oldPin}
                  onChange={(event) => {
                    setOldPin(digits(event.target.value));
                    setPinError("");
                  }}
                  className="mt-1 h-11 tracking-[0.4em] tnum"
                  placeholder="••••"
                />
              </div>
            )}

            <div className="mt-2">
              <label htmlFor="pin-new" className="text-[12px] text-ink-soft">
                新 PIN（{PIN_MIN}–{PIN_MAX} 位数字）
              </label>
              <Input
                id="pin-new"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={PIN_MAX}
                value={newPin}
                onChange={(event) => {
                  setNewPin(digits(event.target.value));
                  setPinError("");
                }}
                className="mt-1 h-11 tracking-[0.4em] tnum"
                placeholder="••••"
              />
            </div>

            <div className="mt-2">
              <label htmlFor="pin-confirm" className="text-[12px] text-ink-soft">
                再输入一次
              </label>
              <Input
                id="pin-confirm"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={PIN_MAX}
                value={confirmPin}
                onChange={(event) => {
                  setConfirmPin(digits(event.target.value));
                  setPinError("");
                }}
                className="mt-1 h-11 tracking-[0.4em] tnum"
                placeholder="••••"
              />
            </div>

            <p className="mt-1.5 min-h-[18px] text-[12px] leading-5 text-danger" role="alert">
              {pinError}
            </p>

            <div className="mt-1 flex gap-1.5">
              <Button type="submit" size="touch" className="flex-1" disabled={pinBusy}>
                {pinBusy ? "正在保存…" : "保存 PIN"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="flex-1"
                disabled={pinBusy}
                onClick={resetPinForm}
              >
                取消
              </Button>
            </div>
          </form>
        )}

        {pinNotice && (
          <p className="rounded-btn border border-brand/25 bg-brand-wash px-3 py-2 text-[12px] leading-5 text-brand-ink" role="status">
            {pinNotice}
          </p>
        )}

        <p className="text-[12px] leading-5 text-ink-mute">
          PIN 只是本机的隐私屏，学习数据不加密；忘记后重设 PIN 不会删除任何进度。
        </p>
      </section>
    </div>
  );
}

function digits(value: string): string {
  return value.replace(/\D/g, "").slice(0, PIN_MAX);
}

/** LockApi 未来暴露 verifyPin 时直接复用，避免两处校验口径漂移 */
type LockWithVerify = LockApi & { verifyPin?: (pin: string) => Promise<boolean> };

async function checkOldPinWith(lock: LockApi, pin: string): Promise<boolean> {
  const maybe = lock as LockWithVerify;
  if (typeof maybe.verifyPin === "function") return maybe.verifyPin(pin);
  const snapshot = await loadSnapshot();
  return verifyPin(pin, snapshot.meta.pinHash);
}
