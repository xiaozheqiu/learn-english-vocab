import { describe, expect, it } from "vitest";
// @ts-expect-error - 脚本是 .mjs，没有类型声明；这里只需要它的纯逻辑
import * as dataScript from "../../../scripts/build-data.mjs";

const { buildData, BUCKETS, readBuiltRows, readBuiltGlosses, writeBuiltGlossesForTest } =
  dataScript;

/**
 * 释义产物（`zh-*.json`）的两条契约：**对齐**与**能区分**。
 *
 * 为什么要专门钉住：
 *
 * 1. 释义按**下标**与词表对应，错位就是把 A 的释义挂到 B 上。这种错没人会
 *    一眼看出来 —— 每个词都有释义、格式也正常，只是答案是错的。所以写盘前
 *    build-data 会断言长度相等，这里再钉一遍。
 *
 * 2. 一批释义曾经因为「同一条牛津英文定义 → 同一句中文」被合并成撞车：
 *    ankle / knee / elbow / wrist 全是「踝；脚踝」，answer / reply / respond
 *    全是「回答；答复」。中文模式下一屏两行一模一样，等于让人背一个错的映射。
 *    修复见 scripts/fix-glosses.py，这里锁住修好的那批不许退回去。
 */
describe("释义产物", () => {
  it("每个板块的释义与词表等长、同序、非空", () => {
    buildData({ force: true });
    for (const level of BUCKETS) {
      const rows = readBuiltRows(level);
      const glosses = readBuiltGlosses(level);
      expect(glosses).toHaveLength(rows.length);
      for (const gloss of glosses) {
        expect(typeof gloss).toBe("string");
        expect(gloss.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("释义都是中文（含汉字），不是漏掉的英文定义", () => {
    buildData({ force: true });
    for (const level of BUCKETS) {
      for (const gloss of readBuiltGlosses(level)) {
        expect(gloss).toMatch(/[\u4e00-\u9fa5]/);
      }
    }
  });

  it("释义对齐到正确的单词（抽查几条硬错）", () => {
    buildData({ force: true });
    const lookup = new Map<string, string>();
    for (const level of BUCKETS) {
      const rows = readBuiltRows(level);
      const glosses = readBuiltGlosses(level);
      rows.forEach((row: [string, string], index: number) => {
        lookup.set(row[0].toLowerCase(), glosses[index]);
      });
    }
    // 关节四兄弟曾全都是「踝；脚踝」，现在必须各归各位
    expect(lookup.get("ankle")).toContain("踝");
    expect(lookup.get("knee")).toContain("膝");
    expect(lookup.get("elbow")).toContain("肘");
    expect(lookup.get("wrist")).toContain("腕");
    // him 的释义曾写成「她（宾格）」
    expect(lookup.get("him")).toContain("他");
    expect(lookup.get("him")).not.toContain("她");
  });

  it("修好的撞车组不得重新撞在一起", () => {
    buildData({ force: true });
    const lookup = new Map<string, string>();
    for (const level of BUCKETS) {
      const rows = readBuiltRows(level);
      const glosses = readBuiltGlosses(level);
      rows.forEach((row: [string, string], index: number) => {
        lookup.set(row[0].toLowerCase(), glosses[index]);
      });
    }

    /*
     * 组内必须两两不同。组本身来自 scripts/fix-glosses.py 的 FIX 表 ——
     * 那里按「为什么这样分」写了解释，这里只锁结果，两处不重复维护理由。
     */
    const groups: string[][] = [
      ["apartment", "flat"],
      ["everybody", "everyone"],
      ["fantastic", "outstanding"],
      ["garden", "yard"],
      ["hello", "welcome"],
      ["no one", "nobody"],
      ["quite", "somewhat"],
      ["skill", "competence"],
      ["somebody", "someone"],
      ["ankle", "knee", "elbow", "wrist"],
      ["awful", "nasty"],
      ["criminal", "offender"],
      ["excellent", "fabulous", "super"],
      ["lorry", "truck"],
      ["loud", "noisy"],
      ["relationship", "relation"],
      ["transport", "transportation"],
      ["while", "whilst"],
      ["cloth", "fabric"],
      ["folk", "humanity"],
      ["obvious", "apparent"],
      ["perfectly", "totally", "fully", "utterly", "wholly"],
      ["accuse", "accused"],
      ["spokesman", "spokesperson"],
      ["sufficient", "sufficiently"],
      ["brutal", "vicious"],
    ];

    for (const group of groups) {
      const glosses = group.map((word) => lookup.get(word));
      for (const gloss of glosses) expect(gloss, `组 ${group.join("/")} 里缺词`).toBeDefined();
      expect(new Set(glosses).size, `${group.join(" / ")} 的释义又撞车了`).toBe(group.length);
    }
  });

  it("释义产物形状变了不会被当成最新而跳过", () => {
    buildData({ force: true });
    // 伪造一份「mtime 更新但存成了对象」的旧产物
    writeBuiltGlossesForTest("A1", { "a, an": "一个；一名" });

    expect(buildData().built).toContain("A1");
    expect(readBuiltGlosses("A1")[0]).toBe("一个；一名");
  });
});
