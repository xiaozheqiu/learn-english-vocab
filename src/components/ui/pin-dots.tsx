import { cn } from "@/lib/utils";

export interface PinDotsProps {
  /** 一共画几个圆点：已设位数（固定）或当前输入位数 */
  total: number;
  /** 已经填了几个 */
  filled: number;
  className?: string;
}

/**
 * PIN 圆点指示（锁屏与首次设置共用）。
 *
 * `total` 是这一屏的**位数口径**，不是「已输入几个」——
 * 之前锁屏把两者混成一个「跟着输入增长」的数字，导致输入的位数和圆点总数对不上。
 */
export function PinDots({ total, filled, className }: PinDotsProps) {
  const dots = Math.max(0, total);
  return (
    <div
      className={cn("flex items-center justify-center gap-3", className)}
      role="status"
      aria-live="polite"
      aria-label={`已输入 ${filled} 位，共 ${dots} 位`}
    >
      {Array.from({ length: dots }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "h-3 w-3 rounded-full border transition-colors",
            index < filled ? "border-brand bg-brand" : "border-ink-mute/50 bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
