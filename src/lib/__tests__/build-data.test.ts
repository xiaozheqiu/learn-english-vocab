import { describe, expect, it } from "vitest";
// @ts-expect-error - 脚本是 .mjs，没有类型声明；这里只需要它的纯逻辑
import { buildData, LEVELS } from "../../../scripts/build-data.mjs";

/**
 * 数据脚本的增量行为（`npm run dev` 不再每次重转 5 个等级）：
 * 产物比源文件新就必须整批跳过，否则每次启动都要重写 270KB JSON 并让 Vite 失效缓存。
 */
describe("build-data 增量转换", () => {
  it("已经是最新时全部跳过", () => {
    // 先强制转一次，把产物 mtime 推到源文件之后
    const forced = buildData({ force: true });
    expect(forced.built).toEqual(LEVELS);
    expect(forced.skipped).toEqual([]);

    const second = buildData();
    expect(second.built).toEqual([]);
    expect(second.skipped).toEqual(LEVELS);
    expect(second.total).toBeGreaterThan(0);
  });

  it("强制模式下仍然会重转并给出每条记录的条数与体积", () => {
    const out = buildData({ force: true });
    expect(out.report).toHaveLength(LEVELS.length);
    for (const line of out.report) expect(line).toMatch(/条, .* KB/);
  });
});
