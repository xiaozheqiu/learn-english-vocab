import { describe, expect, it } from "vitest";
import { buildKeys } from "../words";
import type { RawRow } from "../types";

describe("词条主键", () => {
  it("唯一的 (词, 词性) 不带序号", () => {
    const rows: RawRow[] = [["abandon", "v.", "放弃", "3000", 0]];
    expect(buildKeys("A1", rows)[0]!.key).toBe("A1|abandon|v.");
  });

  it("重复的 (词, 词性) 加序号，且不共用键", () => {
    const rows: RawRow[] = [
      ["lead", "v.", "领导", "3000", 0],
      ["lead", "v.", "铅", "5000", 0],
      ["lead", "n.", "铅", "5000", 0],
    ];
    const keys = buildKeys("B2", rows).map((w) => w.key);
    expect(keys).toEqual(["B2|lead|v.|1", "B2|lead|v.|2", "B2|lead|n."]);
    expect(new Set(keys).size).toBe(3);
  });

  it("等级参与主键，同词不同级互不影响", () => {
    const a = buildKeys("A1", [["work", "n.", "工作", "3000", 0]])[0]!.key;
    const b = buildKeys("B1", [["work", "n.", "工作", "3000", 0]])[0]!.key;
    expect(a).not.toBe(b);
  });

  it("保留 seq 原始信息", () => {
    const row = buildKeys("C1", [["x", "n.", "某", "5000", 7]])[0]!;
    expect(row.seq).toBe("7");
    expect(row.scope).toBe("5000");
  });

  it("字段缺省不抛错，等级与释义原样保留", () => {
    const row = buildKeys("A2", [["only-word", "", "", ""]])[0]!;
    expect(row.word).toBe("only-word");
    expect(row.pos).toBe("");
    expect(row.cn).toBe("");
    expect(row.level).toBe("A2");
  });
});
