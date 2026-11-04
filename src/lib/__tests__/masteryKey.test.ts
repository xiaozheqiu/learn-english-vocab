import { describe, expect, it } from "vitest";
import { normalizeRemoteKeys, type RemoteRow } from "../cloud";
import { buildBucketMapFromWords, migrateKey, migrateKeys, remapWithBuckets } from "../masteryKey";

/**
 * 主键迁移是「升级不丢进度」的唯一保障，所以这里锁死换算规则。
 *
 * 背景：老数据一个词占 2~4 行（`A1|arm|n.` 与 `C1|arm|v.`），新数据一个词一行
 * （`A1|arm`）。两套格式一个 key 都不重合 —— 算错就是全体用户进度清零。
 */
describe("旧主键换算", () => {
  it("砍掉词性，保留板块与单词", () => {
    expect(migrateKey("A1|abandon|v.")).toBe("A1|abandon");
    expect(migrateKey("A1|arm|n.")).toBe("A1|arm");
  });

  it("单条换算只看自己的等级（跨等级收敛交给批量）", () => {
    // 单条无法知道「这个词还有 C1 那一行」，所以各自保留自己的等级；
    // 真正的收敛在 migrateKeys / buildBucketMap 里做，见下一条
    expect(migrateKey("A1|arm|n.")).toBe("A1|arm");
    expect(migrateKey("C1|arm|v.")).toBe("C1|arm");
  });

  it("批量换算时同一个词坍成一个板块（取最低等级）", () => {
    // arm 的 n. 在 A1、v. 在 C1，合并后它只有一行，落在 A1
    expect(migrateKeys(["A1|arm|n.", "C1|arm|v."])).toEqual(["A1|arm"]);
  });

  it("只有单边数据时推不出权威板块 —— 这种只能靠词表对照", () => {
    /*
     * 这条锁的是「migrateKeys 的能力边界」，不是它的正确性。
     * 只拿到 C1|arm|v. 这一条时，没有任何信息说明 arm 在词表里其实落在 A1 ——
     * 所以它只能给出 C1|arm。真实迁移必须走 buildBucketMapFromWords +
     * remapWithBuckets（见下一条），否则用户会得到一个词表里不存在的 key。
     */
    expect(migrateKeys(["C1|arm|v."])).toEqual(["C1|arm"]);
  });

  it("照着真实词表换算，单边数据也能落到正确板块", () => {
    const buckets = buildBucketMapFromWords([
      { word: "arm", level: "A1" },
      { word: "have to", level: "PHRASE" },
    ]);
    expect(remapWithBuckets("C1|arm|v.", buckets)).toBe("A1|arm");
    expect(remapWithBuckets("A1|arm|n.", buckets)).toBe("A1|arm");
    expect(remapWithBuckets("A1|have to|modal v.", buckets)).toBe("PHRASE|have to");
    // 词表里没有的词：不硬塞，返回 null 让调用方退回启发式
    expect(remapWithBuckets("A1|nonexistent|n.", buckets)).toBeNull();
  });

  it("带重复序号的老 key 也能换算", () => {
    // 老规则里同名同词性重复时会加 |1 |2
    expect(migrateKey("B2|lead|v.|1")).toBe("B2|lead");
    expect(migrateKey("B2|lead|v.|2")).toBe("B2|lead");
  });

  it("短语一律落到 PHRASE 栏", () => {
    expect(migrateKey("A1|have to|modal v.")).toBe("PHRASE|have to");
    expect(migrateKey("A2|according to|prep.")).toBe("PHRASE|according to");
  });

  it("a, an 含逗号，不算短语，留在原板块", () => {
    expect(migrateKey("A1|a, an|indefinite article")).toBe("A1|a, an");
  });

  it("抓取残留的词头一并修正", () => {
    expect(migrateKey("A1|one number/|det., pron.")).toBe("A1|one");
  });

  it("已经是新格式的 key 原样返回", () => {
    expect(migrateKey("A1|abandon")).toBe("A1|abandon");
    expect(migrateKey("PHRASE|have to")).toBe("PHRASE|have to");
  });

  it("认不出来的 key 也不吞掉", () => {
    expect(migrateKey("garbage")).toBe("garbage");
  });

  it("批量换算会去重", () => {
    const out = migrateKeys(["A1|arm|n.", "C1|arm|v.", "A1|abandon|v."]);
    expect(out.sort()).toEqual(["A1|abandon", "A1|arm"]);
  });
});

describe("云端旧主键归一化", () => {
  const row = (mastered: boolean, at: number): RemoteRow => ({ mastered, at });

  it("旧 key 并到新 key，时间新的赢", () => {
    const remote = new Map<string, RemoteRow>([
      ["A1|arm|n.", row(true, 100)],
      ["C1|arm|v.", row(false, 200)],
    ]);
    const out = normalizeRemoteKeys(remote);
    expect([...out.keys()]).toEqual(["A1|arm"]);
    // 200 那条是墓碑（取消掌握）且更新 → 采信它
    expect(out.get("A1|arm")).toEqual(row(false, 200));
  });

  it("时间相同时已掌握的赢，别把进度吞掉", () => {
    const remote = new Map<string, RemoteRow>([
      ["A1|arm|n.", row(true, 100)],
      ["C1|arm|v.", row(false, 100)],
    ]);
    expect(normalizeRemoteKeys(remote).get("A1|arm")?.mastered).toBe(true);
  });

  it("本来就是新 key 的不受影响", () => {
    const remote = new Map<string, RemoteRow>([["A1|abandon", row(true, 50)]]);
    expect([...normalizeRemoteKeys(remote).keys()]).toEqual(["A1|abandon"]);
  });
});
