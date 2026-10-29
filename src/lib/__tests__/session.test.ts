import { describe, expect, it } from "vitest";
import { buildReviewPlan, computeStats, computeStreak } from "../session";
import { dayKey } from "../date";
import type { DayRecord, SrsCardRecord, Word } from "../types";

const NOW = new Date("2026-03-10T10:00:00+08:00");

function w(key: string): Word {
  return {
    key,
    level: "A1",
    word: key.split("|")[1] ?? key,
    pos: "n.",
    cn: "释义",
    scope: "3000",
    seq: "",
    rank: 0,
    tier: "core",
    cefr: "",
    senseCefr: [],
    ox3000: false,
    ox5000: false,
  };
}
function card(
  key: string,
  dueOffsetDays: number,
  extra: Partial<SrsCardRecord> = {},
): SrsCardRecord {
  return {
    key,
    due: NOW.getTime() + dueOffsetDays * 86_400_000,
    stability: 10,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 10,
    learning_steps: 0,
    reps: 3,
    lapses: 0,
    state: 2,
    right: 2,
    wrong: 1,
    ...extra,
  };
}
function day(d: string, reviewed: number): DayRecord {
  return { day: d, reviewed, correct: reviewed, wrong: 0, newWords: 0 };
}

describe("复习队列", () => {
  it("只含 due ≤ now 且未掌握（验收 4）", () => {
    const words = [w("k1"), w("k2"), w("k3")];
    const records = new Map([
      ["k1", card("k1", -1)],
      ["k2", card("k2", 3)],
      ["k3", card("k3", -2)],
    ]);
    const plan = buildReviewPlan({
      words,
      records,
      mastered: new Map([["k3", NOW.getTime()]]),
      prefs: { reviewSize: 50, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(plan.items.map((i) => i.word.key)).toEqual(["k1"]);
  });

  it("按 R 升序，R 相同则逾期久的先", () => {
    const words = [w("a"), w("b"), w("c")];
    const records = new Map([
      ["a", card("a", -1, { stability: 100 })],
      ["b", card("b", -30, { stability: 5 })],
      ["c", card("c", -2, { stability: 100 })],
    ]);
    const plan = buildReviewPlan({
      words,
      records,
      mastered: new Map(),
      prefs: { reviewSize: 50, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    // b 的 R 最低（stability 小、逾期久），排最前
    expect(plan.items[0]!.word.key).toBe("b");
    expect(plan.items[1]!.word.key).toBe("c");
    expect(plan.items[2]!.word.key).toBe("a");
  });

  it("新词没有每日配额，按本轮题量自然填满", () => {
    const words = [w("n1"), w("n2"), w("n3")];
    // 题量 50 > 词数 3，全部新词都进队 —— 不再受「今天已学几个」限制
    const plan = buildReviewPlan({
      words,
      records: new Map(),
      mastered: new Map(),
      prefs: { reviewSize: 50, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(plan.items).toHaveLength(3);
    expect(plan.newTotal).toBe(3);

    // 题量小于词数时按题量截断；新词被批处理不算「欠账」，
    // carryOver 只表示「到期卡装不下」
    const limited = buildReviewPlan({
      words,
      records: new Map(),
      mastered: new Map(),
      prefs: { reviewSize: 2, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(limited.items).toHaveLength(2);
    expect(limited.carryOver).toBe(0);
  });

  it("一轮里的新词最多一批（默认 20），不做每日配额", () => {
    const many = Array.from({ length: 50 }, (_, i) => w(`n${i}`));
    const plan = buildReviewPlan({
      words: many,
      records: new Map(),
      mastered: new Map(),
      prefs: { reviewSize: 300, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    // 一轮只给 20 个新词，其余顺延到下一轮
    expect(plan.items).toHaveLength(Math.min(20, many.length));
    expect(plan.newTotal).toBe(Math.min(20, many.length));
    // 再做一轮还是 20 个（没有「今天已学满」这种状态）
    const next = buildReviewPlan({
      words: many,
      // 模拟已学掉前 20 个
      records: new Map(many.slice(0, 20).map((word) => [word.key, card(word.key, 3)])),
      mastered: new Map(),
      prefs: { reviewSize: 300, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(next.newTotal).toBe(Math.min(20, many.length - 20));
  });

  it("按单次题量截断，到期优先于新词", () => {
    const words = [w("d1"), w("d2"), w("n1"), w("n2")];
    const records = new Map([
      ["d1", card("d1", -1)],
      ["d2", card("d2", -1, { stability: 50 })],
    ]);
    const plan = buildReviewPlan({
      words,
      records,
      mastered: new Map(),
      prefs: { reviewSize: 3, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(plan.items).toHaveLength(3);
    // 到期卡先占满位置，剩下的 1 个位置给新词
    expect(plan.items.slice(0, 2).every((i) => i.record !== null)).toBe(true);
    expect(plan.dueTotal).toBe(2);
    expect(plan.newTotal).toBe(1);
  });
});

describe("积压可见", () => {
  it("到期超过单次题量时，装不下的部分算进 carryOver", () => {
    const words = Array.from({ length: 12 }, (_, i) => w(`k${i}`));
    const records = new Map(words.map((word) => [word.key, card(word.key, -1, { stability: 3 })]));
    const plan = buildReviewPlan({
      words,
      records,
      mastered: new Map(),
      prefs: { reviewSize: 8, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(plan.items).toHaveLength(8);
    expect(plan.dueTotal).toBe(12);
    expect(plan.carryOver).toBe(4);
  });

  it("做得完就没有欠账", () => {
    const words = [w("k1"), w("k2")];
    const records = new Map([
      ["k1", card("k1", -1)],
      ["k2", card("k2", -1, { stability: 20 })],
    ]);
    const plan = buildReviewPlan({
      words,
      records,
      mastered: new Map(),
      prefs: { reviewSize: 300, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(plan.carryOver).toBe(0);
  });
});

describe("「已掌握」是降频而不是毕业", () => {
  it("刚标记的已掌握词不进队列", () => {
    const words = [w("k1")];
    const plan = buildReviewPlan({
      words,
      records: new Map([["k1", card("k1", -1)]]),
      // 标记时间 = 现在，免检期内
      mastered: new Map([["k1", NOW.getTime()]]),
      prefs: { reviewSize: 50, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(plan.items).toHaveLength(0);
  });

  it("过冷却期后回到队列抽查，且不占每日新词额度", () => {
    const markedLongAgo = NOW.getTime() - 200 * 86_400_000;
    const words = [w("k1")];
    const plan = buildReviewPlan({
      words,
      // 连评分记录都没有的「已掌握」词也要被抽查到
      records: new Map(),
      mastered: new Map([["k1", markedLongAgo]]),
      prefs: { reviewSize: 50, retention: 0.9, includeExtended: false, cefrCap: "" },
      now: NOW,
    });
    expect(plan.items.map((i) => i.word.key)).toEqual(["k1"]);
    expect(plan.newTotal).toBe(0);
    expect(plan.dueTotal).toBe(1);
  });

  it("到期抽查计入「今天待复习」", () => {
    const words = [w("k1")];
    const stats = computeStats({
      words,
      records: new Map(),
      mastered: new Map([["k1", NOW.getTime() - 200 * 86_400_000]]),
      days: new Map(),
      prefs: { retention: 0.9, includeExtended: false },
      now: NOW,
    });
    expect(stats.dueToday).toBe(1);
    expect(stats.masteryCount).toBe(1);
  });
});

describe("连续打卡", () => {
  it("今天有学则从今天往回数", () => {
    const days = new Map([
      [dayKey(NOW), day(dayKey(NOW), 5)],
      ["2026-03-09", day("2026-03-09", 5)],
      ["2026-03-08", day("2026-03-08", 5)],
      ["2026-03-06", day("2026-03-06", 5)],
    ]);
    expect(computeStreak(days, NOW)).toBe(3);
  });

  it("今天没学但昨天学了仍算连续中", () => {
    const days = new Map([
      ["2026-03-09", day("2026-03-09", 5)],
      ["2026-03-08", day("2026-03-08", 5)],
    ]);
    expect(computeStreak(days, NOW)).toBe(2);
  });

  it("断两天则归零", () => {
    const days = new Map([["2026-03-07", day("2026-03-07", 5)]]);
    expect(computeStreak(days, NOW)).toBe(0);
  });

  it("空数据为 0", () => {
    expect(computeStreak(new Map(), NOW)).toBe(0);
  });
});

describe("统计", () => {
  it("正确率、已学数、掌握数、7 天预测", () => {
    const words = [w("k1"), w("k2"), w("k3")];
    const records = new Map([
      ["k1", card("k1", 0, { due: NOW.getTime() - 1000 })],
      ["k2", card("k2", 2)],
    ]);
    const days = new Map([
      [dayKey(NOW), { day: dayKey(NOW), reviewed: 10, correct: 7, wrong: 3, newWords: 4 }],
    ]);
    const stats = computeStats({
      words,
      records,
      mastered: new Map([["k3", NOW.getTime()]]),
      days,
      prefs: { retention: 0.9, includeExtended: false },
      now: NOW,
    });
    expect(stats.todayReviewed).toBe(10);
    expect(stats.todayAccuracy).toBeCloseTo(0.7, 5);
    expect(stats.learned).toBe(2);
    expect(stats.masteryCount).toBe(1);
    expect(stats.dueToday).toBe(1);
    expect(stats.forecast).toHaveLength(7);
    expect(stats.forecast[0]!.count).toBe(1);
    expect(stats.forecast[2]!.count).toBe(1);
    expect(stats.newToday).toBe(4);
  });

  it("无数据时平均留存率为 0 且不 NaN", () => {
    const stats = computeStats({
      words: [],
      records: new Map(),
      mastered: new Map(),
      days: new Map(),
      prefs: { retention: 0.9, includeExtended: false },
      now: NOW,
    });
    expect(stats.averageRetrievability).toBe(0);
    expect(stats.todayAccuracy).toBe(0);
  });
});
