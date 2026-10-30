import { RefreshCw } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { PwaUpdate } from "@/hooks/usePwaUpdate";

export interface UpdatePromptProps {
  update: PwaUpdate;
}

/**
 * 新版本提示（§4.1）：**阻塞式**，只有「立即更新」一条路。
 *
 * 出现在「新 SW 已下载完成、停在 waiting」时，所以点更新不用等网络，
 * 重载后直接就是新版。
 *
 * 为什么没有「稍后」：
 * 提示为真的前提是新版已经躺在本地、只是没接管。允许关掉它，等于让用户
 * 继续跑已知的旧代码 —— 数据字段裁剪、主键调整这类改动就靠这次接管落地。
 * 所以遮罩点击、Esc、右上角关闭全部禁掉：这不是「提醒」，是必须走完的一步。
 *
 * 例外只给一种情况：按了更新却迟迟没接管（Safari 偶发），那时露出手动刷新，
 * 否则阻塞式弹框会把用户彻底锁死。
 */
export function UpdatePrompt({ update }: UpdatePromptProps) {
  const { needRefresh, applying, stuck, applyUpdate, forceReload } = update;

  return (
    <Dialog open={needRefresh}>
      <SheetContent
        side="center"
        hideClose
        className="max-w-xs p-5"
        aria-labelledby="update-title"
        aria-describedby="update-desc"
        // 三层都堵住：Esc、点遮罩、焦点移出。Radix 默认都会掉进 onOpenChange(false)
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          // 焦点必须落在更新按钮上：这个框关不掉，落在别处等于把人晾在这
          event.preventDefault();
        }}
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand-ink"
            aria-hidden="true"
          >
            <RefreshCw className={applying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </span>
          <div className="min-w-0">
            <DialogTitle id="update-title" className="text-[15px] font-semibold text-ink">
              {stuck ? "更新没有完成" : "需要更新到新版本"}
            </DialogTitle>
            <DialogDescription
              id="update-desc"
              className="mt-1 text-[12px] leading-5 text-ink-soft"
            >
              {stuck
                ? "新版本已经下载好，但接管没有完成。手动刷新一次即可用上新版。"
                : "新版本已经下载好了，必须更新后才能继续使用。更新会重新加载页面，本机已掌握的标记不受影响。"}
            </DialogDescription>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {stuck ? (
            <Button size="touch" className="flex-1" onClick={forceReload} autoFocus>
              手动刷新
            </Button>
          ) : (
            <Button
              size="touch"
              className="flex-1"
              onClick={applyUpdate}
              disabled={applying}
              autoFocus
            >
              {applying ? "正在更新…" : "立即更新"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Dialog>
  );
}
