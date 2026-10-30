import { describe, expect, it } from "vitest";
import { buildKeys } from "../words";
import type { RawRow } from "../types";

describe("词条主键", () => {
  it("唯一的 (词, 词性) 不带序号", () => {
    const rows: RawRow[] = [["abandon", "v."]];
    expect(buildKeys("A1", rows)[0]!.key).toBe("A1|abandon|v.");
  });

  it("重复的 (词, 词性) 加序号，且不共用键", () => {
    const rows: RawRow[] = [
      ["lead", "v."],
      ["lead", "v."],
      ["lead", "n."],
    ];
    const keys = buildKeys("B2", rows).map((w) => w.key);
    expect(keys).toEqual(["B2|lead|v.|1", "B2|lead|v.|2", "B2|lead|n."]);
    expect(new Set(keys).size).toBe(3);
  });

  it("等级参与主键，同词不同级互不影响", () => {
    const a = buildKeys("A1", [["work", "n."]])[0]!.key;
    const b = buildKeys("B1", [["work", "n."]])[0]!.key;
    expect(a).not.toBe(b);
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
