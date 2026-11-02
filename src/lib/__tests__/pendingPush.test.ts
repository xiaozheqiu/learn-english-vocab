import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPending, enqueuePending, pendingCount, readPending } from "../pendingPush";

/**
 * 队列存在的唯一理由是「页面被立刻关掉」——那时候内存里的东西全没了，
 * 只有 localStorage 还留着。所以这里全部围绕持久化行为测，不测内存。
 *
 * vitest 的环境是 node（见 vite.config.js 的 test.environment），没有
 * localStorage。用最小内存桩顶上：比引入 jsdom 轻，也够验证「写进去能读回来」
 * 这个唯一重要的性质。桩在 import 模块之前装好。
 */
const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
});

describe("待推送队列", () => {
  beforeEach(() => {
    store.clear();
  });

  it("空队列读出空集合", () => {
    expect(readPending().size).toBe(0);
    expect(pendingCount()).toBe(0);
  });

  it("入队后能读回", () => {
    enqueuePending(["A1|a, an|x", "A1|about|y"]);
    expect([...readPending()].sort()).toEqual(["A1|a, an|x", "A1|about|y"]);
    expect(pendingCount()).toBe(2);
  });

  it("同一个 key 反复入队只留一条", () => {
    enqueuePending(["k1"]);
    enqueuePending(["k1"]);
    enqueuePending(["k1", "k2"]);
    expect(pendingCount()).toBe(2);
  });

  it("销账后从队列移除，清空时不留下空数组", () => {
    enqueuePending(["k1", "k2"]);
    clearPending(["k1"]);
    expect([...readPending()]).toEqual(["k2"]);
    clearPending(["k2"]);
    expect(pendingCount()).toBe(0);
    // 空队列应当把键删掉，而不是留一个 "[]"
    expect(localStorage.getItem("ox5000-pending-push")).toBeNull();
  });

  it("销账一个不存在的 key 不出错", () => {
    enqueuePending(["k1"]);
    clearPending(["nope"]);
    expect(pendingCount()).toBe(1);
  });

  /**
   * 坏数据不能挡住启动：这个队列是兜底路径，它自己坏掉时
   * 应当退化成「没有待推」，而不是让整个应用初始化抛错。
   */
  it("坏 JSON 与非法结构都退化成空队列", () => {
    localStorage.setItem("ox5000-pending-push", "{not json");
    expect(pendingCount()).toBe(0);

    localStorage.setItem("ox5000-pending-push", '{"a":1}');
    expect(pendingCount()).toBe(0);

    localStorage.setItem("ox5000-pending-push", '[1, "ok", null, "also"]');
    expect([...readPending()]).toEqual(["ok", "also"]);
  });

  it("跨「会话」保留：新读一次仍能看到上次入队的", () => {
    enqueuePending(["k1", "k2"]);
    // 模拟页面重新加载：模块重新求值，但 localStorage 还在
    expect(readPending().size).toBe(2);
  });

  /**
   * localStorage 整个不可用（老 Safari 隐私模式会直接抛）时，
   * 队列退化成 no-op，不能把异常抛给调用方 —— 它只是兜底。
   */
  it("localStorage 抛异常时静默降级", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
      clear: () => {},
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("localStorage", broken);
    expect(() => enqueuePending(["k1"])).not.toThrow();
    expect(() => clearPending(["k1"])).not.toThrow();
    expect(readPending().size).toBe(0);
  });
});
