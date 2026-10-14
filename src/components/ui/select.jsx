import * as React from "react";
import { cn } from "@/lib/utils";

const Select = React.forwardRef(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn("h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm outline-none transition-colors focus:ring-2 focus:ring-ring focus:ring-offset-1", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export { Select };
