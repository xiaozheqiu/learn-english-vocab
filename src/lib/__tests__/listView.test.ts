import { describe, expect, it } from "vitest";
import {
  applyOrder,
  defaultListView,
  filterWords,
  initialOf,
  parseListView,
  posTags,
  orderNeedsIndexes,
  scopeProgress,
  daysSinceMarked,
  type ListCriteria,
} from "../listView";
import { bucketLabel, isLevelFilter, type Word } from "../types";

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
  review: "all",
  confusable: "all",
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
      review: "all",
      confusable: "all",
      display: "word",
      order: "default",
      seed: 0,
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
  it("等级 / 档位 / 牛津词表 / 词性 / 首字母 / 复核 / 掌握状态，没有第二套难度轴", () => {
    const criteria = defaultListView("A1");
    /*
     * 视图只有这些键。`order` / `seed`（排序）与 `display`（显示语言）不在
     * ListCriteria 里 —— 它们都不改变结果集，所以 filterWords 不读、抽屉的
     * 条数预览也不受它们影响。改这个列表等于改「筛选维度」的定义，要有意为之。
     */
    expect(Object.keys(criteria).sort()).toEqual(
      [
        "confusable",
        "display",
        "initial",
        "level",
        "mode",
        "order",
        "oxford",
        "page",
        "pos",
        "query",
        "review",
        "seed",
        "tier",
      ].sort(),
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

  it("三个条件一起用：A1 + a 开头 + 名词 = 只剩 apple", () => {
    const rows = filterWords(
      MIXED,
      { ...ALL, level: "A1", initial: "a", pos: "n" },
      masteredOf([]),
    );
    expect(rows.map((r) => r.word)).toEqual(["apple"]);
  });

  it("首字母在当前等级内生效：停在 A1 选 a 只出 A1 那条", () => {
    // 这条盯住一个曾经做反的行为：早先把首字母当「浏览入口」，选字母就悄悄
    // 跳到全库，把用户明确设过的 A1 条件改掉了。停在 A1 的人不该被拉走。
    const rows = filterWords(MIXED, { ...ALL, level: "A1", initial: "a" }, masteredOf([]));
    expect(rows.map((r) => `${r.level}|${r.word}`)).toEqual(["A1|apple"]);
  });

  it("想跨等级就看首字母，把等级选成「全部」即可", () => {
    const rows = filterWords(MIXED, { ...ALL, level: "ALL", initial: "a" }, masteredOf([]));
    expect(rows.map((r) => `${r.level}|${r.word}`)).toEqual(["A1|apple", "B2|abrupt"]);
  });

  it("首字母与词性可以叠：a 开头的形容词只剩 abrupt", () => {
    const rows = filterWords(MIXED, { ...ALL, initial: "a", pos: "adj" }, masteredOf([]));
    expect(rows.map((r) => r.word)).toEqual(["abrupt"]);
  });

  it("首字母为 all 时仍按等级过滤", () => {
    const rows = filterWords(MIXED, { ...ALL, level: "A1" }, masteredOf([]));
    expect(rows.every((r) => r.level === "A1")).toBe(true);
  });

  it("搜索仍然跨等级：只改搜索不该把 S 开头也拉成全库", () => {
    const rows = filterWords(MIXED, { ...ALL, level: "A1", query: "run" }, masteredOf([]));
    expect(rows.map((r) => `${r.level}|${r.word}`)).toEqual(["A1|run", "B2|run"]);
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
      review: "all",
      confusable: "all",
      display: "word",
      order: "default",
      seed: 0,
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

/**
 * 排序只有一件事必须成立：同一颗种子下顺序完全确定。
 *
 * 这条约束不能靠肉眼验收 —— 若排序每次渲染都重算，翻页会看到另一批词、
 * 「刚才那一页」再也回不去，而界面上表现为「偶尔怪怪的」，很难归因。
 */
describe("排序", () => {
  const many: Word[] = Array.from({ length: 60 }, (_, i) =>
    w("A1", `word${String(i).padStart(2, "0")}`),
  );

  it("默认排序原样返回，不动输入顺序", () => {
    expect(applyOrder(many, "default", 123).map((x) => x.key)).toEqual(many.map((x) => x.key));
  });

  it("同一颗种子重复调用给出完全相同的顺序", () => {
    const a = applyOrder(many, "random", 42).map((x) => x.key);
    const b = applyOrder(many, "random", 42).map((x) => x.key);
    expect(a).toEqual(b);
  });

  it("换种子给出另一种排法", () => {
    const a = applyOrder(many, "random", 42).map((x) => x.key);
    const b = applyOrder(many, "random", 43).map((x) => x.key);
    expect(a).not.toEqual(b);
  });

  it("乱序不增删词条，只是换顺序", () => {
    const shuffled = applyOrder(many, "random", 7).map((x) => x.key);
    expect(shuffled).toHaveLength(many.length);
    expect([...shuffled].sort()).toEqual(many.map((x) => x.key).sort());
  });

  it("确实打散了字母序：与原始顺序不同的位置占多数", () => {
    const original = many.map((x) => x.key);
    const shuffled = applyOrder(many, "random", 7).map((x) => x.key);
    const samePosition = shuffled.filter((key, i) => key === original[i]).length;
    // 60 条里位置完全没变的期望值约 1 条；给到 8 已是极宽松的上界
    expect(samePosition).toBeLessThan(8);
  });

  it("不修改传入的数组", () => {
    const source = many.map((x) => x.key);
    applyOrder(many, "random", 1);
    expect(many.map((x) => x.key)).toEqual(source);
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

/**
 * 板块显示名。
 *
 * PHRASE 是内部代号，界面上必须显示「短语」—— 曾经直接印出
 * `PHRASE 已掌握 0 / 9`，看着像没做完的半成品。这条锁住映射本身。
 */
describe("板块显示名", () => {
  it("短语用中文，其余等级用代号", () => {
    expect(bucketLabel("PHRASE")).toBe("短语");
    expect(bucketLabel("A1")).toBe("A1");
    expect(bucketLabel("C1")).toBe("C1");
    expect(bucketLabel("ALL")).toBe("全库");
  });

  it("PHRASE 是合法筛选值，不会在解析时被丢掉", () => {
    expect(isLevelFilter("PHRASE")).toBe(true);
    expect(parseListView({ level: "PHRASE" }, "A1").level).toBe("PHRASE");
  });
});

/**
 * 复核筛选（`review`）：只留「标了有一阵子」的词。
 *
 * 数据来自 `mastery` 里本来就存着的标记时间 —— 此前只有云端合并读它，
 * 界面从没告诉过用户「这个词是多久前标的」，于是「已掌握」是个没有下文的终点。
 */
describe("复核筛选", () => {
  const DAY = 86_400_000;

  const WORDS_REVIEW: Word[] = [w("A1", "fresh"), w("A1", "week"), w("A1", "month")];
  const keyOf = (word: string) => WORDS_REVIEW.find((x) => x.word === word)!.key;

  /**
   * 三个词分别标于：刚标、8 天前、40 天前。
   *
   * 基准用真实的 `Date.now()`：filterWords 内部就是拿它比的，
   * 测试里固定一个历史时刻只会让断言随日历漂移。
   */
  function masteredWithTimes() {
    const now = Date.now();
    const map = new Map<string, number>([
      [keyOf("fresh"), now - 1000],
      [keyOf("week"), now - 8 * DAY],
      [keyOf("month"), now - 40 * DAY],
    ]);
    return {
      has: (key: string) => map.has(key),
      get: (key: string) => map.get(key),
    };
  }

  it("不限复核时按掌握状态原样返回", () => {
    const rows = filterWords(WORDS_REVIEW, { ...ALL, level: "A1" }, masteredWithTimes());
    expect(rows.map((r) => r.word)).toEqual(["fresh", "week", "month"]);
  });

  it("7 天以上：刚标的被排除，8 天与 40 天的留下", () => {
    const rows = filterWords(
      WORDS_REVIEW,
      { ...ALL, level: "A1", review: "d7" },
      masteredWithTimes(),
    );
    expect(rows.map((r) => r.word)).toEqual(["week", "month"]);
  });

  it("30 天以上：只剩 40 天前标的那条", () => {
    const rows = filterWords(
      WORDS_REVIEW,
      { ...ALL, level: "A1", review: "d30" },
      masteredWithTimes(),
    );
    expect(rows.map((r) => r.word)).toEqual(["month"]);
  });

  it("未掌握的词没有标记时间，不算到期（宁可漏报也不凭空报）", () => {
    const empty = { has: () => false, get: () => undefined };
    const rows = filterWords(WORDS_REVIEW, { ...ALL, level: "A1", review: "d7" }, empty);
    expect(rows).toEqual([]);
  });

  it("只有 has、给不出时间时不算到期", () => {
    const noTime = { has: () => true };
    const rows = filterWords(WORDS_REVIEW, { ...ALL, level: "A1", review: "d7" }, noTime);
    expect(rows).toEqual([]);
  });

  it("与「已掌握 / 未掌握」叠加仍然成立", () => {
    const rows = filterWords(
      WORDS_REVIEW,
      { ...ALL, level: "A1", mode: "done", review: "d7" },
      masteredWithTimes(),
    );
    expect(rows.map((r) => r.word)).toEqual(["week", "month"]);
  });

  it("坏值回落成「不限」，不会把整条视图作废", () => {
    expect(parseListView({ review: "d99" }, "A1").review).toBe("all");
    expect(parseListView({ review: "d7" }, "A1").review).toBe("d7");
  });

  it("daysSinceMarked 向下取整；没有时间给 null", () => {
    const now = Date.UTC(2026, 10, 8, 12, 0, 0);
    expect(daysSinceMarked(now, now)).toBe(0);
    expect(daysSinceMarked(now - 8.9 * DAY, now)).toBe(8);
    expect(daysSinceMarked(undefined, now)).toBe(null);
    expect(daysSinceMarked(0, now)).toBe(null);
  });
});

/**
 * 词频序（`order: "freq"`）。
 *
 * 它读 `Word.rank`，而 rank 来自 tiers.json —— 首屏快路径不载索引时 rank 全是 0。
 * 这组断言钉住两件事：
 *   1. 有 rank 时按 rank 升序（不是字母序，也不是输入顺序）；
 *   2. rank=0（索引没到）时兜底排到最后，而不是抢占最前面 ——
 *      否则开屏那一帧会把「没算过分」的词当成最高频的词顶到第一页。
 */
describe("词频排序", () => {
  function withRank(word: string, rank: number): Word {
    return { ...w("A1", word), rank, key: `A1|${word}` };
  }

  const RANKED: Word[] = [withRank("zebra", 900), withRank("apple", 3), withRank("mango", 50)];

  it("按 rank 升序，与输入顺序无关", () => {
    const out = applyOrder(RANKED, "freq", 0).map((x) => x.word);
    expect(out).toEqual(["apple", "mango", "zebra"]);
    // 把输入反过来，结果不变
    const reversed = applyOrder([...RANKED].reverse(), "freq", 0).map((x) => x.word);
    expect(reversed).toEqual(["apple", "mango", "zebra"]);
  });

  it("rank 为 0（索引未到）的词排到最后，不当成最高频", () => {
    const withZero: Word[] = [...RANKED, withRank("none", 0)];
    const out = applyOrder(withZero, "freq", 0).map((x) => x.word);
    expect(out).toEqual(["apple", "mango", "zebra", "none"]);
  });

  it("同 rank 按 key 兜底，结果稳定", () => {
    const tied: Word[] = [withRank("bbb", 7), withRank("aaa", 7)];
    const a = applyOrder(tied, "freq", 0).map((x) => x.word);
    const b = applyOrder([...tied].reverse(), "freq", 0).map((x) => x.word);
    expect(a).toEqual(b);
    expect(a).toEqual(["aaa", "bbb"]);
  });

  it("不修改传入的数组", () => {
    const input = [...RANKED];
    applyOrder(input, "freq", 0);
    expect(input.map((x) => x.word)).toEqual(["zebra", "apple", "mango"]);
  });

  it("不增删词条", () => {
    const out = applyOrder(RANKED, "freq", 0);
    expect(out).toHaveLength(RANKED.length);
    expect([...out].map((x) => x.key).sort()).toEqual(RANKED.map((x) => x.key).sort());
  });

  it("orderNeedsIndexes 只对 freq 为真", () => {
    expect(orderNeedsIndexes("freq")).toBe(true);
    expect(orderNeedsIndexes("default")).toBe(false);
    expect(orderNeedsIndexes("random")).toBe(false);
  });

  it("坏值回落成字母序", () => {
    expect(parseListView({ order: "frequency" }, "A1").order).toBe("default");
    expect(parseListView({ order: "freq" }, "A1").order).toBe("freq");
  });
});

/**
 * 中文搜索。
 *
 * 输入含汉字时按**释义**匹配，否则仍按单词匹配。分流而不是「两者都查」：
 * 查 `a` 时若同时匹配释义，会命中几百条含「一个」的词，把单词结果淹掉。
 */
describe("中文搜索", () => {
  /**
   * 这里显式按生产规则给 key（`板块|单词`），不用上面的 `w()` ——
   * 那个辅助函数把词性也拼进 key，而 Word.key 在生产里不含词性。
   * 中文搜索是按 key 去查释义表的，key 对不上就一条都命中不了。
   */
  const real = (level: Word["level"], word: string): Word => ({
    ...w(level, word),
    key: `${level}|${word}`,
  });
  const cnWords: Word[] = [
    real("A1", "answer"),
    real("A2", "reply"),
    real("A1", "apple"),
    real("B2", "abandon"),
  ];
  const CN = new Map<string, string>([
    ["A1|answer", "回答；答复"],
    ["A2|reply", "回答；回复"],
    ["A1|apple", "苹果"],
    ["B2|abandon", "抛弃；遗弃"],
  ]);

  it("含汉字时按释义匹配，可一次命中多个词", () => {
    const rows = filterWords(cnWords, { ...ALL, query: "回答" }, masteredOf([]), CN);
    expect(rows.map((r) => r.word).sort()).toEqual(["answer", "reply"]);
  });

  it("中文搜索跨等级、不服从当前等级筛选", () => {
    const rows = filterWords(cnWords, { ...ALL, level: "A1", query: "抛弃" }, masteredOf([]), CN);
    expect(rows.map((r) => r.word)).toEqual(["abandon"]);
  });

  it("英文输入仍然只按单词匹配，不会因为释义里含该字母而误命中", () => {
    // 「苹果」不含 a；但如果拿 a 去比释义，apple 的释义会被卷进来
    const rows = filterWords(cnWords, { ...ALL, query: "abandon" }, masteredOf([]), CN);
    expect(rows.map((r) => r.word)).toEqual(["abandon"]);
  });

  it("英文查询不该被释义干扰：搜 reply 只出 reply", () => {
    const rows = filterWords(cnWords, { ...ALL, query: "reply" }, masteredOf([]), CN);
    expect(rows.map((r) => r.word)).toEqual(["reply"]);
  });

  it("释义未载入时中文查询返回空集，而不是退化成不过滤", () => {
    const rows = filterWords(cnWords, { ...ALL, query: "回答" }, masteredOf([]), new Map());
    expect(rows).toEqual([]);
    const rowsUndefined = filterWords(cnWords, { ...ALL, query: "回答" }, masteredOf([]));
    expect(rowsUndefined).toEqual([]);
  });

  it("中文查询与掌握筛选叠加", () => {
    const rows = filterWords(
      cnWords,
      { ...ALL, query: "回答", mode: "done" },
      masteredOf(["A1|answer"]),
      CN,
    );
    expect(rows.map((r) => r.word)).toEqual(["answer"]);
  });

  it("释义里没有匹配就真的返回空", () => {
    expect(filterWords(cnWords, { ...ALL, query: "不存在" }, masteredOf([]), CN)).toEqual([]);
  });

  it("标点与空格不影响中文匹配（查询先 trim）", () => {
    const rows = filterWords(cnWords, { ...ALL, query: "  回答 " }, masteredOf([]), CN);
    expect(rows.map((r) => r.word).sort()).toEqual(["answer", "reply"]);
  });
});

/**
 * 易混词筛选。
 *
 * 判据是外部传进来的 key 集合（构建期由 confusables.json 算出），
 * 这里不现算分组 —— 这组断言钉的是「有集合 / 没集合」两种输入的语义。
 */
describe("易混词筛选", () => {
  const words: Word[] = [
    { ...w("A1", "answer"), key: "A1|answer" },
    { ...w("A2", "reply"), key: "A2|reply" },
    { ...w("A1", "apple"), key: "A1|apple" },
  ];
  const pairs = new Set(["A1|answer", "A2|reply"]);

  it("只出有同伴的词", () => {
    const rows = filterWords(
      words,
      { ...ALL, confusable: "only" },
      masteredOf([]),
      undefined,
      pairs,
    );
    expect(rows.map((r) => r.word).sort()).toEqual(["answer", "reply"]);
  });

  it("没有集合时返回空集，而不是全部命中", () => {
    const rows = filterWords(words, { ...ALL, confusable: "only" }, masteredOf([]));
    expect(rows).toEqual([]);
  });

  it("全部档不受影响", () => {
    const rows = filterWords(words, ALL, masteredOf([]), undefined, pairs);
    expect(rows).toHaveLength(3);
  });

  it("与等级筛选叠加：停在 A1 只剩 A1 里那个易混词", () => {
    const rows = filterWords(
      words,
      { ...ALL, level: "A1", confusable: "only" },
      masteredOf([]),
      undefined,
      pairs,
    );
    expect(rows.map((r) => r.word)).toEqual(["answer"]);
  });

  it("坏值回落成「全部」", () => {
    expect(parseListView({ confusable: "yes" }, "A1").confusable).toBe("all");
    expect(parseListView({ confusable: "only" }, "A1").confusable).toBe("only");
  });
});
