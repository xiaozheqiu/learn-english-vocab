import { RefreshCw } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { PwaUpdate } from "@/hooks/usePwaUpdate";

export interface UpdatePromptProps {
  update: PwaUpdate;
}

/**
 * 新版本提示（§4.1 静默升级的显式出口）。
 *
 * 只在「新 SW 已下载完成、停在 waiting」时出现，所以点「立即更新」
 * 不需要等网络，重载后直接就是新版。
 *
 * 不做成 toast：更新会重载页面，这个动作必须是用户明确按下的，
 * 滑动误触或自动消失都不合适。
 */
export function UpdatePrompt({ update }: UpdatePromptProps) {
  return (
    <Dialog open={update.needRefresh} onOpenChange={(open) => !open && update.dismiss()}>
      <SheetContent
        side="center"
        hideClose
        className="max-w-xs p-5"
        aria-labelledby="update-title"
        aria-describedby="update-desc"
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand-ink"
            aria-hidden="true"
          >
            <RefreshCw className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <DialogTitle id="update-title" className="text-[15px] font-semibold text-ink">
              有新版本
            </DialogTitle>
            <DialogDescription
              id="update-desc"
              className="mt-1 text-[12px] leading-5 text-ink-soft"
            >
              新版本已经下载好了。更新会重新加载页面，正在做的题会重新开始。
            </DialogDescription>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="touch" className="flex-1" onClick={update.dismiss}>
            稍后
          </Button>
          <Button size="touch" className="flex-1" onClick={update.applyUpdate} autoFocus>
            立即更新
          </Button>
        </div>
      </SheetContent>
    </Dialog>
  );
}
