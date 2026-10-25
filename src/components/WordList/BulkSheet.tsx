import { useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { DialogDescription, DialogTitle, Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useFloatingPosition } from "@/hooks/useFloatingPosition";
import { cn } from "@/lib/utils";
import type { BulkScope } from "@/hooks/useSelection";

export interface BulkSheetProps {
  /** 已选中的总条数（跨页保留） */
  selectedCount: number;
  /** 当前页条数 */
  pageCount: number;
  /** 当前筛选结果条数 */
  filteredCount: number;
  /** 选中项里不在当前筛选结果内的条数 */
  offFilterCount: number;
  scope: BulkScope;
  onScopeChange: (scope: BulkScope) => void;
  onSelectPage: () => void;
  onClearPage: () => void;
  onSelectFiltered: () => void;
  onInvert: () => void;
  onClear: () => void;
  onMarkMastered: () => void;
  onUnmarkMastered: () => void;
}

const BUTTON_SIZE = 52;

/**
 * 批量操作入口（§2.1 修订）：
 * 一个可拖动、松手贴边的圆形浮动按钮 + 点开后的抽屉。
 *
 * - 按钮只有图标（`ListChecks`），不再写「批量」两个字；
 *   已选条数以小红点角标表示，不撑开按钮宽度。
 * - 按住可以上下左右拖，松手自动贴到更近的那一侧竖边，位置记在 localStorage。
 * - 短按（<160ms 且没位移）才是打开抽屉，拖完那一下不会误触。
 */
export function BulkSheet({
  selectedCount,
  pageCount,
  filteredCount,
  offFilterCount,
  scope,
  onScopeChange,
  onSelectPage,
  onClearPage,
  onSelectFiltered,
  onInvert,
  onClear,
  onMarkMastered,
  onUnmarkMastered,
}: BulkSheetProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const isDesktop = useIsDesktop();
  const fab = useFloatingPosition(BUTTON_SIZE, BUTTON_SIZE);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // 抽屉里的按钮不是 Radix 的 DialogTrigger，焦点回位要自己兜
    if (!next) window.setTimeout(() => trigger.current?.focus(), 0);
  };

  const scopedTotal = scope === "page" ? pageCount : filteredCount;
  const scopeLabel = scope === "page" ? "本页" : "全部筛选结果";
  const nothingSelected = selectedCount === 0;

  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={trigger}
        data-testid="bulk-fab"
        type="button"
        aria-label={nothingSelected ? "批量操作" : `批量操作，已选 ${selectedCount} 条`}
        aria-haspopup="dialog"
        onClick={() => {
          if (fab.shouldIgnoreClick()) return;
          setOpen(true);
        }}
        {...fab.handlers}
        style={{
          ...(fab.pos ? { left: fab.pos.x, top: fab.pos.y, right: "auto", bottom: "auto" } : {}),
          // 整个按钮都不是滚动起点：否则手指刚按下就被浏览器判成滚页，拖动永远起不来
          touchAction: "none",
        }}
        className={cn(
          "fixed z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full border shadow-float select-none",
          "transition-[background-color,border-color,transform] duration-100",
          // 没拖过时：移动端浮在底部导航之上，桌面端抬高避开学面板胶囊
          "bottom-[calc(56px+env(safe-area-inset-bottom)+12px)] right-4 lg:bottom-24 lg:right-6",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          fab.dragging && "scale-105 cursor-grabbing",
          nothingSelected
            ? "border-line bg-card text-ink-soft hover:border-brand/40 hover:text-brand-ink"
            : "border-brand bg-brand text-white hover:bg-brand-ink",
        )}
      >
        <ListChecks className="h-5 w-5" aria-hidden="true" />
        {selectedCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-paper bg-due px-1 text-[10px] font-semibold leading-none text-white tnum"
          >
            {selectedCount > 99 ? "99+" : selectedCount}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-testid="bulk-sheet"
          side={isDesktop ? "center" : "bottom"}
          className={cn(isDesktop && "max-w-sm")}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1">
            <DialogTitle className="text-[16px] font-semibold text-ink">批量操作</DialogTitle>
            <DialogDescription className="text-[12px] text-ink-mute tnum">
              已选 {selectedCount} 条
              {offFilterCount > 0 ? ` · ${offFilterCount} 条不在当前筛选内` : ""}
            </DialogDescription>

            <section className="mt-4" aria-labelledby="bulk-scope-title">
              <h3 id="bulk-scope-title" className="text-[13px] font-medium text-ink">
                作用域
              </h3>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="group" aria-label="批量作用域">
                {(
                  [
                    ["page", "本页", pageCount],
                    ["filtered", "全部筛选结果", filteredCount],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={scope === value}
                    onClick={() => onScopeChange(value)}
                    className={cn(
                      "flex min-h-11 flex-wrap items-center justify-center gap-1 rounded-btn border px-2 py-1.5 text-[13px] leading-tight transition-colors",
                      scope === value
                        ? "border-brand bg-brand-wash font-medium text-brand-ink"
                        : "border-line bg-card text-ink-soft hover:border-brand/40",
                    )}
                  >
                    {label}
                    <span className="text-[11px] text-ink-mute tnum">{count} 条</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="mt-4" aria-labelledby="bulk-mark-title">
              <h3 id="bulk-mark-title" className="text-[13px] font-medium text-ink">
                标记
              </h3>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <Button
                  data-testid="bulk-mark"
                  size="touch"
                  disabled={nothingSelected}
                  onClick={run(onMarkMastered)}
                >
                  标记已掌握
                </Button>
                <Button
                  data-testid="bulk-unmark"
                  size="touch"
                  variant="outline"
                  disabled={nothingSelected}
                  onClick={run(onUnmarkMastered)}
                >
                  取消已掌握
                </Button>
              </div>
            </section>

            {/*
              全选 / 反选 / 取消 / 清空。
              之前收在 <details> 里默认折叠，结果「全选」成了需要先点两层才摸得到的动作 ——
              而这恰恰是这个抽屉最主要的用途。现在直接平铺。
            */}
            <section className="mt-4" aria-labelledby="bulk-pick-title">
              <h3 id="bulk-pick-title" className="text-[13px] font-medium text-ink">
                选择
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Button
                  size="touch"
                  variant="outline"
                  disabled={scopedTotal === 0}
                  onClick={run(scope === "page" ? onSelectPage : onSelectFiltered)}
                >
                  全选{scopeLabel}
                </Button>
                <Button
                  size="touch"
                  variant="outline"
                  disabled={scope === "filtered" || pageCount === 0}
                  onClick={run(onClearPage)}
                >
                  取消本页勾选
                </Button>
                <Button
                  size="touch"
                  variant="outline"
                  disabled={scopedTotal === 0}
                  onClick={run(onInvert)}
                >
                  反选{scopeLabel}
                </Button>
                <Button
                  size="touch"
                  variant="outline"
                  disabled={nothingSelected}
                  onClick={run(onClear)}
                >
                  清空全部
                </Button>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-ink-mute tnum">
                {nothingSelected
                  ? `也可以直接点表格左侧的勾选框。全选${scopeLabel}会一次选中 ${scopedTotal} 条。`
                  : `当前选中 ${selectedCount} 条，标记只作用于选中项。`}
              </p>
            </section>

            <div className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-ink-mute">
              <Checkbox
                checked
                disabled
                aria-hidden="true"
                tabIndex={-1}
                className="mt-0.5 opacity-60"
              />
              <span>勾选框只用于批量操作，不代表「已掌握」；掌握状态看每行右侧的按钮。</span>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
