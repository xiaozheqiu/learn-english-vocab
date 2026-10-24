import { useEffect, useRef, useState, type ReactNode } from "react";
import { PageActiveProvider } from "@/hooks/usePageActive";

export interface TabPaneProps {
  /** 该 tab 是否是当前选中的那个 */
  active: boolean;
  children: ReactNode;
}

/**
 * 常驻页面容器（§2.1 修订）。
 *
 * 为什么不再按路由卸载：切到「测试」再切回来会重新抽一套题、复习进度归零、
 * 词表的筛选和页码也一起丢掉 —— 用户会觉得自己被踢回了首页。
 * 所以三个主页面第一次进入后一直挂着，只用 hidden 控制显隐；
 * 每个面板自己是一个滚动容器，滚动位置天然按页保留，不需要记 window.scrollY。
 *
 * 懒挂载：没进过的页面不渲染，避免一进 App 就白抽一套题、白建一队复习卡。
 */
export function TabPane({ active, children }: TabPaneProps) {
  const [mounted, setMounted] = useState(active);
  const ref = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);

  useEffect(() => {
    if (active) setMounted(true);
  }, [active]);

  const visible = active && mounted;

  // 滚动位置存在 ref 里，只在这个面板可见时采样。
  // 判断 el.hidden 是必须的：面板一隐藏，浏览器会把滚动位置夹到 0 并补发一次 scroll 事件，
  // 不挡掉这次事件就会把「刚才看到第几行」覆盖成 0。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (el.hidden) return;
      scrollTop.current = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [mounted]);

  useEffect(() => {
    if (!visible) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = scrollTop.current;
  }, [visible]);

  return (
    <PageActiveProvider value={visible}>
      <div
        ref={ref}
        hidden={!visible}
        className="h-full overflow-y-auto overscroll-contain pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-8"
      >
        {mounted ? children : null}
      </div>
    </PageActiveProvider>
  );
}
