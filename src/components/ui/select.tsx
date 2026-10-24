import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** 原生 select：移动端能唤起系统选择器，可访问性最好，不额外造轮子 */
export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => (
    <div className="relative inline-flex">
      <select
        ref={ref}
        className={cn(
          "h-9 w-full appearance-none rounded-btn border border-line bg-card pl-2.5 pr-7 text-[13px] font-medium text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
        aria-hidden="true"
      />
    </div>
  ),
);
Select.displayName = "Select";
