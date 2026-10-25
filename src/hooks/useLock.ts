/**
 * 锁屏状态与自动锁定（§4 / §6 hooks/useLock.ts）
 *
 * 定位：纯前端隐私屏。数据未加密，重置 PIN 不会丢学习数据。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadSnapshot, saveMeta } from "@/lib/db";
import {
  clearGraceToken,
  clearUnlocked,
  createPinHash,
  graceTokenUsed,
  isUnlocked,
  isValidPin,
  lockoutRemaining,
  markUnlocked,
  rememberDevice,
  NO_ATTEMPTS,
  registerFailure,
  shouldAutoLock,
  touchActivity,
  verifyPin,
  type AttemptState,
} from "@/lib/lock";

export interface LockApi {
  /** 是否已加载完锁屏配置 */
  ready: boolean;
  lockEnabled: boolean;
  setupDone: boolean;
  unlocked: boolean;
  attempts: AttemptState;
  /** 完成首次设置 */
  completeSetup: (options: { pin: string | null; remember: boolean }) => Promise<void>;
  unlock: (pin: string, remember: boolean) => Promise<"ok" | "wrong" | "locked">;
  lockNow: () => void;
  /** 忘记 PIN：直接允许重设（学习数据未加密） */
  resetPin: (pin: string) => Promise<void>;
  disableLock: () => Promise<void>;
  setAutoLock: (minutes: number) => Promise<void>;
  autoLockMinutes: number;
  lockoutLeft: number;
}

export function useLock(): LockApi {
  const [ready, setReady] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(30);
  const [attempts, setAttempts] = useState<AttemptState>(NO_ATTEMPTS);
  const [lockoutLeft, setLockoutLeft] = useState(0);
  const storedPin = useRef<Awaited<ReturnType<typeof loadSnapshot>>["meta"]["pinHash"]>(null);

  // 启动时决定去 #/setup / #/lock / #/
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snapshot = await loadSnapshot();
        if (!alive) return;
        storedPin.current = snapshot.meta.pinHash;
        setAutoLockMinutes(snapshot.meta.prefs.autoLockMinutes);
        setSetupDone(snapshot.meta.setupDone);
        const enabled = snapshot.meta.lockEnabled && Boolean(snapshot.meta.pinHash);
        setLockEnabled(enabled);
        if (!enabled) {
          setUnlocked(true);
        } else if (isUnlocked() || graceTokenUsed(snapshot.meta.pinHash)) {
          setUnlocked(true);
          markUnlocked();
        } else {
          setUnlocked(false);
        }
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 锁定倒计时
  useEffect(() => {
    if (attempts.lockedUntil <= 0) {
      setLockoutLeft(0);
      return;
    }
    const tick = () => setLockoutLeft(lockoutRemaining(attempts));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [attempts]);

  // 自动锁定：定时检查 + 回到前台检查（§4.2）
  useEffect(() => {
    if (!lockEnabled || !unlocked) return;
    const check = () => {
      if (shouldAutoLock(autoLockMinutes)) {
        clearUnlocked();
        setUnlocked(false);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = window.setInterval(check, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", touchActivity, { passive: true });
    window.addEventListener("keydown", touchActivity);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", touchActivity);
      window.removeEventListener("keydown", touchActivity);
    };
  }, [autoLockMinutes, lockEnabled, unlocked]);

  const completeSetup = useCallback(
    async ({ pin, remember }: { pin: string | null; remember: boolean }) => {
      if (pin && !isValidPin(pin)) throw new Error("PIN 需为 6 位数字");
      if (!pin) {
        await saveMeta({
          lockEnabled: false,
          setupDone: true,
          pinHash: null,
          lockGraceUntil: null,
        });
        storedPin.current = null;
        setLockEnabled(false);
        setSetupDone(true);
        setUnlocked(true);
        return;
      }
      const pinHash = await createPinHash(pin);
      const until = remember ? Date.now() + 7 * 86_400_000 : null;
      await saveMeta({
        lockEnabled: true,
        setupDone: true,
        pinHash,
        lockGraceUntil: until,
      });
      storedPin.current = pinHash;
      setLockEnabled(true);
      setSetupDone(true);
      setUnlocked(true);
      markUnlocked();
    },
    [],
  );

  const unlock = useCallback(
    async (pin: string, remember: boolean) => {
      if (lockoutRemaining(attempts) > 0) return "locked";
      const ok = await verifyPin(pin, storedPin.current);
      if (!ok) {
        setAttempts((current) => registerFailure(current));
        return "wrong";
      }
      setAttempts(NO_ATTEMPTS);
      setUnlocked(true);
      markUnlocked();
      if (remember && storedPin.current) {
        const until = await rememberDevice(storedPin.current);
        await saveMeta({ lockGraceUntil: until });
      }
      return "ok";
    },
    [attempts],
  );

  const lockNow = useCallback(() => {
    if (!lockEnabled) return;
    clearUnlocked();
    setUnlocked(false);
  }, [lockEnabled]);

  const resetPin = useCallback(async (pin: string) => {
    if (!isValidPin(pin)) throw new Error("PIN 需为 6 位数字");
    const pinHash = await createPinHash(pin);
    await saveMeta({ pinHash, lockEnabled: true, lockGraceUntil: null });
    storedPin.current = pinHash;
    clearGraceToken();
    setAttempts(NO_ATTEMPTS);
    setLockEnabled(true);
    setUnlocked(true);
    markUnlocked();
  }, []);

  const disableLock = useCallback(async () => {
    await saveMeta({ lockEnabled: false, pinHash: null, lockGraceUntil: null });
    storedPin.current = null;
    clearGraceToken();
    setLockEnabled(false);
    setUnlocked(true);
  }, []);

  const setAutoLock = useCallback(async (minutes: number) => {
    setAutoLockMinutes(minutes);
    await saveMeta({ prefs: { ...(await loadSnapshot()).meta.prefs, autoLockMinutes: minutes } });
  }, []);

  return {
    ready,
    lockEnabled,
    setupDone,
    unlocked,
    attempts,
    lockoutLeft,
    autoLockMinutes,
    completeSetup,
    unlock,
    lockNow,
    resetPin,
    disableLock,
    setAutoLock,
  };
}
