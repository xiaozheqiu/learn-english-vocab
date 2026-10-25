import { BookOpen, Search, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  title: string;
  onSearch?: () => void;
  onOpenPanel: () => void;
  /** 有到期待复习时显示角标 */
  dueCount?: number;
  onOpenGuide?: () => void;
  memoryMode?: boolean;
}

/**
 * 顶栏（§2.1）：标题 + 搜索 + 浮窗入口。
 * 浮窗入口固定在顶栏右侧，不做悬浮球（会压住列表且难点）。
 */
export function TopBar({
  title,
  onSearch,
  onOpenPanel,
  dueCount = 0,
  onOpenGuide,
  memoryMode,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
      <div className="flex h-12 items-center gap-1 px-2">
        <h1 className="flex min-w-0 flex-1 items-baseline gap-2 pl-1">
          <span className="truncate text-[20px] font-semibold leading-tight text-ink">{title}</span>
        </h1>

        {dueCount > 0 && (
          <span
            className="mr-0.5 hidden rounded-full bg-due-wash px-2 py-0.5 text-[11px] font-medium text-due tnum sm:inline"
            aria-label={`${dueCount} 条待复习`}
          >
            待复习 {dueCount}
          </span>
        )}

        {onSearch && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={onSearch}
            aria-label="搜索"
            title="搜索（/）"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        {onOpenGuide && (
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-10 w-10 sm:flex"
            onClick={onOpenGuide}
            aria-label="词性对照表"
            title="词性对照表"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-10 w-10", dueCount > 0 && "text-brand-ink")}
          onClick={onOpenPanel}
          aria-label="打开学习面板"
          title="学习面板"
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {memoryMode && (
        <p
          className="border-t border-due/25 bg-due-wash px-3 py-1.5 text-[12px] text-due"
          role="status"
        >
          浏览器禁止本地存储，本次进度不会保存
        </p>
      )}
    </header>
  );
}
