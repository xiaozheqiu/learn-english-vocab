// 进度同步：本机 localStorage 是离线真相，连上 GitHub 后与 gist 双向对齐。
//
// 合并规则（三条都不能少）：
//   - 本机没有未同步的改动 → 采用云端（这样在手机上的「取消勾选」能正确带到电脑）
//   - 本机有未同步的改动   → 取并集再推上去（绝不让刚勾的进度丢）
//   - 这台设备第一次连这个账号 → 取并集（未连时攒的进度、以及从旧版页面带过来的，都要保住）
import {
  getToken,
  hasToken,
  setToken,
  clearToken,
  whoami,
  pull,
  push,
  cachedGistId,
  gistUrl,
  GIST_FILE,
} from "./github.js";

const KEY = "ox5000-mastered-v1";
const DIRTY = "ox5000-dirty-v1";
const SYNCED = "ox5000-synced-v1";
// 这台设备已经跟哪个 GitHub 账号同步过，用来区分「首次连接」和「日常对齐」
const SYNCED_UID = "ox5000-synced-uid-v1";

export { hasToken, getToken, setToken, clearToken, cachedGistId, gistUrl, GIST_FILE };

/* ---------- 本机进度 ---------- */

export function loadLocal() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || "[]");
    return new Set(Array.isArray(a) ? a : []);
  } catch (e) {
    return new Set();
  }
}

export function saveLocal(set) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set].sort()));
  } catch (e) {}
}

export function isDirty() {
  try {
    return localStorage.getItem(DIRTY) === "1";
  } catch (e) {
    return false;
  }
}

export function markDirty() {
  try {
    localStorage.setItem(DIRTY, "1");
  } catch (e) {}
}

function clearDirty() {
  try {
    localStorage.removeItem(DIRTY);
    localStorage.setItem(SYNCED, String(Date.now()));
  } catch (e) {}
}

export function lastSyncedAt() {
  try {
    const t = +localStorage.getItem(SYNCED);
    return t > 0 ? t : null;
  } catch (e) {
    return null;
  }
}

// 这台设备上一次同步过的账号（GitHub 登录名）；没同步过返回 null
export function lastSyncedUid() {
  try {
    return localStorage.getItem(SYNCED_UID) || null;
  } catch (e) {
    return null;
  }
}

function rememberUid(login) {
  try {
    localStorage.setItem(SYNCED_UID, login);
  } catch (e) {}
}

/* ---------- 连接 ---------- */

// 刷新页面 / 重开 PWA 时恢复连接状态。
// 只读本机存的 token 和账号名，不发网络请求：
// 校验要联网，断网时会把已连接的人挡在门外。真失效时第一次同步会报错。
export function restoreSession() {
  const t = getToken();
  if (!t) return null;
  return { login: lastSyncedUid() || "已连接" };
}

// 粘一次 token 就连上：验证有效 → 存本机 → 跟云端对齐
export async function connect(token) {
  const t = (token || "").trim();
  if (!t) throw new Error("请先粘贴 token");
  const me = await whoami(t);
  setToken(t);
  return me;
}

export function disconnect() {
  clearToken();
}

// 连接后 / 从后台切回来时做一次全量对齐
export async function syncOnConnect(login) {
  const token = getToken();
  if (!token) throw new Error("还没有连接 GitHub");

  const local = loadLocal();
  const { keys: remote, empty } = await pull(token);

  const firstTimeHere = lastSyncedUid() !== login;

  // 只在「云端确实有内容」时才允许以云端为准。
  // 否则一份刚建好、还是空的 gist 会把本机攒的进度直接抹掉。
  if (!firstTimeHere && !isDirty() && !empty) {
    saveLocal(remote);
    clearDirty();
    rememberUid(login);
    return { keys: remote, changed: false };
  }

  const merged = new Set([...remote, ...local]);
  await push(token, merged);
  saveLocal(merged);
  clearDirty();
  rememberUid(login);
  return { keys: merged, changed: true };
}

// 勾选变化后调用（防抖由调用方控制）：整份推上去
export async function syncChanges(login) {
  const token = getToken();
  if (!token) throw new Error("还没有连接 GitHub");
  const next = loadLocal();
  await push(token, next);
  clearDirty();
  rememberUid(login);
  return next;
}
