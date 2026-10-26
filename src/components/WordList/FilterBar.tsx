import { useEffect, useRef, useState } from "react";
import { ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogTitle, Sheet, SheetContent, SheetDescription } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
  LEVELS,
  PAGE_SIZES,
  type LevelFilter,
  type MasteryFilter,
  type PageSize,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** 抽屉里「确定」要一次提交的一整套条件 */
export interface FilterDraft {
  level: LevelFilter;
  mode: MasteryFilter;
  pageSize: PageSize;
}

export interface FilterBarProps {
  /** 已生效的等级（列表正在用的，不是抽屉里临时选的） */
  level: LevelFilter;
  mode: MasteryFilter;
  /** 偏好里的默认等级：和它一致时按钮显示「筛选」而不是一条默认条件 */
  defaultLevel: LevelFilter;
  query: string;
  pageSize: PageSize;
  /** 按「草稿条件」预览条数，确定之前列表不动 */
  countFor: (level: LevelFilter, mode: MasteryFilter) => number;
  onQuery: (query: string) => void;
  /** 只有点「确定」才会走到这里 */
  onApply: (next: FilterDraft) => void;
}

const MODES: { value: MasteryFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "todo", label: "未掌握" },
  { value: "done", label: "已掌握" },
];

/**
 * 筛选条（§2.1 修订 / §2.3 确定后生效）。
 *
 * 旧版在移动端把等级与掌握状态展开成两行 select，撑开列表把下面的内容顶下去，
 * 点一下筛选整页都抖。现在条件全部收进底部抽屉：条上只留「筛选」按钮 + 搜索框，
 * 高度恒定；抽屉滑上来盖住列表而不是挤它。按钮上直接印当前条件，收起也能看出在筛什么。
 *
 * 抽屉里是**草稿**：点等级、点掌握状态、改每页条数都只改抽屉自己的预览，
 * 列表一行动都不动。只有点「确定」才把草稿提交上去；点关闭 / 按 Esc / 点遮罩
 * 一律丢弃草稿，列表保持原样。之前点一下立刻改数据，用户选到一半就已经被筛掉了，
 * 连「先看看有哪些选项」都做不到。
 */
export function FilterBar({
  level,
  mode,
  defaultLevel,
  query,
  pageSize,
  countFor,
  onQuery,
  onApply,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterDraft>({ level, mode, pageSize });
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const isDesktop = useIsDesktop();

  // 每次打开都从「当前生效的条件」起稿，关上时丢弃草稿的语义才成立
  const onOpenChange = (next: boolean) => {
    if (next) setDraft({ level, mode, pageSize });
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
  // 草稿和已生效不同：抽屉里提示一句，免得以为已经生效了
  const pending = draft.level !== level || draft.mode !== mode || draft.pageSize !== pageSize;
  const draftTotal = countFor(draft.level, draft.mode);

  return (
    <section aria-label="词表筛选" className="border-b border-line bg-card/80">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Button
          ref={trigger}
          data-testid="filter-trigger"
          variant="outline"
          size="sm"
          className={cn("h-9 shrink-0 gap-1.5", filtered && "border-brand/50 text-brand-ink")}
          onClick={() => onOpenChange(true)}
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
          data-testid="filter-sheet"
          side={isDesktop ? "center" : "bottom"}
          className={cn(isDesktop && "max-w-sm")}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1">
            <DialogTitle className="text-[16px] font-semibold text-ink">筛选</DialogTitle>
            <SheetDescription
              data-testid="filter-preview"
              data-count={draftTotal}
              data-pending={pending ? "1" : "0"}
              className="text-[12px] text-ink-mute tnum"
            >
              {pending ? `按当前选择会剩 ${draftTotal} 条 · 点确定生效` : `当前 ${draftTotal} 条`}
            </SheetDescription>

            <section className="mt-4" aria-labelledby="filter-level-title">
              <h3 id="filter-level-title" className="text-[13px] font-medium text-ink">
                等级
              </h3>
              <div
                data-testid="filter-level"
                role="group"
                aria-labelledby="filter-level-title"
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {[
                  ...LEVELS.map((item) => ({ value: item as LevelFilter, label: item })),
                  { value: "ALL" as LevelFilter, label: "全部" },
                ].map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.level === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.level === item.value}
                    onClick={() => setDraft((current) => ({ ...current, level: item.value }))}
                    className={cn(
                      "w-full",
                      draft.level === item.value && "border-brand/40 font-medium",
                    )}
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
              <div
                data-testid="filter-mode"
                role="group"
                aria-labelledby="filter-mode-title"
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {MODES.map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.mode === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.mode === item.value}
                    onClick={() => setDraft((current) => ({ ...current, mode: item.value }))}
                    className={cn(
                      "w-full",
                      draft.mode === item.value && "border-brand/40 font-medium",
                    )}
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
              <div
                data-testid="filter-size"
                role="group"
                aria-labelledby="filter-size-title"
                className="mt-1.5 grid grid-cols-5 gap-1.5"
              >
                {PAGE_SIZES.map((size) => (
                  <Button
                    key={size}
                    size="touch"
                    variant={draft.pageSize === size ? "subtle" : "outline"}
                    aria-pressed={draft.pageSize === size}
                    onClick={() => setDraft((current) => ({ ...current, pageSize: size }))}
                    className={cn(
                      "w-full px-0 tnum",
                      draft.pageSize === size && "border-brand/40 font-medium",
                    )}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </section>

            <div className="mt-5 flex gap-2">
              <Button
                data-testid="filter-reset"
                size="touch"
                variant="outline"
                className="flex-1"
                // 只清草稿：和「确定」一起构成完整动作，清空也不即时生效
                onClick={() =>
                  setDraft((current) => ({ level: "ALL", mode: "all", pageSize: current.pageSize }))
                }
              >
                清空筛选
              </Button>
              <Button
                data-testid="filter-done"
                size="touch"
                className="flex-1"
                onClick={() => {
                  onApply(draft);
                  setOpen(false);
                }}
              >
                确定
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
