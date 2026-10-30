import { useCallback, useEffect, useState } from "react";
import { Info, Minimize2, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
  SheetContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AboutSection } from "./sections/AboutSection";
import type { FloatingPanelProps as FloatingPanelContract } from "@/components/contracts";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

export type FloatingPanelProps = FloatingPanelContract;

/**
 * 关于浮窗：统一内容，两种外壳。
 * - 移动端：底部抽屉（Sheet side="bottom"，max-h 85vh，内容区独立滚动）
 * - 桌面端：右下悬浮卡（380px，可最小化成「关于」胶囊）
 *
 * Esc 关闭、关闭后焦点回到触发元素、浮层外背景 aria-hidden 全部由 Radix Dialog 处理。
 *
 * **为什么只剩一页**：这个应用现在只有词表这一个功能 —— 所有筛选都在词表的
 * 筛选抽屉里（等级 / 档位 / 牛津 / 词性 / 首字母 / 掌握状态 / 每页条数）。
 * 面板里原本的「设置」只是把每页条数重复了一遍，另加一个默认等级；
 * 「数据」分区的导出 / 导入 / 清空三件套在单人本机词表里没有用户。
 * 两者都移除，面板退化成单纯一张「关于」；顶栏图标也从齿轮换成信息图标 ——
 * 齿轮会让用户以为里面还藏着一堆要配的东西。
 *
 * 留下的动作只有三个，都是「看完就想点一下」的类型：
 * 打开词性对照表、检查更新、安装到桌面。
 */
export function FloatingPanel({
  open,
  onOpenChange,
  store,
  canInstall,
  onInstall,
  onOpenGuide,
  update,
}: FloatingPanelProps) {
  const isDesktop = useIsDesktop();
  const [minimized, setMinimized] = useState(false);

  // 每次重新打开都回到完整卡片；关闭时也清掉最小化，避免下次打开还是胶囊
  useEffect(() => {
    if (!open) setMinimized(false);
  }, [open]);

  // 最小化时 Radix 已卸载，Esc 自己兜住（焦点回位仍由 App 处理）
  useEffect(() => {
    if (!minimized || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [minimized, onOpenChange, open]);

  // 先关面板再交给 App 跳转：浮层仍开着时切页会把它压在新页面上
  const openGuide = useCallback(() => {
    onOpenChange(false);
    onOpenGuide();
  }, [onOpenChange, onOpenGuide]);

  // 桌面端最小化：收起成胶囊，点它再展开
  if (isDesktop && open && minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-40 flex min-h-11 items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-[13px] font-medium text-ink shadow-float transition-colors hover:border-brand/40 hover:bg-brand-wash hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        aria-label="展开关于"
      >
        <span>关于</span>
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-testid="about-sheet"
        side={isDesktop ? "center" : "bottom"}
        hideClose
        className={cn(
          // 移动端：底部抽屉高度上限（safe-area 由内容区兜住）
          "max-h-[85vh]",
          // 桌面端：把居中小窗改成正下悬浮卡 380px
          isDesktop &&
            "lg:left-auto lg:right-6 lg:top-auto lg:bottom-6 lg:max-h-[calc(100dvh-3rem)] lg:w-[380px] lg:max-w-[380px] lg:translate-x-0 lg:translate-y-0 lg:rounded-card",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand-ink"
              aria-hidden="true"
            >
              <Info className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              {/* id / aria-labelledby 交给 Radix 生成，避免和外层 aria-labelledby 打架 */}
              <DialogTitle className="text-[14px] font-semibold text-ink">关于</DialogTitle>
              <DialogDescription className="truncate text-[11px] text-ink-mute tnum">
                已掌握 {store.mastered.size} 个 · 全库 {store.words.length} 条
              </DialogDescription>
            </div>

            {isDesktop && (
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                onClick={() => setMinimized(true)}
                aria-label="最小化为胶囊"
                title="最小化"
              >
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label="关闭关于"
                title="关闭（Esc）"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DialogClose>
          </header>

          {/* 内容区独立滚动；底部留 safe-area，避免被 iPhone 手势条压住 */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
            <AboutSection
              onOpenGuide={openGuide}
              canInstall={canInstall}
              onInstall={onInstall}
              update={update}
            />
          </div>
        </div>
      </SheetContent>
    </Dialog>
  );
}
