/**
 * 选中状态（§5 F1 修订）。
 *
 * 批量入口收到右下角浮动按钮里之后，选中集合只在词表页内部流转，
 * 所以从 Context 降级为普通 hook：页面把「本页 keys」「筛选结果 keys」传进来，
 * hook 只负责 setState，集合运算全部在 lib/selection.ts 里（可单测）。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  invertKeys,
  offFilterCountOf,
  pageStateOf,
  scopedKeysOf,
  setKeys,
  toggleKey,
} from "@/lib/selection";

export type BulkScope = "page" | "filtered";

export interface SelectionApi {
  keys: ReadonlySet<string>;
  scope: BulkScope;
  setScope: (scope: BulkScope) => void;
  /** 点击行：勾选/取消；带 shiftKey 时从锚点扩选 */
  toggle: (key: string, shiftKey?: boolean) => void;
  /** 表头三态框：全选 / 取消本页 */
  selectPage: (selected: boolean) => void;
  selectFiltered: (selected: boolean) => void;
  /** 反选当前作用域 */
  invert: () => void;
  clear: () => void;
  /** 选中项中落在当前作用域内的 key，批量标记只作用于它们 */
  scopedKeys: () => string[];
  /** 本页勾选态，用于表头三态框 */
  pageState: boolean | "indeterminate";
  /** 选中项里不在当前筛选结果内的条数 */
  offFilterCount: number;
}

export function useSelection(
  pageKeys: readonly string[],
  filteredKeys: readonly string[],
): SelectionApi {
  const [keys, setSelection] = useState<Set<string>>(() => new Set());
  const [scope, setScope] = useState<BulkScope>("page");
  const anchor = useRef<string | null>(null);

  /*
   * 用 ref 读「当前选中集合」而不是把它放进依赖。
   * 放进依赖的话 toggle 每次勾选都会换引用，行组件的 memo 就全部失效 ——
   * 一页 500 行时那是 500 次无谓重渲染。
   */
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const pageKeysRef = useRef(pageKeys);
  pageKeysRef.current = pageKeys;

  const toggle = useCallback((key: string, shiftKey = false) => {
    const result = toggleKey(keysRef.current, key, pageKeysRef.current, anchor.current, shiftKey);
    anchor.current = result.anchor;
    setSelection(result.keys);
  }, []);

  const selectPage = useCallback(
    (selected: boolean) => {
      setSelection(setKeys(keys, pageKeys, selected));
      anchor.current = null;
    },
    [keys, pageKeys],
  );

  const selectFiltered = useCallback(
    (selected: boolean) => {
      setSelection(setKeys(keys, filteredKeys, selected));
      anchor.current = null;
    },
    [filteredKeys, keys],
  );

  const clear = useCallback(() => {
    setSelection(new Set());
    anchor.current = null;
  }, []);

  const invert = useCallback(() => {
    setSelection(invertKeys(keys, scope === "page" ? pageKeys : filteredKeys));
  }, [filteredKeys, keys, pageKeys, scope]);

  const scopedKeys = useCallback(
    () => scopedKeysOf(keys, scope === "page" ? pageKeys : filteredKeys),
    [filteredKeys, keys, pageKeys, scope],
  );

  return useMemo(
    () => ({
      keys,
      scope,
      setScope,
      toggle,
      selectPage,
      selectFiltered,
      invert,
      clear,
      scopedKeys,
      pageState: pageStateOf(keys, pageKeys),
      offFilterCount: offFilterCountOf(keys, filteredKeys),
    }),
    [
      clear,
      filteredKeys,
      invert,
      keys,
      pageKeys,
      scope,
      scopedKeys,
      selectFiltered,
      selectPage,
      toggle,
    ],
  );
}
