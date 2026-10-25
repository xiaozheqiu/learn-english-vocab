import { useCallback, useEffect, useState } from "react";
import { Delete, ArrowLeft, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PinDots } from "@/components/ui/pin-dots";
import { explainPinError, isValidPin, MAX_ATTEMPTS, PIN_LENGTH } from "@/lib/lock";
import { cn } from "@/lib/utils";

type Mode = "unlock" | "reset";
/** 重置 PIN 的两步：设新 PIN → 再输一次 */
type ResetStage = "first" | "confirm";

export interface LockScreenProps {
  onUnlock: (pin: string, remember: boolean) => Promise<"ok" | "wrong" | "locked">;
  onReset: (pin: string) => Promise<void>;
  lockoutLeft: number;
  failures: number;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "空", "0", "删"];

/**
 * PIN 锁屏（§4.2）：自建 3×4 数字键盘，不用系统 input，避免自动填充与键盘跳动。
 *
 * PIN 定长 6 位（`PIN_LENGTH`），所以圆点永远是 6 个、键盘最多收 6 位、
 * 输满第 6 位自动校验——三者由同一个常量推导，不可能再出现
 * 「输入的位数和圆点总数对不上」这种漂移。桌面端支持实体键盘与回车提交。
 */
export function LockScreen({ onUnlock, onReset, lockoutLeft, failures }: LockScreenProps) {
  const [mode, setMode] = useState<Mode>("unlock");
  const [resetStage, setResetStage] = useState<ResetStage>("first");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const locked = lockoutLeft > 0;
  /** 当前正在输入的那一串：重置第二步看 confirm，其余都看 pin */
  const typed = mode === "reset" && resetStage === "confirm" ? confirm : pin;

  const triggerShake = useCallback(() => {
    setShake(true);
    window.setTimeout(() => setShake(false), 340);
  }, []);

  const submit = useCallback(async () => {
    if (busy || locked) return;

    if (mode === "unlock") {
      if (!isValidPin(pin)) {
        setError(`PIN 是 ${PIN_LENGTH} 位数字`);
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
    if (resetStage === "first") {
      if (!isValidPin(pin)) {
        setError(`新 PIN 需为 ${PIN_LENGTH} 位数字`);
        triggerShake();
        return;
      }
      setConfirm("");
      setError("");
      setResetStage("confirm");
      return;
    }
    if (confirm.length < PIN_LENGTH) {
      setError(`请再输满 ${PIN_LENGTH} 位`);
      triggerShake();
      return;
    }
    if (pin !== confirm) {
      setError("两次输入不一致，请重新设置");
      setPin("");
      setConfirm("");
      setResetStage("first");
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
  }, [busy, confirm, locked, mode, onReset, onUnlock, pin, remember, resetStage, triggerShake]);

  // 输满 6 位自动提交，不用再点按钮
  useEffect(() => {
    if (busy || locked) return;
    if (typed.length !== PIN_LENGTH) return;
    void submit();
  }, [busy, locked, submit, typed.length]);

  const press = useCallback(
    (key: string) => {
      if (locked || busy) return;
      if (key === "删") {
        if (typed.length === 0) {
          // 确认阶段删空 → 回到「设新 PIN」，不必从解锁页重来
          if (mode === "reset" && resetStage === "confirm") {
            setResetStage("first");
            setError("");
          }
          return;
        }
        if (mode === "reset" && resetStage === "confirm") setConfirm((v) => v.slice(0, -1));
        else setPin((v) => v.slice(0, -1));
        setError("");
        return;
      }
      if (key === "空") return;
      if (typed.length >= PIN_LENGTH) return;
      if (mode === "reset" && resetStage === "confirm") setConfirm((v) => v + key);
      else setPin((v) => v + key);
      setError("");
    },
    [busy, locked, mode, resetStage, typed.length],
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

  const title =
    mode === "unlock" ? "输入 PIN" : resetStage === "first" ? "重置访问密码" : "再输入一次";
  const hint =
    mode === "unlock"
      ? `本机隐私锁屏 · ${PIN_LENGTH} 位数字`
      : resetStage === "first"
        ? `直接设置新的 ${PIN_LENGTH} 位 PIN`
        : "再输一次确认";

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper px-6 py-10">
      <div className={cn("w-full max-w-[320px]", shake && "animate-shake")}>
        <div className="text-center">
          <h1 className="word-serif text-[22px] font-semibold text-ink">{title}</h1>
          <p className="mt-1.5 text-[13px] leading-6 text-ink-soft">{hint}</p>
        </div>

        {/* 圆点：固定 6 个，填满即校验 */}
        <PinDots total={PIN_LENGTH} filled={typed.length} className="mt-7" />

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
          disabled={locked || busy || typed.length < PIN_LENGTH}
        >
          {mode === "unlock" ? "解锁" : resetStage === "first" ? "下一步" : "保存新 PIN"}
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
              setResetStage("first");
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
