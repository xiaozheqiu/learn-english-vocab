import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
/** 与 Dialog 同义；抽屉/弹窗统一叫 Sheet 更贴近用法 */
export const Sheet = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
/** 同义的 Sheet 命名，供抽屉式调用点使用 */
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

/**
 * 移动端 = 底部抽屉（max-h 85vh，顶部拖拽条，遮罩点击关闭，Esc 关闭，焦点锁定由 Radix 负责）
 * 桌面端同组件但居中弹出的小窗，由调用方选择 side。
 */
export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: "bottom" | "right" | "center";
    hideClose?: boolean;
  }
>(({ className, children, side = "bottom", hideClose, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-ink/35 backdrop-blur-[1px]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
      )}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col border-line bg-card shadow-float",
        "data-[state=open]:animate-in data-[state=closed]:animate-out duration-200",
        side === "bottom" &&
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
        side === "center" &&
          "left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
        side === "right" &&
          "bottom-0 right-0 h-full w-full max-w-sm border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
        className,
      )}
      {...props}
    >
      {side === "bottom" && (
        <div className="flex justify-center py-2.5" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-line" />
        </div>
      )}
      {!hideClose && (
        <DialogPrimitive.Close
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-mute transition-colors hover:bg-brand-wash hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
          aria-label="关闭"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      )}
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";
