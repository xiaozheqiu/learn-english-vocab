import { describe, expect, it } from "vitest";
import {
  defaultListView,
  filterWords,
  initialOf,
  parseListView,
  posTags,
  scopeProgress,
  type ListCriteria,
} from "../listView";
import { isLevelFilter, type Word } from "../types";

function w(level: Word["level"], word: string, pos = "n."): Word {
  return {
    key: `${level}|${word}|${pos}`,
    level,
    word,
    pos,
    rank: 0,
    tier: "core",
    ox3000: false,
    ox5000: false,
  };
}

const WORDS: Word[] = [w("A1", "apple"), w("A1", "abandon"), w("A2", "able"), w("B2", "abandon")];

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
  pos: "all",
  initial: "all",
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
      {
        level: "Z9",
        mode: "todo",
        tier: "all",
        oxford: "all",
        pos: "all",
        initial: "all",
        query: "ab",
        page: 7,
      },
      "A1",
    );
    expect(view).toEqual({
      level: "A1",
      mode: "todo",
      tier: "all",
      oxford: "all",
      pos: "all",
      initial: "all",
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
    const rows = filterWords(WORDS, { ...ALL, level: "A1", query: "abandon" }, masteredOf([]));
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
    expect(filterWords(WORDS, { ...ALL, level: "A1", mode: "todo" }, mastered)).toHaveLength(1);
    expect(
      filterWords(WORDS, { ...ALL, level: "A1", mode: "done" }, mastered).map((r) => r.word),
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
  it("等级 / 档位 / 牛津词表 / 词性 / 首字母 / 掌握状态，没有第二套难度轴", () => {
    const criteria = defaultListView("A1");
    expect(Object.keys(criteria).sort()).toEqual(
      ["initial", "level", "mode", "oxford", "page", "pos", "query", "tier"].sort(),
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

describe("词性解析", () => {
  it("单一词性直接命中大类", () => {
    expect([...posTags("n.")]).toEqual(["n"]);
    expect([...posTags("adj.")]).toEqual(["adj"]);
    expect([...posTags("number")]).toEqual(["number"]);
  });

  it("逗号与斜杠混写都能拆开，顺手容忍缺空格", () => {
    expect([...posTags("n., v.")].sort()).toEqual(["n", "v"]);
    expect([...posTags("n.,v.")].sort()).toEqual(["n", "v"]);
    expect([...posTags("det./pron./adv.")].sort()).toEqual(["adv", "det", "pron"]);
  });

  it("细类映射进最近的大类：情态/助动词 → 动词，冠词/不定式标记 → 限定词", () => {
    expect([...posTags("modal v.")]).toEqual(["v"]);
    expect([...posTags("v., auxiliary v.")]).toEqual(["v"]);
    expect([...posTags("indefinite article")]).toEqual(["det"]);
    expect([...posTags("definite article")]).toEqual(["det"]);
    // to 的 `prep., infinitive marker`：不定式标记不硬塞进限定词，
    // 靠 prep 这一档就能筛到，硬映射只会让人以为 to 是限定词
    expect([...posTags("prep., infinitive marker")]).toEqual(["prep"]);
  });

  it("空词性与无法识别的写法给空集合，不抛错", () => {
    expect(posTags("").size).toBe(0);
    expect(posTags("whatever.").size).toBe(0);
  });
});

describe("首字母解析", () => {
  it("取小写首字母", () => {
    expect(initialOf("Apple")).toBe("a");
    expect(initialOf("  zebra")).toBe("z");
  });

  it("取到 a–z 之外的首字符就返回空串", () => {
    // x 不在 INITIALS（按钮候选）里，但 initialOf 本身仍按字母表判定：
    // 将来数据里出现 x 开头的词，只需把它加回 INITIALS
    expect(initialOf("xylophone")).toBe("x");
    expect(initialOf("")).toBe("");
    expect(initialOf("123")).toBe("");
  });
});

describe("词性与首字母筛选", () => {
  const MIXED: Word[] = [
    w("A1", "book", "n., v."),
    w("A1", "apple", "n."),
    w("A1", "run", "v."),
    w("B2", "genocide", "n."),
    w("B2", "abrupt", "adj."),
    w("B2", "run", "v."),
  ];

  it("混合词性在每一档下都出现（book 既是名词又是动词）", () => {
    const asNoun = filterWords(MIXED, { ...ALL, pos: "n" }, masteredOf([]));
    const asVerb = filterWords(MIXED, { ...ALL, pos: "v" }, masteredOf([]));
    expect(asNoun.map((r) => r.word)).toContain("book");
    expect(asVerb.map((r) => r.word)).toContain("book");
    expect(asNoun).toHaveLength(3);
    expect(asVerb).toHaveLength(3);
  });

  it("词性与等级叠加：B2 的动词只剩 B2 那条", () => {
    const rows = filterWords(MIXED, { ...ALL, level: "B2", pos: "v" }, masteredOf([]));
    expect(rows.map((r) => `${r.level}|${r.word}`)).toEqual(["B2|run"]);
  });

  it("首字母跨等级：选 a 不被当前等级切一刀", () => {
    const rows = filterWords(MIXED, { ...ALL, level: "A1", initial: "a" }, masteredOf([]));
    expect(rows.map((r) => `${r.level}|${r.word}`)).toEqual(["A1|apple", "B2|abrupt"]);
  });

  it("首字母与词性可以叠：a 开头的形容词只剩 abrupt", () => {
    const rows = filterWords(MIXED, { ...ALL, initial: "a", pos: "adj" }, masteredOf([]));
    expect(rows.map((r) => r.word)).toEqual(["abrupt"]);
  });

  it("首字母为 all 时仍按等级过滤（浏览态之外的行为不变）", () => {
    const rows = filterWords(MIXED, { ...ALL, level: "A1" }, masteredOf([]));
    expect(rows.every((r) => r.level === "A1")).toBe(true);
  });
});

describe("视图状态里的新维度", () => {
  it("pos / initial 逐字段回落，坏值不连累其他字段", () => {
    const view = parseListView(
      { level: "B2", pos: "动词", initial: "!", query: "ab", page: 3 },
      "A1",
    );
    expect(view).toEqual({
      level: "B2",
      mode: "all",
      tier: "all",
      oxford: "all",
      pos: "all",
      initial: "all",
      query: "ab",
      page: 3,
    });
  });

  it("合法值保留，大小写不做宽松处理", () => {
    expect(parseListView({ pos: "v" }, "A1").pos).toBe("v");
    expect(parseListView({ pos: "V" }, "A1").pos).toBe("all");
    expect(parseListView({ initial: "s" }, "A1").initial).toBe("s");
    expect(parseListView({ initial: "S" }, "A1").initial).toBe("all");
    expect(parseListView({ initial: "x" }, "A1").initial).toBe("all");
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
