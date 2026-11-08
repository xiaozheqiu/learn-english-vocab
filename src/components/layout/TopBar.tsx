import { BookOpen, Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TopBarProps {
  title: string;
  onSearch?: () => void;
  onOpenAbout: () => void;
  onOpenGuide?: () => void;
  memoryMode?: boolean;
  /**
   * 启动超时：本机进度没读完就进了主界面。
   *
   * 「正在读取本机进度…」原本是个没有出口的界面 —— 初始化链上任何一步不返回，
   * 用户就永远看不到东西。现在超时会直接放进主界面，但必须说明白「进度可能没读全」，
   * 否则用户会以为自己的标记丢了。
   */
  bootTimeout?: boolean;
  /**
   * 云端正在同步。
   *
   * 没有这条提示时，「登录后等十几秒」看起来就是「点了没反应」—— 用户会去
   * 刷新页面，而刷新恰好重走一遍流程、此时数据已到位，于是误以为「只有刷新
   * 才生效」。慢网络下这是必然撞见的场景，所以要把「在干活」显示出来。
   */
  syncing?: boolean;
  /** 同步失败的简短原因；只有出错时才占一行 */
  syncError?: string;
}

/**
 * 顶栏（§2.1）：标题 + 搜索 + 「关于」入口。
 * 入口固定在顶栏右侧，不做悬浮球（会压住列表且难点）。
 *
 * 图标是信息「i」而不是齿轮：面板里只剩一张关于页，没有可配置项了。
 * 齿轮会让人点开找设置，然后发现无处可设。
 */
export function TopBar({
  title,
  onSearch,
  onOpenAbout,
  onOpenGuide,
  memoryMode,
  bootTimeout,
  syncing,
  syncError,
}: TopBarProps) {
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

      {bootTimeout && (
        <p
          className="border-t border-due/25 bg-due-wash px-3 py-1.5 text-[12px] text-due"
          role="status"
          data-testid="top-boot-timeout"
        >
          本机进度读取超时，先让你进来用；关掉其它标签页后刷新可恢复
        </p>
      )}

      {memoryMode && (
        <p
          className="border-t border-due/25 bg-due-wash px-3 py-1.5 text-[12px] text-due"
          role="status"
        >
          浏览器禁止本地存储，本次进度不会保存
        </p>
      )}

      {/* 同步中 / 同步失败都贴在顶栏：用户不用打开面板就知道数据在不在路上 */}
      {syncing && (
        <p
          className="border-t border-line px-3 py-1.5 text-[12px] text-ink-mute"
          role="status"
          aria-live="polite"
          data-testid="top-syncing"
        >
          正在与云端同步…
        </p>
      )}
      {!syncing && syncError && (
        <p
          className="border-t border-due/25 bg-due-wash px-3 py-1.5 text-[12px] text-due"
          role="status"
          data-testid="top-sync-error"
        >
          {syncError}
        </p>
      )}
    </header>
  );
}
