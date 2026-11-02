/**
 * 待推送队列：把「已经落本地、还没确认写进云端」的 key 排队。
 *
 * ## 为什么需要它
 *
 * 推送是 `void` 触发的异步操作 —— 有意如此，否则点每个词都要等一次网络往返，
 * 手机弱网下完全没法用。代价是：点完词立刻关掉页面/切走 App，那次请求可能
 * 还没发出去就被浏览器掐断。
 *
 * 本地数据不受影响（IndexedDB 已经写了），但如果不记账，这次变更就要等到
 * 「下次打开时合并发现云端没有这行」才被补推 —— 中间这段时间电脑上是看不到的。
 *
 * 队列让这件事变成显式的：点词时先记一笔，推送成功才销账。
 *
 * ## 为什么不直接用内存里的队列
 *
 * 要扛的就是「页面被立刻关掉」这个场景，内存队列跟着 JS 上下文一起没了，
 * 等于没写。所以落 localStorage：同步 API、容量够（几千个 key 也就几十 KB）、
 * 且不依赖 IndexedDB 是否可用（隐私模式下 IDB 会整体降级，但用户仍可能在用）。
 *
 * ## 为什么只存 key，不存「已掌握」布尔值
 *
 * 队列的语义是「这个 key 的状态跟云端不一致，需要推」，而**当前是什么状态
 * 以 IndexedDB 为准**，推的时候现读。这样同一个词被反复开合也只留一条，
 * 不会出现「先推 true 再推 false」的顺序问题。
 */

const QUEUE_KEY = "ox5000-pending-push";

/** 读出待推送的 key 集合；坏数据当作空队列，不让它挡住启动 */
export function readPending(): Set<string> {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    // localStorage 被禁（老 Safari 隐私模式）/ JSON 坏了：退化成「没有待推」
    return new Set();
  }
}

function writePending(keys: Set<string>): void {
  try {
    if (keys.size === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify([...keys]));
  } catch {
    // 写不进去只影响这一层兜底，不影响正常推送路径
  }
}

/** 记一笔待推送 */
export function enqueuePending(keys: Iterable<string>): void {
  const pending = readPending();
  let changed = false;
  for (const key of keys) {
    if (!pending.has(key)) {
      pending.add(key);
      changed = true;
    }
  }
  if (changed) writePending(pending);
}

/** 销账：这些 key 已经确认写进云端了 */
export function clearPending(keys: Iterable<string>): void {
  const pending = readPending();
  let changed = false;
  for (const key of keys) {
    if (pending.delete(key)) changed = true;
  }
  if (changed) writePending(pending);
}

export function pendingCount(): number {
  return readPending().size;
}
