import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronUp, Minimize2, Settings2, X } from "lucide-react";
import { Dialog, DialogClose, DialogDescription, DialogTitle, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AboutSection } from "./sections/AboutSection";
import { DataSection } from "./sections/DataSection";
import { LearnSection } from "./sections/LearnSection";
import { SettingsSection } from "./sections/SettingsSection";
import type { FloatingPanelProps as FloatingPanelContract } from "@/components/contracts";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "learn", label: "学习" },
  { value: "data", label: "数据" },
  { value: "settings", label: "设置" },
  { value: "about", label: "关于" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

/**
 * 契约（contracts.ts）已包含 open / onOpenChange / store / stats / lock /
 * onLockNow / canInstall / onInstall / onOpenGuide / onGoQuiz / today。
 *
 * 「批量」分区已挪回词表页右下角的浮动按钮（BulkSheet）：
 * 同一份批量动作只留一个入口，浮窗不再重复列一遍全选/反选。
 */
export type FloatingPanelProps = FloatingPanelContract;

/**
 * 浮窗（§2.3）：统一内容，两种外壳。
 * - 移动端：底部抽屉（Sheet side="bottom"，max-h 85vh，内容区独立滚动）
 * - 桌面端：右下悬浮卡（380px，可最小化成「待复习 N」胶囊）
 *
 * Esc 关闭、关闭后焦点回到触发元素、浮层外背景 aria-hidden 全部由 Radix Dialog 处理。
 */
export function FloatingPanel({
  open,
  onOpenChange,
  store,
  stats,
  lock,
  onLockNow,
  canInstall,
  onInstall,
  onOpenGuide,
  onGoQuiz,
  today,
}: FloatingPanelProps) {
  const isDesktop = useIsDesktop();
  const [minimized, setMinimized] = useState(false);
  const capsuleRef = useRef<HTMLButtonElement>(null);
  // 收起成胶囊会卸载 Tabs，受控保存当前分区，展开后还停在原处
  const [tab, setTab] = useState<TabValue>("learn");

  // 每次重新打开都回到完整卡片；关闭时也清掉最小化，避免下次打开还是胶囊
  useEffect(() => {
    if (!open) setMinimized(false);
  }, [open]);

  // 收起后焦点不能掉到 body：落在胶囊上，键盘用户继续可用
  useEffect(() => {
    if (minimized) capsuleRef.current?.focus();
  }, [minimized]);

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

  const goQuiz = useCallback(() => {
    onOpenChange(false);
    onGoQuiz();
  }, [onGoQuiz, onOpenChange]);

  // 桌面端最小化：收起成胶囊，点它再展开
  if (isDesktop && open && minimized) {
    return (
      <button
        ref={capsuleRef}
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-6 right-6 z-40 flex min-h-11 items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-[13px] font-medium text-ink shadow-float transition-colors hover:border-brand/40 hover:bg-brand-wash hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        aria-label={`展开学习面板，待复习 ${stats.dueToday} 条`}
      >
        <ChevronUp className="h-4 w-4 text-ink-mute" aria-hidden="true" />
        <span className="tnum">待复习 {stats.dueToday}</span>
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent
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
              <Settings2 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              {/* id / aria-labelledby 交给 Radix 生成，避免和外层 aria-labelledby 打架 */}
              <DialogTitle className="text-[14px] font-semibold text-ink">
                学习面板
              </DialogTitle>
              <DialogDescription className="truncate text-[11px] text-ink-mute tnum">
                今日复习 {stats.todayReviewed} · 待复习 {stats.dueToday} · 连续 {stats.streak} 天
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
                aria-label="关闭学习面板"
                title="关闭（Esc）"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DialogClose>
          </header>

          <Tabs
            value={tab}
            onValueChange={(next) => setTab(next as TabValue)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList aria-label="学习面板分区" className="shrink-0 px-2">
              {TABS.map((item) => (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className="min-h-11 flex-1 px-2 sm:flex-none"
                >
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* 内容区独立滚动；底部留 safe-area，避免被 iPhone 手势条压住 */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
              <TabsContent value="learn" className="space-y-3">
                <LearnSection
                  stats={stats}
                  prefs={store.prefs}
                  today={today}
                  onPrefsChange={(patch) => void store.setPrefs(patch)}
                />
                <Button variant="ghost" size="touch" className="w-full" onClick={goQuiz}>
                  去测试练错词
                </Button>
              </TabsContent>

              <TabsContent value="data">
                <DataSection
                  store={store}
                  canInstall={canInstall}
                  onInstall={onInstall}
                  memoryMode={store.memoryMode}
                />
              </TabsContent>

              <TabsContent value="settings">
                <SettingsSection
                  prefs={store.prefs}
                  setPrefs={store.setPrefs}
                  lock={lock}
                  onLockNow={onLockNow}
                />
              </TabsContent>

              <TabsContent value="about">
                <AboutSection onOpenGuide={openGuide} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </SheetContent>
    </Dialog>
  );
}

export type { TabValue };
