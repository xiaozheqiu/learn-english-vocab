import { describe, expect, it } from "vitest";
import {
  defaultListView,
  filterWords,
  isLevelFilter,
  parseListView,
  scopeProgress,
  type ListCriteria,
} from "../listView";
import type { Word } from "../types";

function w(level: Word["level"], word: string, cn = "释义"): Word {
  return { key: `${level}|${word}|n.`, level, word, pos: "n.", cn, scope: "3000", seq: "" };
}

const WORDS: Word[] = [
  w("A1", "apple", "苹果"),
  w("A1", "abandon", "放弃"),
  w("A2", "able", "能够"),
  w("B2", "abandon", "遗弃"),
];

/** 只这几个 key 记为已掌握 */
function masteredOf(keys: readonly string[]) {
  const set = new Set(keys);
  return { has: (key: string) => set.has(key) };
}

const ALL: ListCriteria = { level: "ALL", mode: "all", query: "" };

describe("视图状态解析", () => {
  it("空值 / 非对象回落成默认视图", () => {
    expect(parseListView(null, "A1")).toEqual(defaultListView("A1"));
    expect(parseListView("nonsense", "B1")).toEqual(defaultListView("B1"));
    expect(parseListView({}, "A1").level).toBe("A1");
  });

  it("非法等级回落到传入的默认等级，合法值保留", () => {
    expect(parseListView({ level: "Z9" }, "A2").level).toBe("A2");
    expect(parseListView({ level: "C1" }, "A2").level).toBe("C1");
    expect(parseListView({ level: "ALL" }, "A2").level).toBe("ALL");
    expect(isLevelFilter("B2")).toBe(true);
    expect(isLevelFilter("b2")).toBe(false);
  });

  it("逐字段回落：等级非法不影响页码和搜索词", () => {
    const view = parseListView({ level: "Z9", mode: "todo", query: "ab", page: 7 }, "A1");
    expect(view).toEqual({ level: "A1", mode: "todo", query: "ab", page: 7 });
  });

  it("页码只接受正整数，搜索词截断到 80 字", () => {
    expect(parseListView({ page: 0 }, "A1").page).toBe(1);
    expect(parseListView({ page: -3 }, "A1").page).toBe(1);
    expect(parseListView({ page: 2.7 }, "A1").page).toBe(2);
    expect(parseListView({ page: Number.NaN }, "A1").page).toBe(1);
    expect(parseListView({ query: "x".repeat(200) }, "A1").query).toHaveLength(80);
  });
});

describe("词表过滤", () => {
  it("默认等级下只出该等级", () => {
    const rows = filterWords(WORDS, { ...ALL, level: "A1" }, masteredOf([]));
    expect(rows.map((r) => r.word)).toEqual(["apple", "abandon"]);
  });

  it("搜索跨全部等级，不服从等级筛选", () => {
    const rows = filterWords(WORDS, { level: "A1", mode: "all", query: "abandon" }, masteredOf([]));
    expect(rows.map((r) => r.level)).toEqual(["A1", "B2"]);
  });

  it("搜索同时匹配释义", () => {
    const rows = filterWords(WORDS, { ...ALL, query: "遗弃" }, masteredOf([]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe("B2");
  });

  it("搜索大小写不敏感，首尾空格忽略", () => {
    const rows = filterWords(WORDS, { ...ALL, query: "  ABLE  " }, masteredOf([]));
    expect(rows.map((r) => r.word)).toEqual(["able"]);
  });

  it("未掌握 / 已掌握与等级叠加", () => {
    const mastered = masteredOf(["A1|apple|n."]);
    expect(filterWords(WORDS, { level: "A1", mode: "todo", query: "" }, mastered)).toHaveLength(1);
    expect(
      filterWords(WORDS, { level: "A1", mode: "done", query: "" }, mastered).map((r) => r.word),
    ).toEqual(["apple"]);
  });
});

describe("板块掌握进度", () => {
  it("分母是该板块总词数，只数本板块的已掌握", () => {
    const mastered = masteredOf(["A1|apple|n.", "B2|abandon|n."]);
    expect(scopeProgress(WORDS, "A1", mastered)).toEqual({
      scope: "A1",
      mastered: 1,
      total: 2,
      ratio: 0.5,
    });
    expect(scopeProgress(WORDS, "ALL", mastered)).toEqual({
      scope: "ALL",
      mastered: 2,
      total: 4,
      ratio: 0.5,
    });
  });

  it("板块没词时给 0 而不是 NaN", () => {
    const info = scopeProgress(WORDS, "C1", masteredOf([]));
    expect(info.total).toBe(0);
    expect(info.ratio).toBe(0);
    expect(Number.isNaN(info.ratio)).toBe(false);
  });
});
