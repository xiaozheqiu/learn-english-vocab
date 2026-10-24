import * as React from "react";
import { cn } from "@/lib/utils";

/** 原生 range：键盘可达、移动端手势原生，样式用 accent-color 对齐品牌绿 */
export const Slider = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      className={cn(
        "h-11 w-full cursor-pointer bg-transparent accent-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        className,
      )}
      {...props}
    />
  ),
);
Slider.displayName = "Slider";
