const KEY = "ox5000-mastered-v1";

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
