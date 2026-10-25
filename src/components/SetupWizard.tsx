import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PinDots } from "@/components/ui/pin-dots";
import { LEVELS, type LevelFilter } from "@/lib/types";
import { explainPinError, isValidPin, PIN_LENGTH } from "@/lib/lock";
import { cn } from "@/lib/utils";

export interface SetupWizardProps {
  onDone: (options: {
    pin: string | null;
    remember: boolean;
    level: LevelFilter;

  }) => Promise<void>;
}

const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: "A1", label: "A1 入门" },
  { value: "A2", label: "A2 基础" },
  { value: "B1", label: "B1 进阶" },
  { value: "B2", label: "B2 高阶" },
  { value: "C1", label: "C1 精通" },
  { value: "ALL", label: "全部等级" },
];

/** 首次设置（§4.2）：设 PIN + 选默认等级 + 每日新词上限 */
export function SetupWizard({ onDone }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [skipPin, setSkipPin] = useState(false);
  const [remember, setRemember] = useState(true);
  const [level, setLevel] = useState<LevelFilter>("A1");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pinOk = isValidPin(pin) && pin === confirm;

  const next = async () => {
    setError("");
    if (step === 0) {
      if (!skipPin) {
        if (!isValidPin(pin)) {
          setError(`PIN 需为 ${PIN_LENGTH} 位数字`);
          return;
        }
        if (pin !== confirm) {
          setError("两次输入不一致");
          return;
        }
      }
      setStep(1);
      return;
    }
    setBusy(true);
    try {
      await onDone({
        pin: skipPin ? null : pin,
        remember: remember && !skipPin,
        level,
      });
    } catch (err) {
      setError(explainPinError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper">
      <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 py-8">
        <div className="flex items-center gap-2 text-[12px] text-ink-mute tnum">
          <span className={cn(step === 0 && "text-brand-ink")}>1 访问密码</span>
          <span aria-hidden="true">·</span>
          <span className={cn(step === 1 && "text-brand-ink")}>2 学习偏好</span>
        </div>

        <h1 className="word-serif mt-4 text-[24px] font-semibold leading-tight text-ink">
          {step === 0 ? "先给这台设备加一道屏" : "设定学习节奏"}
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-soft">
          {step === 0
            ? "纯本机锁屏，只挡住随手拿起你手机的人。学习数据不会被加密，忘记 PIN 也能直接重设。"
            : "之后都能在浮窗里改。"}
        </p>

        {step === 0 ? (
          <div className="mt-6 space-y-4">
            {/* 定长 6 位：圆点固定 6 个，两栏输入都填满才能进下一步 */}
            <PinDots total={PIN_LENGTH} filled={pin.length} />
            <div>
              <label htmlFor="setup-pin" className="text-[13px] font-medium text-ink">
                设置 PIN（{PIN_LENGTH} 位数字）
              </label>
              <Input
                id="setup-pin"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={PIN_LENGTH}
                value={pin}
                disabled={skipPin}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH));
                  setError("");
                }}
                placeholder="••••••"
                className="mt-1.5 h-11 text-lg tracking-[0.4em]"
              />
            </div>
            <div>
              <label htmlFor="setup-pin2" className="text-[13px] font-medium text-ink">
                再输入一次
              </label>
              <Input
                id="setup-pin2"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={PIN_LENGTH}
                value={confirm}
                disabled={skipPin}
                onChange={(event) => {
                  setConfirm(event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH));
                  setError("");
                }}
                placeholder="••••••"
                className="mt-1.5 h-11 text-lg tracking-[0.4em]"
              />
            </div>

            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--brand)]"
                checked={remember}
                disabled={skipPin}
                onChange={(event) => setRemember(event.target.checked)}
              />
              记住本设备 7 天
            </label>

            <button
              type="button"
              onClick={() => {
                setSkipPin((v) => !v);
                setPin("");
                setConfirm("");
                setError("");
              }}
              className="text-[13px] text-brand-ink underline underline-offset-4 hover:text-brand"
            >
              {skipPin ? "还是设一个 PIN" : "暂不设置"}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <fieldset>
              <legend className="text-[13px] font-medium text-ink">默认从哪个等级开始</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {LEVEL_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setLevel(option.value)}
                    aria-pressed={level === option.value}
                    className={cn(
                      "flex min-h-11 items-center justify-between rounded-btn border px-3 text-[13px] transition-colors",
                      level === option.value
                        ? "border-brand bg-brand-wash font-medium text-brand-ink"
                        : "border-line bg-card text-ink-soft hover:border-brand/40",
                    )}
                  >
                    {option.label}
                    {level === option.value && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] text-ink-mute">
                共 {LEVELS.length} 个等级；可选「全部」后按需加载。
              </p>
            </fieldset>

            <p className="rounded-btn border border-line bg-paper px-3 py-2.5 text-[12px] leading-5 text-ink-soft">
              每天学几个不用现在定：复习时按当天的状态学就行，学多少算多少。
            </p>
          </div>
        )}

        <p className="mt-3 min-h-[18px] text-[12px] text-danger" role="alert">
          {error}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-6">
          {step === 1 && (
            <Button variant="outline" size="lg" onClick={() => setStep(0)} disabled={busy}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              上一步
            </Button>
          )}
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void next()}
            disabled={busy || (step === 0 && !skipPin && !pinOk)}
          >
            {step === 0 ? "下一步" : busy ? "正在保存…" : "开始背单词"}
            {step === 0 ? (
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Lock className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
