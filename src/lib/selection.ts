/**
 * 选中集合的纯函数（§5 F1）。
 *
 * hook 只做 setState 包装，所有集合运算都在这里，
 * 这样「全选本页 / 反选 / 扩选 / 三态」可以直接测，不必渲染组件。
 */

/** 点击一行：已选则取消；shiftKey 且锚点在同一页时，把锚点到目标之间整段补上 */
export function toggleKey(
  current: ReadonlySet<string>,
  key: string,
  pageKeys: readonly string[],
  anchor: string | null,
  shiftKey = false,
): { keys: Set<string>; anchor: string | null } {
  const next = new Set(current);
  if (shiftKey && anchor) {
    const start = pageKeys.indexOf(anchor);
    const end = pageKeys.indexOf(key);
    if (start >= 0 && end >= 0) {
      const [from, to] = start < end ? [start, end] : [end, start];
      for (let i = from; i <= to; i += 1) {
        const target = pageKeys[i];
        if (target) next.add(target);
      }
      return { keys: next, anchor };
    }
  }
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return { keys: next, anchor: key };
}

/** 全选 / 取消一组 key */
export function setKeys(
  current: ReadonlySet<string>,
  source: readonly string[],
  selected: boolean,
): Set<string> {
  const next = new Set(current);
  for (const key of source) {
    if (selected) next.add(key);
    else next.delete(key);
  }
  return next;
}

/** 反选：只翻转作用域内的 key，作用域外的选择保持不动 */
export function invertKeys(current: ReadonlySet<string>, source: readonly string[]): Set<string> {
  const next = new Set(current);
  for (const key of source) {
    if (next.has(key)) next.delete(key);
    else next.add(key);
  }
  return next;
}

/** 表头三态：0 条 → false，整页 → true，其余 → indeterminate */
export function pageStateOf(
  keys: ReadonlySet<string>,
  pageKeys: readonly string[],
): boolean | "indeterminate" {
  if (pageKeys.length === 0) return false;
  let selected = 0;
  for (const key of pageKeys) if (keys.has(key)) selected += 1;
  if (selected === 0) return false;
  return selected === pageKeys.length ? true : "indeterminate";
}

/** 选中项里不在当前筛选结果内的条数（筛选条件变了要给提示） */
export function offFilterCountOf(
  keys: ReadonlySet<string>,
  filteredKeys: readonly string[],
): number {
  const allowed = new Set(filteredKeys);
  let count = 0;
  for (const key of keys) if (!allowed.has(key)) count += 1;
  return count;
}

/** 选中项落在作用域内的部分：批量标记只作用于这些 */
export function scopedKeysOf(keys: ReadonlySet<string>, source: readonly string[]): string[] {
  const allowed = new Set(source);
  return [...keys].filter((key) => allowed.has(key));
}
