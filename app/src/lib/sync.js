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

export function lastSyncedAt() {
  try {
    const t = +localStorage.getItem(SYNCED);
    return t > 0 ? t : null;
  } catch (e) {
    return null;
  }
}

export function signedIn() {
  return Boolean(supabase);
}

export async function currentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data ? data.user : null;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// 拉云端全部 key
async function pull(userId) {
  const { data, error } = await supabase
    .from("ox_progress")
    .select("key")
    .eq("user_id", userId);
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
      const { error } = await supabase
        .from("ox_progress")
        .upsert(chunk, { onConflict: "user_id,key" });
      if (error) throw error;
    }
  }
  if (del.length) {
    for (let i = 0; i < del.length; i += 500) {
      const chunk = del.slice(i, i + 500);
      const { error } = await supabase
        .from("ox_progress")
        .delete()
        .eq("user_id", userId)
        .in("key", chunk);
      if (error) throw error;
    }
  }
}

// 登录后首次对齐：返回合并后的集合
export async function syncOnLogin(userId) {
  const local = loadLocal();
  const remote = await pull(userId);

  if (!isDirty()) {
    // 本机没有待同步改动 → 云端为准（含删除）
    saveLocal(remote);
    clearDirty();
    return remote;
  }

  // 本机有改动 → 并集，并以本机为准推上去
  const merged = new Set([...remote, ...local]);
  await push(userId, merged, remote);
  saveLocal(merged);
  clearDirty();
  return merged;
}

// 勾选变化后调用（防抖由调用方控制）
export async function syncChanges(userId, next, prev) {
  await push(userId, next, prev);
  clearDirty();
}
