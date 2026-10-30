/**
 * PWA 版本更新：前台时主动检查，发现新版本后**强制**让用户更新。
 *
 * 「当前可见页面」这个钩子在小程序里是 onShow，Web 里等价的是
 * Page Visibility API —— 独立窗口从后台切回来只触发 visibilitychange，
 * 不会触发 focus，所以两个都监听，成本极低。
 *
 * 前提：vite.config.js 的 registerType 必须是 "prompt"。
 * autoUpdate 会让新 SW 直接 skipWaiting + clientsClaim 顶掉旧壳，
 * 根本没有 waiting 状态，也就没有「发现新版本」这件事可以弹。
 *
 * 为什么不再给「稍后」：
 * needRefresh 为真意味着新 SW 已经**下载完成并在 waiting**，旧壳和旧分包仍在跑。
 * 让用户点掉提示继续用，等于默许他留在已知的旧版本上 —— 上一版删字段、改主键
 * 这类改动就是靠这个提示落地的，能关掉就等于可以一直不落地。
 * 所以提示是阻塞的，只有「立即更新」一条路。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/** 自动检查的最小间隔：切前后台很频繁，update() 不必每次都真发请求 */
const CHECK_INTERVAL_MS = 30_000;

/**
 * 手动检查时等「安装完成」的上限。
 *
 * reg.update() 只保证「检查过」，新 SW 可能还在 installing。要给出
 * 「已是最新」还是「发现新版」的结论，必须等它落到 waiting 或 retired。
 */
const MANUAL_WAIT_MS = 4_000;

/**
 * 点了「立即更新」之后，如果控制器迟迟没换过来，就认定卡住了。
 *
 * SW 激活本身是本地操作，正常几十毫秒内就该完成。超过这个时间说明
 * 这台浏览器上的接管流程出了问题（Safari 偶发），必须给一条出路，
 * 否则阻塞式弹框会把用户彻底锁死在旧页面上。
 */
const APPLY_STUCK_MS = 8_000;

/** 手动检查的结论；"checking" 是进行中 */
export type CheckResult = "idle" | "checking" | "latest" | "found" | "unsupported" | "error";

export interface PwaUpdate {
  /** 新版本已下载完成、正在 waiting。为真时提示不可关闭 */
  needRefresh: boolean;
  /** 「立即更新」已按下，等页面重载 */
  applying: boolean;
  /** 按下更新后迟迟没接管，提示用户手动刷新 */
  stuck: boolean;
  /** 手动检查是否在进行中 */
  checking: boolean;
  /** 手动检查的结论 */
  checkResult: CheckResult;
  /** 上次检查完成的时刻（ms），没查过是 null */
  lastCheckedAt: number | null;
  /** 用户手动触发检查（绕过自动检查的节流） */
  check: () => void;
  /** 让 waiting 的 SW 接管 */
  applyUpdate: () => void;
  /** 卡住时的出路：硬刷一次 */
  forceReload: () => void;
}

/**
 * 等 registration 落到 waiting（或判定没有新版）。
 * 已有 waiting 直接返回；正在 installing 就监听 statechange。
 */
function waitForUpdateReady(reg: ServiceWorkerRegistration, timeoutMs: number): Promise<boolean> {
  if (reg.waiting) return Promise.resolve(true);
  const installing = reg.installing;
  if (!installing || timeoutMs <= 0) return Promise.resolve(false);

  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      clearTimeout(timer);
      installing.removeEventListener("statechange", onState);
      resolve(value);
    };
    const onState = () => {
      if (installing.state === "installed") finish(true);
      else if (installing.state === "redundant") finish(false);
    };
    const timer = setTimeout(() => finish(Boolean(reg.waiting)), timeoutMs);
    installing.addEventListener("statechange", onState);
  });
}

export function usePwaUpdate(): PwaUpdate {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const lastCheck = useRef(0);
  const lastCheckedAt = useRef<number | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult>("idle");
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [stuck, setStuck] = useState(false);
  /** 「立即更新」已经按下的标记：只有这时 controllerchange 才该重载页面 */
  const applyingRef = useRef(false);
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

  /**
   * 问一次浏览器「有没有新版 SW」。
   *
   * silent：自动检查，不污染手动检查的结论展示。
   * 手动检查不看 CHECK_INTERVAL_MS 节流 —— 用户按了按钮就该真发请求，
   * 被 30 秒节流挡掉的表现是「点了没反应」。
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
    try {
      await reg.update();
    } catch {
      setChecking(false);
      setCheckResult("error");
      return;
    }
    const found = await waitForUpdateReady(reg, MANUAL_WAIT_MS);
    lastCheck.current = Date.now();
    lastCheckedAt.current = Date.now();
    setChecking(false);
    setCheckResult(found ? "found" : "latest");
  }, []);

  const check = useCallback(() => {
    void runCheck(false);
  }, [runCheck]);

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
      if (!applyingRef.current || reloaded.current) return;
      reloaded.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  /** 按下更新后开始计时，迟迟不接管就露出手动刷新这条出路 */
  useEffect(() => {
    if (!applying) return;
    const timer = setTimeout(() => setStuck(true), APPLY_STUCK_MS);
    return () => clearTimeout(timer);
  }, [applying]);

  const applyUpdate = useCallback(() => {
    applyingRef.current = true;
    setApplying(true);
    // 参数在 0.13.2+ 已废弃；重载由上面的 controllerchange 兜底
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  const forceReload = useCallback(() => {
    window.location.reload();
  }, []);

  return {
    needRefresh,
    applying,
    stuck,
    checking,
    checkResult,
    lastCheckedAt: lastCheckedAt.current,
    check,
    applyUpdate,
    forceReload,
  };
}
