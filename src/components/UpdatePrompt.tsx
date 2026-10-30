import { Loader2, RefreshCw } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/sheet";
import type { PwaUpdate } from "@/hooks/usePwaUpdate";

export interface UpdatePromptProps {
  update: PwaUpdate;
}

/**
 * 更新中的遮罩（§4.1 强制更新）。
 *
 * 不提供任何按钮 —— 这是「已经决定要换版、正在重载」的瞬时状态，
 * 不是询问。它存在的唯一理由是别让自动重载看起来像崩溃：
 * 没有这一帧，用户看到的是页面毫无征兆地白一下再回来。
 *
 * 关不掉是刻意的：重置时它上面的一切交互都没有意义（页面马上就没）。
 */
export function UpdatePrompt({ update }: UpdatePromptProps) {
  return (
    <Dialog open={update.reloading}>
      <SheetContent
        side="center"
        hideClose
        className="max-w-xs p-5"
        aria-labelledby="update-title"
        aria-describedby="update-desc"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand-ink"
            aria-hidden="true"
          >
            <RefreshCw className="h-4 w-4 animate-spin" />
          </span>
          <div className="min-w-0">
            <DialogTitle id="update-title" className="text-[15px] font-semibold text-ink">
              正在更新到新版本
            </DialogTitle>
            <DialogDescription
              id="update-desc"
              className="mt-1 flex items-center gap-1.5 text-[12px] leading-5 text-ink-soft"
            >
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
              页面马上会自己刷新，已掌握的标记不受影响。
            </DialogDescription>
          </div>
        </div>
      </SheetContent>
    </Dialog>
  );
}
