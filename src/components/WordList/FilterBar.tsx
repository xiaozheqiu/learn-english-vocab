import { useEffect, useRef, useState } from "react";
import { ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogTitle, Sheet, SheetContent, SheetDescription } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { LEVELS, PAGE_SIZES, type LevelFilter, type MasteryFilter, type PageSize } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  level: LevelFilter;
  mode: MasteryFilter;
  /** 偏好里的默认等级：和它一致时按钮显示「筛选」而不是一条默认条件 */
  defaultLevel: LevelFilter;
  query: string;
  pageSize: PageSize;
  total: number;
  onLevel: (level: LevelFilter) => void;
  onMode: (mode: MasteryFilter) => void;
  onQuery: (query: string) => void;
  onPageSize: (size: PageSize) => void;
}

const MODES: { value: MasteryFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "todo", label: "未掌握" },
  { value: "done", label: "已掌握" },
];

/**
 * 筛选条（§2.1 修订）。
 *
 * 旧版在移动端把等级与掌握状态展开成两行 select，撑开列表把下面的内容顶下去，
 * 点一下筛选整页都抖。现在条件全部收进底部抽屉：条上只留「筛选」按钮 + 搜索框，
 * 高度恒定；抽屉滑上来盖住列表而不是挤它。按钮上直接印当前条件，收起也能看出在筛什么。
 */
export function FilterBar({
  level,
  mode,
  defaultLevel,
  query,
  pageSize,
  total,
  onLevel,
  onMode,
  onQuery,
  onPageSize,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const isDesktop = useIsDesktop();

  // 抽屉里的按钮不在 Radix 的 Trigger 里，关闭后把焦点还给「筛选」按钮
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) window.setTimeout(() => trigger.current?.focus(), 0);
  };

  // 「/」聚焦搜索：搜索框常驻在条上，这条快捷键不依赖抽屉开合
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const levelLabel = level === "ALL" ? "全部等级" : level;
  const modeLabel = MODES.find((item) => item.value === mode)?.label ?? "全部";
  // 「有筛选」只算用户主动加的：把默认等级也算进去的话，一进 App 按钮就自带高亮
  const filtered = level !== defaultLevel || mode !== "all";

  return (
    <section aria-label="词表筛选" className="border-b border-line bg-card/80">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Button
          ref={trigger}
          variant="outline"
          size="sm"
          className={cn("h-9 shrink-0 gap-1.5", filtered && "border-brand/50 text-brand-ink")}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="max-w-[7.5rem] truncate">
            {filtered ? `${levelLabel} · ${modeLabel}` : "筛选"}
          </span>
          {filtered && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          )}
        </Button>

        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute"
            aria-hidden="true"
          />
          <label className="sr-only" htmlFor="word-search">
            搜索单词或释义
          </label>
          <Input
            id="word-search"
            ref={input}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索单词或释义"
            className="h-9 pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="清空搜索"
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-mute hover:bg-brand-wash hover:text-ink"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isDesktop ? "center" : "bottom"}
          className={cn(isDesktop && "max-w-sm")}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1">
            <DialogTitle className="text-[16px] font-semibold text-ink">筛选</DialogTitle>
            <SheetDescription className="text-[12px] text-ink-mute tnum">
              当前 {total} 条
            </SheetDescription>

            <section className="mt-4" aria-labelledby="filter-level-title">
              <h3 id="filter-level-title" className="text-[13px] font-medium text-ink">
                等级
              </h3>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {[
                  ...LEVELS.map((item) => ({ value: item as LevelFilter, label: item })),
                  { value: "ALL" as LevelFilter, label: "全部" },
                ].map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={level === item.value ? "subtle" : "outline"}
                    aria-pressed={level === item.value}
                    onClick={() => onLevel(item.value)}
                    className={cn("w-full", level === item.value && "border-brand/40 font-medium")}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>

            <section className="mt-4" aria-labelledby="filter-mode-title">
              <h3 id="filter-mode-title" className="text-[13px] font-medium text-ink">
                掌握状态
              </h3>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {MODES.map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={mode === item.value ? "subtle" : "outline"}
                    aria-pressed={mode === item.value}
                    onClick={() => onMode(item.value)}
                    className={cn("w-full", mode === item.value && "border-brand/40 font-medium")}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>

            <section className="mt-4" aria-labelledby="filter-size-title">
              <h3 id="filter-size-title" className="text-[13px] font-medium text-ink">
                每页条数
              </h3>
              <div className="mt-1.5 grid grid-cols-5 gap-1.5">
                {PAGE_SIZES.map((size) => (
                  <Button
                    key={size}
                    size="touch"
                    variant={pageSize === size ? "subtle" : "outline"}
                    aria-pressed={pageSize === size}
                    onClick={() => onPageSize(size)}
                    className={cn("w-full px-0 tnum", pageSize === size && "border-brand/40 font-medium")}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </section>

            <div className="mt-5 flex gap-2">
              <Button
                size="touch"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  onLevel("ALL");
                  onMode("all");
                }}
              >
                清空筛选
              </Button>
              <Button size="touch" className="flex-1" onClick={() => setOpen(false)}>
                完成
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
