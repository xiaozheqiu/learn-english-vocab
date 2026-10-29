import { useCallback, useEffect, useRef } from "react";

export interface ScrollKeeperApi<T extends HTMLElement> {
  /** 挂到滚动容器上（callback ref） */
  ref: (el: T | null) => void;
  /** 直接命令式地滚到顶部并重置记忆值（翻页 / 换筛选时用） */
  reset: () => void;
}

/**
 * 记住一个滚动容器的位置，在被隐藏再显示之后还原。
 *
 * 三处非显然的地方，都是实测踩出来的：
 *
 * 1. **用 callback ref，不用 `useRef` + `useEffect([])`**。这个滚动容器只在
 *    「词表加载完且非空态」时才渲染，首次 mount 时它还不存在；用 effect 挂监听
 *    会拿到 null 然后永远不重跑，监听实际没装在任何节点上，保存的位置恒为 0。
 * 2. **可见性由外部 `visible` 决定，不能读 `el.hidden`**。被隐藏的是面板那层祖先，
 *    容器自己的 `hidden` 一直是 false。
 * 3. **恢复后要压一帧屏蔽**。面板重新可见时浏览器会把位置夹到 0 并补发一次
 *    scroll 事件，不屏蔽它就会把刚写回去的位置抹成 0。
 */
export function useScrollKeeper<T extends HTMLElement = HTMLDivElement>(
  visible: boolean,
): ScrollKeeperApi<T> {
  const node = useRef<T | null>(null);
  const listener = useRef<(() => void) | null>(null);
  const saved = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  /** 恢复期间屏蔽采样，避免被补发的 scroll 事件覆盖 */
  const mute = useRef(false);

  const ref = useCallback((el: T | null) => {
    const previous = node.current;
    if (previous && listener.current) {
      previous.removeEventListener("scroll", listener.current);
      listener.current = null;
    }
    node.current = el;
    if (!el) return;
    const onScroll = () => {
      if (!visibleRef.current || mute.current) return;
      saved.current = el.scrollTop;
    };
    listener.current = onScroll;
    el.addEventListener("scroll", onScroll, { passive: true });
  }, []);

  const reset = useCallback(() => {
    saved.current = 0;
    const el = node.current;
    if (el) el.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (!visible) return;
    const el = node.current;
    if (!el) return;
    mute.current = true;
    // 放在 rAF 里：切回来的这一帧布局才刚就绪，scrollTop 要等它算完才写得进去
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = saved.current;
      window.requestAnimationFrame(() => {
        mute.current = false;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible]);

  return { ref, reset };
}
