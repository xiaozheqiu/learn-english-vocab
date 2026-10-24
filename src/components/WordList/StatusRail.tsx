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

export function StatusLabel({ status }: { status: StatusInfo }) {
  if (!status.label) return null;
  return (
    <span
      className={cn(
        "whitespace-nowrap text-[12px] tnum",
        status.kind === "due" && "text-due",
        status.kind === "learning" && "text-ink-soft",
        status.kind === "solid" && "text-brand-ink",
        status.kind === "mastered" && "font-medium text-brand-deep",
      )}
    >
      {status.label}
    </span>
  );
}
