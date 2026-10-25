import { describe, expect, it } from "vitest";
import {
  acceptedSpellings,
  buildKeys,
  normalizeSpelling,
  posTags,
  primaryMeaning,
  samePos,
} from "../words";
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
});

describe("拼写判定", () => {
  it("并列写法都可接受", () => {
    expect(acceptedSpellings("a, an")).toContain("a");
    expect(acceptedSpellings("a, an")).toContain("an");
  });

  it("去括注", () => {
    const list = acceptedSpellings("colour (color)");
    expect(list).toContain("colour");
    expect(list).not.toContain("colour (color)");
  });

  it("归一化忽略大小写与尾随标点", () => {
    expect(normalizeSpelling("  Abandon. ")).toBe("abandon");
    expect(normalizeSpelling("A,")).toBe("a");
    expect(normalizeSpelling("don't")).toBe("dont");
  });
});

describe("释义与词性", () => {
  it("primaryMeaning 取首个义项", () => {
    expect(primaryMeaning("prep. 在...周围，大约 ／ adv. 大约")).toContain("prep.");
    expect(primaryMeaning("放弃")).toBe("放弃");
  });

  it("posTags 拆多词性", () => {
    expect(posTags("n., v.")).toEqual(["n.", "v."]);
    expect(posTags("prep., adv.")).toEqual(["prep.", "adv."]);
  });

  it("samePos 有交集即同词性", () => {
    const a = {
      key: "a",
      level: "A1",
      word: "x",
      pos: "n., v.",
      cn: "",
      scope: "",
      seq: "",
    } as const;
    const b = { key: "b", level: "A1", word: "y", pos: "v.", cn: "", scope: "", seq: "" } as const;
    const c = {
      key: "c",
      level: "A1",
      word: "z",
      pos: "adj.",
      cn: "",
      scope: "",
      seq: "",
    } as const;
    expect(samePos(a, b)).toBe(true);
    expect(samePos(a, c)).toBe(false);
  });
});
