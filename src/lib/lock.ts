/**
 * PIN 哈希（PBKDF2）与解锁状态（§4 / §6 lib/lock.ts）
 *
 * 定位明确：这是纯前端隐私屏，不是访问控制。学习数据未加密，重置不会丢数据。
 * PIN 用 PBKDF2-SHA256（随机盐，100k 次）存哈希，不存明文。
 *
 * 两条实现路径，输出**逐字节一致**（同一 PIN 在哪条路径设的，另一条都能验证）：
 * 1. `crypto.subtle`（WebCrypto，浏览器原生，快）—— 仅安全上下文可用；
 * 2. 纯 JS 实现（`lib/sha256.ts`）—— 安全上下文之外（用局域网 IP 打开 http 页面）兜底。
 * 安全上下文 = https / localhost / 127.0.0.1 / file://。手机连同一 Wi-Fi 访问
 * http://192.168.x.x:5173 属于非安全上下文，`crypto.subtle` 是 undefined，
 * 2026-10-24 那次「设 PIN 报 importKey 找不到」就是这个原因。
 */
import { pbkdf2Sha256, toHex as toHexBytes } from "./sha256";
import type { PinHash } from "./types";

export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const PBKDF2_ITERATIONS = 100_000;
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 30_000;
export const REMEMBER_DAYS = 7;

const SESSION_KEY = "ox5000-unlocked-v1";
const GRACE_TOKEN_KEY = "ox5000-grace-token-v1";

/* ── 哈希 ─────────────────────────────────────────────────────── */

function toHex(buffer: ArrayBuffer): string {
  return toHexBytes(new Uint8Array(buffer));
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * 当前环境有没有 WebCrypto 的 `subtle`。
 * 注意 `crypto.getRandomValues` 在非安全上下文里仍然可用，只有 `subtle` 会消失，
 * 所以不能用 `"crypto" in window` 判断。
 */
export function hasWebCrypto(): boolean {
  return typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

/** 当前 PIN 哈希走哪条路径；设置页据此提示「用 IP 打开会慢一点」 */
export function pinHashBackend(): "webcrypto" | "js" {
  return hasWebCrypto() ? "webcrypto" : "js";
}

/** 测试可注入固定盐；生产环境走 crypto.getRandomValues */
export function randomSalt(bytes = 16, inject?: Uint8Array): string {
  if (inject) return toHex(inject.buffer as ArrayBuffer);
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buf);
  } else {
    // 极端兜底：连 getRandomValues 都没有的环境不假装是密码学随机，
    // 直接报错而不是静默退回 Math.random（那会悄悄降级成可预测的盐）。
    throw new Error("当前浏览器不支持安全随机数，无法设置 PIN");
  }
  return toHex(buf.buffer);
}

/**
 * PBKDF2-SHA256 → 32 字节十六进制。
 *
 * 优先 WebCrypto；没有 `crypto.subtle`（http 局域网）就走同算法的纯 JS 实现。
 * 两条路径的 salt / iterations / dkLen 完全相同，输出因此完全一致。
 */
export async function hashPin(
  pin: string,
  saltHex: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const encoder = new TextEncoder();
  const salt = fromHex(saltHex);

  if (hasWebCrypto()) {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(pin),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt as unknown as BufferSource,
        iterations,
        hash: "SHA-256",
      },
      key,
      256,
    );
    return toHex(bits);
  }

  // 非安全上下文：JS 实现，分片让出事件循环，避免设 PIN 时页面假死
  const derived = await pbkdf2Sha256(encoder.encode(pin), salt, iterations);
  return toHexBytes(derived);
}

export async function createPinHash(pin: string, iterations = PBKDF2_ITERATIONS): Promise<PinHash> {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt, iterations);
  return { salt, hash, iterations };
}

/** 定时安全比较：长度不同直接 false，避免早退泄露前缀 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPin(pin: string, stored: PinHash | null): Promise<boolean> {
  if (!stored) return false;
  const hash = await hashPin(pin, stored.salt, stored.iterations);
  return timingSafeEqual(hash, stored.hash);
}

/**
 * 把 PIN 相关异常翻成人话。
 *
 * 典型例子：`Cannot read properties of undefined (reading 'importKey')` ——
 * 这是非安全上下文（http + 局域网 IP）没有 `crypto.subtle` 的旧症状；
 * 现在已有纯 JS 兜底，真再看到这条就说明兜底也起不来，提示要给出可操作方向。
 */
export function explainPinError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/importKey|deriveBits|crypto\.subtle/i.test(raw)) {
    return "这台浏览器当前不允许 PIN 哈希运算（HTTP + IP 地址打开时常见），请换 localhost 或 https 打开。";
  }
  return raw || "设置失败";
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

/* ── 解锁状态（sessionStorage：同一标签页刷新不重复问）────────── */

export function markUnlocked(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  } catch {
    /* 隐私模式忽略 */
  }
}

export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearUnlocked(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

export function lastActivity(): number {
  try {
    return Number(sessionStorage.getItem(SESSION_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function touchActivity(): void {
  try {
    if (sessionStorage.getItem(SESSION_KEY) !== null) {
      sessionStorage.setItem(SESSION_KEY, String(Date.now()));
    }
  } catch {
    /* noop */
  }
}

export function shouldAutoLock(autoLockMinutes: number, now = Date.now()): boolean {
  if (autoLockMinutes <= 0) return false;
  const last = lastActivity();
  if (!last) return false;
  return now - last > autoLockMinutes * 60_000;
}

/* ── 「记住本设备 7 天」 ───────────────────────────────────────── */

/**
 * 存的是哈希 + 到期时间，不存 PIN 本身。
 * 令牌内容 = pinHash.hash 的前 16 位 —— 拿到它也无法反推 PIN。
 */
export async function rememberDevice(stored: PinHash): Promise<number> {
  const until = Date.now() + REMEMBER_DAYS * 86_400_000;
  const token = stored.hash.slice(0, 16);
  try {
    localStorage.setItem(GRACE_TOKEN_KEY, JSON.stringify({ token, until }));
  } catch {
    /* noop */
  }
  return until;
}

export function graceTokenUsed(stored: PinHash | null): boolean {
  if (!stored) return false;
  try {
    const raw = localStorage.getItem(GRACE_TOKEN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { token?: string; until?: number };
    if (!parsed.until || parsed.until < Date.now()) {
      localStorage.removeItem(GRACE_TOKEN_KEY);
      return false;
    }
    return timingSafeEqual(String(parsed.token ?? ""), stored.hash.slice(0, 16));
  } catch {
    return false;
  }
}

export function clearGraceToken(): void {
  try {
    localStorage.removeItem(GRACE_TOKEN_KEY);
  } catch {
    /* noop */
  }
}

/* ── 错次限制（纯前端计时）────────────────────────────────────── */

export interface AttemptState {
  failures: number;
  lockedUntil: number;
}

export const NO_ATTEMPTS: AttemptState = { failures: 0, lockedUntil: 0 };

export function registerFailure(
  state: AttemptState,
  now = Date.now(),
): AttemptState {
  const failures = state.failures + 1;
  if (failures >= MAX_ATTEMPTS) {
    return { failures: 0, lockedUntil: now + LOCKOUT_MS };
  }
  return { failures, lockedUntil: 0 };
}

export function lockoutRemaining(state: AttemptState, now = Date.now()): number {
  return Math.max(0, state.lockedUntil - now);
}
