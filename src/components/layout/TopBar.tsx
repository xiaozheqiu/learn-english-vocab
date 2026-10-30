import { BookOpen, Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TopBarProps {
  title: string;
  onSearch?: () => void;
  onOpenAbout: () => void;
  onOpenGuide?: () => void;
  memoryMode?: boolean;
}

/**
 * 顶栏（§2.1）：标题 + 搜索 + 「关于」入口。
 * 入口固定在顶栏右侧，不做悬浮球（会压住列表且难点）。
 *
 * 图标是信息「i」而不是齿轮：面板里只剩一张关于页，没有可配置项了。
 * 齿轮会让人点开找设置，然后发现无处可设。
 */
export function TopBar({ title, onSearch, onOpenAbout, onOpenGuide, memoryMode }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
      <div className="flex h-12 items-center gap-1 px-2">
        <h1 className="flex min-w-0 flex-1 items-baseline gap-2 pl-1">
          <span className="truncate text-[20px] font-semibold leading-tight text-ink">{title}</span>
        </h1>

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
            className="h-10 w-10"
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
          className="h-10 w-10"
          onClick={onOpenAbout}
          aria-label="关于"
          title="关于"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
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
