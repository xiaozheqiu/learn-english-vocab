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
 * 为什么不再按路由卸载：切到词性对照再切回来，词表的筛选、页码与搜索词会一起丢掉
 * —— 用户会觉得自己被踢回了首页。
 * 所以主页面第一次进入后一直挂着，只用 hidden 控制显隐；
 * 每个面板自己是一个滚动容器，滚动位置天然按页保留，不需要记 window.scrollY。
 *
 * 布局约定：外壳是全屏 flex 列（顶栏 + main + 底栏都不滚动），
 * 这里 `min-h-0 flex-1` 负责吃掉剩余高度，滚动只发生在面板内部。
 * 也就是说顶栏与底栏天然固定，中间那一段才是滚动的。
 *
 * 懒挂载：没进过的页面不渲染，词性对照要等真正点进去才解析 Markdown。
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
        className="h-full min-h-0 overflow-y-auto overscroll-contain"
      >
        {mounted ? children : null}
      </div>
    </PageActiveProvider>
  );
}
