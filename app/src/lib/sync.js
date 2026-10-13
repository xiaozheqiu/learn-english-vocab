// 进度同步：本机 localStorage 是离线真相，登录后与 Supabase 双向对齐。
//
// 表结构（见 supabase/schema.sql）：
//   ox_progress(user_id uuid, key text, updated_at timestamptz, primary key(user_id,key))
//
// 合并规则：
//   - 本机没有未同步的改动 → 直接采用云端（这样在手机上的「取消勾选」能正确带到电脑）
//   - 本机有未同步的改动   → 取并集再推上去（绝不让刚勾的进度丢）
import { supabase } from "./supabase.js";

const KEY = "ox5000-mastered-v1";
const DIRTY = "ox5000-dirty-v1";
const SYNCED = "ox5000-synced-v1";
// 记下"这台设备已经跟哪个账号同步过"，用来区分"首次登录"和"日常对齐"
const SYNCED_UID = "ox5000-synced-uid-v1";

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
    localStorage.setItem(KEY, JSON.stringify([...set]));
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

// 这台设备上一次同步过的账号 id；没同步过返回 null
export function lastSyncedUid() {
  try {
    return localStorage.getItem(SYNCED_UID) || null;
  } catch (e) {
    return null;
  }
}

function rememberUid(userId) {
  try {
    localStorage.setItem(SYNCED_UID, userId);
  } catch (e) {}
}

// 刷新页面 / 重开 PWA 时恢复登录态。
// 用 getSession() 而不是 getUser()：前者读本机存的会话，不发网络请求，
// 断网时也能认得出已经登录过，不至于把离线用户挡在登录页。
export async function restoreSession() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data && data.session ? data.session.user : null;
  } catch (e) {
    return null;
  }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data ? data.user : null;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// 网络请求加超时：断网时 supabase-js 会自己重试好几次，
// 状态栏会一直停在"同步中…"，看起来像卡住了。
function withTimeout(promise, ms = 8000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error("同步超时，网络可能不通")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// 拉云端全部 key
async function pull(userId) {
  const { data, error } = await withTimeout(
    supabase.from("ox_progress").select("key").eq("user_id", userId),
  );
  if (error) throw error;
  return new Set((data || []).map((r) => r.key));
}

// 把差异推上去：新增的 upsert，去掉的 delete
async function push(userId, next, prev) {
  const add = [...next].filter((k) => !prev.has(k));
  const del = [...prev].filter((k) => !next.has(k));

  if (add.length) {
    // 分批，避免单次请求过大
    for (let i = 0; i < add.length; i += 500) {
      const chunk = add.slice(i, i + 500).map((key) => ({
        user_id: userId,
        key,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await withTimeout(
        supabase.from("ox_progress").upsert(chunk, { onConflict: "user_id,key" }),
      );
      if (error) throw error;
    }
  }
  if (del.length) {
    for (let i = 0; i < del.length; i += 500) {
      const chunk = del.slice(i, i + 500);
      const { error } = await withTimeout(
        supabase.from("ox_progress").delete().eq("user_id", userId).in("key", chunk),
      );
      if (error) throw error;
    }
  }
}

// 登录后首次对齐：返回合并后的集合
export async function syncOnLogin(userId) {
  const local = loadLocal();
  const remote = await pull(userId);

  // 这台设备第一次跟这个账号同步：本机已有的进度可能是在"未登录"状态下攒的
  // （或者是从旧版单文件页面带过来的），必须并上去，绝不能直接用云端盖掉。
  const firstTimeHere = lastSyncedUid() !== userId;

  if (!firstTimeHere && !isDirty()) {
    // 本机没有待同步改动 → 云端为准（含删除）
    saveLocal(remote);
    clearDirty();
    rememberUid(userId);
    return remote;
  }

  // 首次同步，或本机有改动 → 并集，并以本机为准推上去
  const merged = new Set([...remote, ...local]);
  await push(userId, merged, remote);
  saveLocal(merged);
  clearDirty();
  rememberUid(userId);
  return merged;
}

// 勾选变化后调用（防抖由调用方控制）
export async function syncChanges(userId, next, prev) {
  await push(userId, next, prev);
  clearDirty();
  rememberUid(userId);
}
