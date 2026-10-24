import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tnum",
  {
    variants: {
      variant: {
        default: "border-line bg-card text-ink-soft",
        brand: "border-brand/25 bg-brand-wash text-brand-ink",
        due: "border-due/30 bg-due-wash text-due",
        danger: "border-danger/25 bg-danger-wash text-danger",
        solid: "border-transparent bg-brand-deep text-white",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
