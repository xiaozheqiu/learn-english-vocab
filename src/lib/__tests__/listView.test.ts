import { describe, expect, it } from "vitest";
import {
  defaultListView,
  filterWords,
  parseListView,
  scopeProgress,
  type ListCriteria,
} from "../listView";
import { isLevelFilter, type Word } from "../types";

function w(level: Word["level"], word: string, cn = "释义"): Word {
  return {
    key: `${level}|${word}|n.`,
    level,
    word,
    pos: "n.",
    cn,
    scope: "3000",
    seq: "",
    rank: 0,
    tier: "core",
    ox3000: false,
    ox5000: false,
  };
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

const ALL: ListCriteria = {
  level: "ALL",
  mode: "all",
  tier: "all",
  oxford: "all",
  query: "",
};

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
    const view = parseListView(
      { level: "Z9", mode: "todo", tier: "all", oxford: "all", query: "ab", page: 7 },
      "A1",
    );
    expect(view).toEqual({
      level: "A1",
      mode: "todo",
      tier: "all",
      oxford: "all",
      query: "ab",
      page: 7,
    });
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
    const rows = filterWords(
      WORDS,
      { level: "A1", mode: "all", tier: "all", oxford: "all", query: "abandon" },
      masteredOf([]),
    );
    expect(rows.map((r) => r.level)).toEqual(["A1", "B2"]);
  });

  it("搜索只认单词，不匹配释义", () => {
    // 释义不在列表里显示，也没有理由再把中文当搜索入口：
    // 搜「遗弃」不该把 abandon 捞出来，否则用户会以为这是查词能力
    expect(filterWords(WORDS, { ...ALL, query: "遗弃" }, masteredOf([]))).toHaveLength(0);
  });

  it("搜索大小写不敏感，首尾空格忽略", () => {
    const rows = filterWords(WORDS, { ...ALL, query: "  ABLE  " }, masteredOf([]));
    expect(rows.map((r) => r.word)).toEqual(["able"]);
  });

  it("未掌握 / 已掌握与等级叠加", () => {
    const mastered = masteredOf(["A1|apple|n."]);
    expect(
      filterWords(
        WORDS,
        { level: "A1", mode: "todo", tier: "all", oxford: "all", query: "" },
        mastered,
      ),
    ).toHaveLength(1);
    expect(
      filterWords(
        WORDS,
        { level: "A1", mode: "done", tier: "all", oxford: "all", query: "" },
        mastered,
      ).map((r) => r.word),
    ).toEqual(["apple"]);
  });
});

/**
 * 「难度（CEFR）」筛选已经移除。
 *
 * 理由是可测的：5323 条里 5280 条的词条级 CEFR 与它所在的 A1–C1 板块完全一致
 * （99.2%），两个下拉实际筛出的是同一批词，留着只会让人以为有第二个维度。
 * 这条用例盯住「不要把它又加回 ListCriteria」。
 */
describe("筛选维度", () => {
  it("只有等级 / 档位 / 牛津词表 / 掌握状态，没有第二套难度轴", () => {
    const criteria = defaultListView("A1");
    expect(Object.keys(criteria).sort()).toEqual(
      ["level", "mode", "oxford", "page", "query", "tier"].sort(),
    );
  });

  it("牛津官方词表筛选按官方标记过滤，与等级互不影响", () => {
    const words: Word[] = [
      { ...w("B2", "genocide"), ox5000: true },
      { ...w("A1", "apple"), ox3000: true },
      { ...w("C1", "notwithstanding") },
    ];
    const base = { ...ALL };
    expect(
      filterWords(words, { ...base, oxford: "ox3000" }, masteredOf([])).map((r) => r.word),
    ).toEqual(["apple"]);
    expect(
      filterWords(words, { ...base, oxford: "ox5000" }, masteredOf([])).map((r) => r.word),
    ).toEqual(["genocide"]);
    expect(
      filterWords(words, { ...base, oxford: "none" }, masteredOf([])).map((r) => r.word),
    ).toEqual(["notwithstanding"]);
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
