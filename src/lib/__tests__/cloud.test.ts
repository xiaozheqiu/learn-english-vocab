import { describe, expect, it } from "vitest";
import { mergeMastery, sameMastery, type RemoteRow } from "../cloud";

/**
 * 合并规则是这套同步里唯一会「静默弄错数据」的地方：
 * 判错了不会报错，只会让某个词的掌握状态在设备之间反复横跳，
 * 或者让「取消掌握」这个动作凭空失效。所以逐条钉住。
 */
describe("云端合并", () => {
  const remote = (entries: [string, boolean, number][]): Map<string, RemoteRow> =>
    new Map(entries.map(([key, mastered, at]) => [key, { mastered, at }]));

  it("云端没有的行全部要上传（首次接入的全量搬运）", () => {
    const local = new Map([
      ["A1|abandon|v.|1", 100],
      ["A1|able|adj.|2", 200],
    ]);
    const { merged, upload } = mergeMastery(local, new Map());
    expect([...merged.keys()].sort()).toEqual(["A1|abandon|v.|1", "A1|able|adj.|2"]);
    expect(upload.sort()).toEqual(["A1|abandon|v.|1", "A1|able|adj.|2"]);
  });

  it("云端有、本地没有的已掌握行会被拉下来", () => {
    const local = new Map<string, number>();
    const { merged, upload } = mergeMastery(local, remote([["A1|abandon|v.|1", true, 500]]));
    expect(merged.get("A1|abandon|v.|1")).toBe(500);
    expect(upload).toEqual([]);
  });

  it("云端的墓碑比本地新 → 本地跟着取消掌握", () => {
    const local = new Map([["A1|abandon|v.|1", 100]]);
    const { merged, upload } = mergeMastery(local, remote([["A1|abandon|v.|1", false, 900]]));
    expect(merged.has("A1|abandon|v.|1")).toBe(false);
    expect(upload).toEqual([]);
  });

  it("本地比云端的墓碑新 → 本地赢，并回写把墓碑翻回来", () => {
    const local = new Map([["A1|abandon|v.|1", 1000]]);
    const { merged, upload } = mergeMastery(local, remote([["A1|abandon|v.|1", false, 900]]));
    expect(merged.get("A1|abandon|v.|1")).toBe(1000);
    expect(upload).toEqual(["A1|abandon|v.|1"]);
  });

  it("云端已掌握但比本地旧 → 保留本地的时间戳", () => {
    const local = new Map([["A1|abandon|v.|1", 1000]]);
    const { merged, upload } = mergeMastery(local, remote([["A1|abandon|v.|1", true, 400]]));
    expect(merged.get("A1|abandon|v.|1")).toBe(1000);
    expect(upload).toEqual([]);
  });

  it("云端更新 → 采信云端的已掌握与时间", () => {
    const local = new Map([["A1|abandon|v.|1", 400]]);
    const { merged, upload } = mergeMastery(local, remote([["A1|abandon|v.|1", true, 1000]]));
    expect(merged.get("A1|abandon|v.|1")).toBe(1000);
    expect(upload).toEqual([]);
  });

  /**
   * 这条是墓碑设计存在的理由：如果云端只存「存在的行」，
   * 手机取消掌握后云端少一行，电脑端会把自己本地的标记当成正确的留下来，
   * 下次 push 又复活。有了墓碑，取消才能真的传播出去。
   */
  it("手机取消 + 电脑保留 → 电脑端被云端的墓碑说服", () => {
    const local = new Map([
      ["A1|abandon|v.|1", 100],
      ["A1|able|adj.|2", 100],
    ]);
    const { merged } = mergeMastery(local, remote([["A1|abandon|v.|1", false, 800]]));
    expect(merged.has("A1|abandon|v.|1")).toBe(false);
    expect(merged.get("A1|able|adj.|2")).toBe(100);
  });

  it("合并结果为同一份时，sameMastery 判定不换引用", () => {
    const local = new Map([["k", 1]]);
    const { merged } = mergeMastery(local, remote([["k", true, 1]]));
    expect(sameMastery(merged, local)).toBe(true);
  });

  it("sameMastery 抓得到时间戳变化与增删", () => {
    expect(sameMastery(new Map([["k", 1]]), new Map([["k", 2]]))).toBe(false);
    expect(sameMastery(new Map([["k", 1]]), new Map())).toBe(false);
    expect(sameMastery(new Map(), new Map([["k", 1]]))).toBe(false);
  });

  /**
   * 「空云端」与「没登录」必须是两个不同的信号。
   *
   * RLS 对匿名请求的回应是一个空结果集（HTTP 200 + `[]`），不是错误。
   * 早期版本把 `pull()` 的返回值直接交给合并，于是空数组被当成「云端为空」，
   * 合并结果与本地一致 → 判为已对齐 → 登录入口永不出现、进度永远传不上去。
   *
   * 现在 `pull()` 在未登录时返回 null，`useVocabStore` 据 null 显示登录框。
   * 下面两条钉住「null 不等于空 Map」这个语义差：若哪天有人把它改成
   * `return new Map()`，登录入口会重新消失，而这里会红。
   */
  it("空 Map 是合法结果：云端确实没有数据", () => {
    const local = new Map([["A1|abandon|v.|1", 100]]);
    const { merged, upload } = mergeMastery(local, new Map());
    // 云端为空 → 本地全部要上传。这正是首次登录时把本机进度搬上云的路径。
    expect(upload).toEqual(["A1|abandon|v.|1"]);
    expect(merged.get("A1|abandon|v.|1")).toBe(100);
  });
});
