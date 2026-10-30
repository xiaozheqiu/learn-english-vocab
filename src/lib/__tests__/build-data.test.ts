import { describe, expect, it } from "vitest";
// @ts-expect-error - 脚本是 .mjs，没有类型声明；这里只需要它的纯逻辑
import * as dataScript from "../../../scripts/build-data.mjs";

const { buildData, LEVELS, ROW_WIDTH, readBuiltRows, writeBuiltRowsForTest } = dataScript;

/**
 * 数据脚本的增量行为（`npm run dev` 不再每次重转 5 个等级）：
 * 产物比源文件新就必须整批跳过，否则每次启动都要重写 JSON 并让 Vite 失效缓存。
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

/**
 * 产物只留 [单词, 词性]。
 *
 * 源数据是 5 元组，后三项（中文释义 / 3000-5000 / 序号）前端一个都不读。
 * 曾经整包搬进分包，占了六成体积还进 PWA 预缓存。这组断言盯住它不得被搬回来：
 * 谁把字段加回去，体积和缓存都要重算一遍，必须是有意的决定。
 */
describe("build-data 裁剪产物字段", () => {
  it("每个等级的产物都只有单词与词性两列", () => {
    buildData({ force: true });
    for (const level of LEVELS) {
      const rows = readBuiltRows(level);
      for (const row of rows) {
        expect(row).toHaveLength(ROW_WIDTH);
        expect(typeof row[0]).toBe("string");
        expect(typeof row[1]).toBe("string");
      }
    }
  });

  it("产物不夹带中文释义", () => {
    buildData({ force: true });
    // A1 首条源数据是 ['a, an','indefinite article','一个；一名','3000',0]
    expect(readBuiltRows("A1")[0]).toEqual(["a, an", "indefinite article"]);
  });

  it("形状变窄后老产物不会被当成最新而跳过", () => {
    buildData({ force: true });
    // 伪造一份「mtime 更新但仍是 5 元组」的旧产物
    writeBuiltRowsForTest("A1", [["a, an", "indefinite article", "一个；一名", "3000", 0]]);

    expect(buildData().built).toContain("A1");
    expect(readBuiltRows("A1")[0]).toEqual(["a, an", "indefinite article"]);
  });
});
