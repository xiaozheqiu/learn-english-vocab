/**
 * PWA 版本更新：强制更新 —— 新版装好即接管，页面自己刷新，没有「稍后」。
 *
 * 为什么是强制而不是提示：
 * 这个应用的更新是数据契约级别的（裁字段、改主键、改搜索口径），让用户留在
 * 旧壳上有实际后果。而「发现新版 → 弹框 → 用户点确认」那条链路已经被证明
 * 可以被无限推掉（上一版给了「稍后」，点掉即继续用旧代码）。所以选物理上
 * 不留旧版：vite.config.js 里 registerType 是 "autoUpdate"，workbox 的
 * skipWaiting / clientsClaim 都开着，新 SW 装好立刻激活并接管。
 *
 * 重要（vite-plugin-pwa 2.x 的实际行为，别按直觉写）：
 * autoUpdate 模式下 onNeedRefresh 根本不会被调用，needRefresh 恒为 false，
 * updateServiceWorker() 也是空操作（它内部是 `if (!auto) sendSkipWaitingMessage()`）。
 * 唯一可用的接管点是 onNeedReload —— 插件在 activated 且 isUpdate 时调它，
 * 否则自己直接 location.reload()。这里劫持它，只为了在重载前先画一帧
 * 「正在更新」，不然用户会以为页面崩了。
 *
 * 前后台切换这个钩子在小程序里是 onShow，Web 里等价的是 Page Visibility API ——
 * 独立窗口从后台切回来只触发 visibilitychange，不触发 focus，所以两个都监听。
 * 它是「始终跑最新版」的保证：浏览器只在导航时主动查 sw.js，
 * 长时间挂着不动的标签页得靠这里催。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/** 自动检查的最小间隔：切前后台很频繁，update() 不必每次都真发请求 */
const CHECK_INTERVAL_MS = 30_000;

/**
 * 手动检查时等「有没有新 SW 开始安装」的上限。
 *
 * reg.update() 只保证「检查过」。要区分「已是最新」和「发现了新版」，
 * 得等浏览器触发 updatefound —— 正常几百毫秒内就到，4 秒是留给慢网的余量。
 */
const MANUAL_WAIT_MS = 4_000;

/** 手动检查的结论；"checking" 是进行中 */
export type CheckResult = "idle" | "checking" | "latest" | "found" | "unsupported" | "error";

export interface PwaUpdate {
  /** 已确定要换到新版，正在重载（用来先画一帧提示，避免像崩溃） */
  reloading: boolean;
  /** 手动检查是否在进行中 */
  checking: boolean;
  /** 手动检查的结论 */
  checkResult: CheckResult;
  /** 上次检查完成的时刻（ms），没查过是 null */
  lastCheckedAt: number | null;
  /** 用户手动触发检查（绕过自动检查的节流） */
  check: () => void;
}

export function usePwaUpdate(): PwaUpdate {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const lastCheck = useRef(0);
  const [reloading, setReloading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult>("idle");
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  /**
   * 劫持插件的自动重载，只为了先让「正在更新」画出来。
   *
   * 双 rAF 是必须的：单次 setState 之后立刻 reload，React 还没来得及提交、
   * 浏览器也没绘制，用户看到的就是一次白屏闪烁。等两帧再走，遮罩已经上屏。
   */
  const onNeedReload = useCallback(() => {
    setReloading(true);
    requestAnimationFrame(() => requestAnimationFrame(() => window.location.reload()));
  }, []);

  useRegisterSW({
    immediate: true,
    onNeedReload,
    onRegisteredSW(_swUrl, reg) {
      registration.current = reg;
    },
  });

  /**
   * 问一次浏览器「有没有新版 SW」。
   *
   * silent：自动检查，受 CHECK_INTERVAL_MS 节流，也不改结论展示。
   * 手动检查不吃节流 —— 用户按了按钮就该真发请求，被 30 秒节流挡掉的
   * 表现是「点了没反应」。
   */
  const runCheck = useCallback(async (silent: boolean) => {
    const reg = registration.current;
    if (!reg) {
      if (!silent) {
        setChecking(false);
        setCheckResult("unsupported");
      }
      return;
    }

    if (silent) {
      const now = Date.now();
      if (now - lastCheck.current < CHECK_INTERVAL_MS) return;
      lastCheck.current = now;
      // 断网时 update() 会 reject，这是正常路径，不打扰用户
      await reg.update().catch(() => undefined);
      return;
    }

    setChecking(true);
    setCheckResult("checking");

    /**
     * 用 updatefound 判断「有没有新版」，不能等 waiting ——
     * autoUpdate 下新 SW 装好就立刻活化，waiting 这个状态根本不存在。
     */
    let sawUpdate = false;
    const onUpdateFound = () => {
      sawUpdate = true;
    };
    reg.addEventListener("updatefound", onUpdateFound);

    try {
      await reg.update();
    } catch {
      reg.removeEventListener("updatefound", onUpdateFound);
      setChecking(false);
      setCheckResult("error");
      return;
    }

    // 没立刻看到 updatefound 就给慢网留一会儿；看到了就不必再等
    if (!sawUpdate) {
      await new Promise((resolve) => setTimeout(resolve, MANUAL_WAIT_MS));
    }
    reg.removeEventListener("updatefound", onUpdateFound);

    lastCheck.current = Date.now();
    setLastCheckedAt(Date.now());
    setChecking(false);
    setCheckResult(sawUpdate ? "found" : "latest");
  }, []);

  /** 自动检查：切回前台就催一次，保证长时间挂着的标签页也会换到新版 */
  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === "visible") void runCheck(true);
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [runCheck]);

  const check = useCallback(() => {
    void runCheck(false);
  }, [runCheck]);

  return { reloading, checking, checkResult, lastCheckedAt, check };
}
