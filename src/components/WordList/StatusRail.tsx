import { cn } from "@/lib/utils";
import type { StatusInfo } from "@/lib/types";

/**
 * 状态左栏（§1.5）：3px 竖条 + 文字标签。
 * 颜色之外还有文字，色觉障碍用户不依赖颜色即可判断。
 */
export function StatusRail({ status, className }: { status: StatusInfo; className?: string }) {
  return (
    <span
      className={cn("rail", status.rail, className)}
      data-status={status.kind}
      aria-hidden="true"
    />
  );
}

/**
 * 状态文字标签。
 *
 * 与左栏配合形成双重编码：左栏给形状与宽度，这里给文字与字重。
 * 字重刻意分三档（400 / 500 / 600）—— 「牢固」和「已掌握」都是绿色，
 * 只靠颜色分不开，字重是最省力的第二信号。
 */
export function StatusLabel({ status }: { status: StatusInfo }) {
  if (!status.label) return null;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-[12px] tnum",
        status.kind === "due" && "font-medium text-due",
        status.kind === "learning" && "text-ink-soft",
        status.kind === "solid" && "font-medium text-brand-ink",
        status.kind === "mastered" && "font-semibold text-brand-deep",
        status.kind === "leech" && "font-medium text-danger",
      )}
    >
      {status.label}
    </span>
  );
}
