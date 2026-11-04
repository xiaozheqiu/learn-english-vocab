import { describe, expect, it } from "vitest";
import { buildKeys } from "../words";
import type { RawRow } from "../types";

describe("词条主键", () => {
  it("主键是「板块|单词」，词性不进主键", () => {
    const rows: RawRow[] = [["abandon", "v."]];
    expect(buildKeys("A1", rows)[0]!.key).toBe("A1|abandon");
  });

  it("同一个词不会因为词性不同而占两行", () => {
    // 合并之后数据里一个词只有一行；即便源数据意外重复，主键也该收敛成同一个
    const rows: RawRow[] = [
      ["lead", "v."],
      ["lead", "n."],
    ];
    const keys = buildKeys("B2", rows).map((w) => w.key);
    expect(keys).toEqual(["B2|lead", "B2|lead"]);
  });

  it("等级参与主键，同词不同级互不影响", () => {
    const a = buildKeys("A1", [["work", "n."]])[0]!.key;
    const b = buildKeys("B1", [["work", "n."]])[0]!.key;
    expect(a).not.toBe(b);
  });

  it("短语落在独立的 PHRASE 栏，不吃传入的等级", () => {
    const rows: RawRow[] = [["have to", "modal v."]];
    const word = buildKeys("A1", rows)[0]!;
    expect(word.key).toBe("PHRASE|have to");
    expect(word.level).toBe("PHRASE");
  });

  it("含空格但含逗号的 a, an 不算短语", () => {
    const word = buildKeys("A1", [["a, an", "indefinite article"]])[0]!;
    expect(word.key).toBe("A1|a, an");
    expect(word.level).toBe("A1");
  });

  it("行里只有单词与词性，其余字段为默认值", () => {
    const row = buildKeys("C1", [["x", "n."]])[0]!;
    expect(row.word).toBe("x");
    expect(row.pos).toBe("n.");
    // 台账字段：由后面的 loadLevel 从 tiers / oxford 补上
    expect(row.rank).toBe(0);
    expect(row.tier).toBe("core");
    expect(row.ox3000).toBe(false);
    expect(row.ox5000).toBe(false);
  });

  it("缺字段不抛错，单词与词性原样保留", () => {
    const row = buildKeys("A2", [["only-word", ""]])[0]!;
    expect(row.word).toBe("only-word");
    expect(row.pos).toBe("");
    expect(row.level).toBe("A2");
  });
});
