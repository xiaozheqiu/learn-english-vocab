import { useCallback, useEffect, useState } from "react";
import { Delete, ArrowLeft, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { explainPinError, isValidPin, MAX_ATTEMPTS, PIN_MAX, PIN_MIN } from "@/lib/lock";
import { cn } from "@/lib/utils";

type Mode = "unlock" | "reset";

export interface LockScreenProps {
  onUnlock: (pin: string, remember: boolean) => Promise<"ok" | "wrong" | "locked">;
  onReset: (pin: string) => Promise<void>;
  lockoutLeft: number;
  failures: number;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "空", "0", "删"];

/**
 * PIN 锁屏（§4.2）：自建 3×4 数字键盘，不用系统 input，避免自动填充与键盘跳动。
 * 桌面端同样适用，支持实体键盘输入与回车提交。
 */
export function LockScreen({ onUnlock, onReset, lockoutLeft, failures }: LockScreenProps) {
  const [mode, setMode] = useState<Mode>("unlock");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const locked = lockoutLeft > 0;
  const target = mode === "unlock" ? PIN_MAX : PIN_MAX;
  const stage = mode === "reset" && confirm.length > 0 ? "confirm" : "first";
  const current = mode === "reset" && stage === "confirm" ? confirm : pin;

  const triggerShake = useCallback(() => {
    setShake(true);
    window.setTimeout(() => setShake(false), 340);
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;
    if (mode === "unlock") {
      if (pin.length < PIN_MIN) {
        setError("PIN 至少 4 位");
        triggerShake();
        return;
      }
      setBusy(true);
      try {
        const result = await onUnlock(pin, remember);
        if (result === "wrong") {
          setError("PIN 不正确");
          setPin("");
          triggerShake();
        } else if (result === "locked") {
          setError("尝试次数过多，请稍后再试");
          setPin("");
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    // reset：两步确认
    if (stage === "first") {
      if (!isValidPin(pin)) {
        setError(`PIN 需为 ${PIN_MIN}–${PIN_MAX} 位数字`);
        triggerShake();
        return;
      }
      setConfirm("");
      setError("");
      return;
    }
    if (pin !== confirm) {
      setError("两次输入不一致，请重新设置");
      setPin("");
      setConfirm("");
      triggerShake();
      return;
    }
    setBusy(true);
    try {
      await onReset(pin);
    } catch (err) {
      setError(explainPinError(err));
      triggerShake();
    } finally {
      setBusy(false);
    }
  }, [busy, confirm, mode, onReset, onUnlock, pin, remember, stage, triggerShake]);

  const press = useCallback(
    (key: string) => {
      if (locked || busy) return;
      if (key === "删") {
        if (current.length === 0 && mode === "reset" && stage === "confirm") {
          setConfirm("");
          setPin("");
          return;
        }
        if (mode === "reset" && stage === "confirm") setConfirm((v) => v.slice(0, -1));
        else setPin((v) => v.slice(0, -1));
        setError("");
        return;
      }
      if (key === "空") return;
      if (current.length >= target) return;
      if (mode === "reset" && stage === "confirm") setConfirm((v) => v + key);
      else setPin((v) => v + key);
      setError("");
    },
    [busy, current.length, locked, mode, stage, target],
  );

  // 实体键盘
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) {
        press(event.key);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        press("删");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, submit]);

  const dots = mode === "reset" && stage === "confirm" ? confirm : pin;

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper px-6 py-10">
      <div
        className={cn(
          "w-full max-w-[320px]",
          shake && "animate-shake",
        )}
      >
        <div className="text-center">
          <h1 className="word-serif text-[22px] font-semibold text-ink">
            {mode === "unlock" ? "输入 PIN" : "重置访问密码"}
          </h1>
          <p className="mt-1.5 text-[13px] leading-6 text-ink-soft">
            {mode === "unlock"
              ? "本机隐私锁屏，仅防止随手翻看"
              : stage === "first"
                ? "直接设置新 PIN"
                : "再输入一次确认"}
          </p>
        </div>

        {/* 圆点显示已输入位数 */}
        <div
          className="mt-7 flex items-center justify-center gap-3"
          role="status"
          aria-live="polite"
          aria-label={`已输入 ${dots.length} 位`}
        >
          {Array.from({ length: Math.max(PIN_MIN, dots.length) }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-3 w-3 rounded-full border transition-colors",
                index < dots.length
                  ? "border-brand bg-brand"
                  : "border-ink-mute/50 bg-transparent",
              )}
            />
          ))}
        </div>

        <p
          className={cn(
            "mt-3 min-h-[20px] text-center text-[12px]",
            error ? "text-danger" : "text-ink-mute",
          )}
          role="alert"
        >
          {locked
            ? `尝试次数过多，${Math.ceil(lockoutLeft / 1000)} 秒后可重试`
            : error ||
              (mode === "unlock" && failures > 0
                ? `还可尝试 ${MAX_ATTEMPTS - failures} 次`
                : "")}
        </p>

        {/* 3×4 数字键盘 */}
        <div className="mt-4 grid grid-cols-3 gap-3" aria-label="数字键盘">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              disabled={locked || busy || key === "空"}
              onClick={() => press(key)}
              aria-label={key === "删" ? "删除" : key === "空" ? undefined : key}
              tabIndex={key === "空" ? -1 : 0}
              className={cn(
                "flex h-[60px] items-center justify-center rounded-card border text-[20px] font-medium transition-colors",
                key === "空"
                  ? "cursor-default border-transparent"
                  : "border-line bg-card text-ink shadow-card active:bg-brand-wash disabled:opacity-40",
              )}
            >
              {key === "删" ? <Delete className="h-5 w-5" aria-hidden="true" /> : key}
            </button>
          ))}
        </div>

        <Button
          className="mt-4 w-full"
          size="lg"
          onClick={() => void submit()}
          disabled={locked || busy || dots.length < PIN_MIN}
        >
          {mode === "unlock" ? "解锁" : stage === "first" ? "下一步" : "保存新 PIN"}
        </Button>

        <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-center gap-2 text-[13px] text-ink-soft">
          <Checkbox
            checked={remember}
            onCheckedChange={(value) => setRemember(value === true)}
            aria-label="记住本设备 7 天"
          />
          记住本设备 7 天
        </label>

        <div className="mt-1 text-center">
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setMode(mode === "unlock" ? "reset" : "unlock");
              setPin("");
              setConfirm("");
              setError("");
            }}
          >
            {mode === "unlock" ? (
              <>
                <ShieldQuestion className="h-3.5 w-3.5" aria-hidden="true" />
                忘记 PIN？
              </>
            ) : (
              <>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                返回解锁
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
