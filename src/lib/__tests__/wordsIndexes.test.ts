/**
 * 首屏快路径 vs 补齐索引（§6 lib/words.ts 的 loadLevel / loadAll）。
 *
 * 这条分界很容易在后续重构里被抹平：只要有人把 `enrich()` 挪回 `loadLevel`
 * 的必经路径，档位与牛津两档又会悄悄依赖首屏那 228KB 索引 —— 而界面表现
 * 完全正常，只有首屏变慢。所以这里用「rank 是否为 0」把两种情况钉住。
 *
 * 单独一个文件是为了拿到干净的模块状态：`cache` 与 `enrichedLevels` 都是模块级
 * 变量，vitest 默认按文件隔离模块注册表，同文件内先后顺序会互相污染。
 */
import { describe, expect, it } from "vitest";
import { cachedAll, enrichAll, indexesReady, isLoaded, loadAll, loadLevel } from "../words";

describe("首屏快路径", () => {
  it("withIndexes=false 只建主键，不碰 tiers / oxford", async () => {
    const words = await loadLevel("A1", false);
    expect(words.length).toBeGreaterThan(0);
    // 主键与单词本身是本地算出来的，不依赖索引
    expect(words[0]!.key).toBe("A1|a, an|indefinite article");
    // 索引没来，台账字段停在默认值 —— 这正是「省掉 228KB」的代价
    expect(words.every((w) => w.rank === 0 && w.tier === "core")).toBe(true);
    expect(words.every((w) => !w.ox3000 && !w.ox5000)).toBe(true);
  });

  it("同一等级再按默认参数载入时补上索引，且改的是同一批对象", async () => {
    const before = await loadLevel("A1", false);
    const after = await loadLevel("A1");
    // 同一个数组引用：补齐是就地改，不是重新构建一份
    expect(after).toBe(before);
    expect(after.some((w) => w.rank > 0)).toBe(true);
    expect(after.some((w) => w.ox3000 || w.ox5000)).toBe(true);
  });
});

describe("全量加载", () => {
  it("覆盖全部等级，且每个等级都补齐了索引", async () => {
    const all = await loadAll();
    expect(isLoaded(["A1", "A2", "B1", "B2", "C1"])).toBe(true);
    expect(all.length).toBe(cachedAll().length);
    // 只抽查最后一级：它没走过快路径，必须带索引
    const c1 = all.filter((w) => w.level === "C1");
    expect(c1.length).toBeGreaterThan(0);
    expect(c1.every((w) => w.rank > 0)).toBe(true);
  });

  it("进度回调依次报告 1..5", async () => {
    const seen: number[] = [];
    await loadAll((done) => seen.push(done));
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("索引就绪判定", () => {
  it("补齐后 indexesReady() 为真，enrichAll 幂等", async () => {
    const first = await enrichAll();
    expect(indexesReady()).toBe(true);
    const second = await enrichAll();
    // 幂等：再调一次不重建数组，也不改内容
    expect(second).toEqual(first);
  });
});
