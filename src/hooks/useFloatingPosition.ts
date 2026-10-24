/**
 * 可拖动、松手贴边的浮动按钮（§2.1 修订）。
 *
 * 交互按真机习惯来：
 * - 短按 = 点击（不触发拖动），按住 160ms 或按下后位移超过 6px 才算拖；
 * - 拖动中按钮跟手，整页不跟着滚（拖动时 touch-action: none）；
 * - 松手贴到更近的那一侧竖边，纵向位置保留，并夹在安全区内；
 * - 位置写 localStorage，下次进来还在原处；旋转屏幕 / 改窗口大小时重新夹一遍；
 * - 拖完的那一下不触发点击（否则拖到别处会顺手把抽屉打开）。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

const STORAGE_KEY = "ox5000-fab-pos-v1";
/** 按住多久算拖动意图 */
const LONG_PRESS_MS = 160;
/** 手指抖动容忍：超过位移即使没到长按时间也开始拖 */
const DRAG_SLOP = 6;
/** 与视口边缘的间距 */
const EDGE_GAP = 12;

export interface FloatingPoint {
  x: number;
  y: number;
}

function readStored(): FloatingPoint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingPoint>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x as number, y: parsed.y as number };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface FloatingPositionApi {
  /** 当前坐标；null = 还没拖过，用 CSS 里的默认停靠位置 */
  pos: FloatingPoint | null;
  /** 正在拖动（调用方据此放大 / 加强阴影） */
  dragging: boolean;
  /** 刚拖完这一下要吃掉随后的 click，否则拖到别处会顺手打开抽屉 */
  shouldIgnoreClick: () => boolean;
  /** 绑到浮动按钮上的一组事件 */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

interface DragState {
  id: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  /** 已进入拖动 */
  moved: boolean;
  timer: number | null;
}

/**
 * @param width 按钮宽度（用于算右侧贴边位置）
 * @param height 按钮高度
 */
export function useFloatingPosition(width: number, height: number): FloatingPositionApi {
  const [pos, setPos] = useState<FloatingPoint | null>(() => readStored());
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  /** 拖完的那一次 pointerup 之后要吃掉紧随其后的 click */
  const suppressClick = useRef(false);

  /** 夹进安全区，并贴到更近的竖边 */
  const snap = useCallback(
    (x: number, y: number): FloatingPoint => {
      const maxX = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
      const maxY = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
      const settledX = x + width / 2 < window.innerWidth / 2 ? EDGE_GAP : maxX;
      return { x: clamp(settledX, EDGE_GAP, maxX), y: clamp(y, EDGE_GAP, maxY) };
    },
    [height, width],
  );

  // 视口变化后重新贴边，避免拖到右边缘再转屏后按钮跑到屏幕外
  useEffect(() => {
    const onResize = () => {
      setPos((current) => (current ? snap(current.x, current.y) : current));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [snap]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
      timer: window.setTimeout(() => {
        // 长按成立：标记为可拖，真正跟手等第一次 move
        const state = drag.current;
        if (state) state.moved = true;
      }, LONG_PRESS_MS),
    };
    // 立刻捕获指针：拖动时指针必然离开这个小圆钮，
    // 不捕获的话后续 pointermove 会派发给下面的列表行而不是按钮。
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;

      if (!state.moved) {
        if (Math.hypot(dx, dy) <= DRAG_SLOP) return;
        state.moved = true;
        if (state.timer !== null) window.clearTimeout(state.timer);
      }
      if (!dragging) {
        setDragging(true);
        suppressClick.current = true;
      }

      const maxX = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
      const maxY = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
      setPos({
        x: clamp(state.originX + dx, EDGE_GAP, maxX),
        y: clamp(state.originY + dy, EDGE_GAP, maxY),
      });
    },
    [dragging, height, width],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = drag.current;
      drag.current = null;
      if (!state) return;
      if (state.timer !== null) window.clearTimeout(state.timer);
      if (!state.moved) return; // 短按：交给正常 click
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setDragging(false);
      setPos((current) => {
        if (!current) return current;
        const settled = snap(current.x, current.y);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(settled));
        } catch {
          /* 隐私模式忽略 */
        }
        return settled;
      });
      // 让紧随 pointerup 的 click 失效，避免「拖一下顺手打开抽屉」
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    },
    [snap],
  );

  return {
    pos,
    dragging,
    shouldIgnoreClick: () => suppressClick.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
