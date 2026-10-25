/**
 * PWA 版本更新：前台时主动检查，发现新版本交给页面弹框让用户手动更新。
 *
 * 「当前可见页面」这个钩子在小程序里是 onShow，Web 里等价的是
 * Page Visibility API —— 独立窗口从后台切回来只触发 visibilitychange，
 * 不会触发 focus，所以两个都监听，成本极低。
 *
 * 前提：vite.config.js 的 registerType 必须是 "prompt"。
 * autoUpdate 会让新 SW 直接 skipWaiting + clientsClaim 顶掉旧壳，
 * 根本没有 waiting 状态，也就没有「发现新版本」这件事可以弹。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/** 两次主动检查的最小间隔：切前后台很频繁，update() 不必每次都真发请求 */
const CHECK_INTERVAL_MS = 30_000;

export interface PwaUpdate {
  /** 新版本已下载完成、正在 waiting，等用户确认 */
  needRefresh: boolean;
  /** 「立即更新」：让 waiting 的 SW 接管，随后由 workbox-window 重载页面 */
  applyUpdate: () => void;
  /** 「稍后」：本次会话不再打扰；下次打开时新 SW 仍会自行生效 */
  dismiss: () => void;
}

export function usePwaUpdate(): PwaUpdate {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const lastCheck = useRef(0);
  const [dismissed, setDismissed] = useState(false);
  /** 「立即更新」已经按下的标记：只有这时 controllerchange 才该重载页面 */
  const applying = useRef(false);
  const reloaded = useRef(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, reg) {
      registration.current = reg;
    },
  });

  /** 主动问一次浏览器「有没有新版 SW」，有的话它会在后台下载并进入 waiting */
  const check = useCallback(() => {
    const reg = registration.current;
    if (!reg) return;
    const now = Date.now();
    if (now - lastCheck.current < CHECK_INTERVAL_MS) return;
    lastCheck.current = now;
    // 断网时 update() 会 reject，这是正常路径，不打扰用户
    void reg.update().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [check]);

  /**
   * 自己接管「点完更新后重载页面」，不能指望 workbox-window。
   *
   * 它的 deciding 逻辑是 `isUpdate = Boolean(controller)`，而这个值在
   * register() 那一刻就固化了。本次会话如果是**首次安装**（打开时还没有
   * controller），后续任何一次接管都会被判成「非更新」，于是它只发
   * controllerchange 不重载 —— 真机上表现为：点了立即更新，新 SW 已
   * activated，页面却还是旧版，弹框也挂着不走。
   *
   * 所以：只有用户按过「立即更新」才重载，且只重载一次。
   * 首次安装时的自动接管（clientsClaim）不会重载，那是期望行为。
   */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onControllerChange = () => {
      if (!applying.current || reloaded.current) return;
      reloaded.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  const applyUpdate = useCallback(() => {
    applying.current = true;
    // 参数在 0.13.2+ 已废弃；重载由上面的 controllerchange 兜底
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  /**
   * 只翻 dismissed，不动插件的 needRefresh。
   * 效果是「本次会话不再提示」：用户点稍后说明他现在不想被打断，
   * 而新 SW 已经下载好了，下次冷启动自然会用上，不需要再问第二遍。
   */
  const dismiss = useCallback(() => setDismissed(true), []);

  return { needRefresh: needRefresh && !dismissed, applyUpdate, dismiss };
}
