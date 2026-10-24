import { describe, expect, it } from "vitest";
import {
  invertKeys,
  offFilterCountOf,
  pageStateOf,
  scopedKeysOf,
  setKeys,
  toggleKey,
} from "../selection";

const PAGE = ["a", "b", "c", "d"];

describe("词表选中集合", () => {
  it("点一行在选中与取消之间切换，并更新锚点", () => {
    const first = toggleKey(new Set(), "b", PAGE, null);
    expect([...first.keys]).toEqual(["b"]);
    expect(first.anchor).toBe("b");

    const second = toggleKey(first.keys, "b", PAGE, first.anchor);
    expect([...second.keys]).toEqual([]);
    expect(second.anchor).toBe("b");
  });

  it("shift 扩选把锚点到目标之间整段补上（含反向）", () => {
    const forward = toggleKey(new Set(["a"]), "c", PAGE, "a", true);
    expect([...forward.keys].sort()).toEqual(["a", "b", "c"]);

    const backward = toggleKey(new Set(["d"]), "b", PAGE, "d", true);
    expect([...backward.keys].sort()).toEqual(["b", "c", "d"]);
  });

  it("锚点不在本页时退化成普通切换，不会误选整页", () => {
    const out = toggleKey(new Set(), "c", PAGE, "zzz", true);
    expect([...out.keys]).toEqual(["c"]);
  });

  it("全选与取消只影响给定范围", () => {
    const all = setKeys(new Set(["x"]), ["a", "b"], true);
    expect([...all].sort()).toEqual(["a", "b", "x"]);
    const none = setKeys(all, ["a"], false);
    expect([...none].sort()).toEqual(["b", "x"]);
  });

  it("反选只翻转作用域内的 key", () => {
    const out = invertKeys(new Set(["a", "c", "x"]), ["a", "b"]);
    expect([...out].sort()).toEqual(["b", "c", "x"]);
  });

  it("表头三态覆盖未选 / 部分 / 全选", () => {
    expect(pageStateOf(new Set(), PAGE)).toBe(false);
    expect(pageStateOf(new Set(["a", "b"]), PAGE)).toBe("indeterminate");
    expect(pageStateOf(new Set(PAGE), PAGE)).toBe(true);
    expect(pageStateOf(new Set(), [])).toBe(false);
  });

  it("筛选外的选中单独计数，批量标记只作用于作用域内", () => {
    const keys = new Set(["a", "b", "x"]);
    expect(offFilterCountOf(keys, PAGE)).toBe(1);
    expect(scopedKeysOf(keys, ["a", "b"])).toEqual(["a", "b"]);
  });
});
