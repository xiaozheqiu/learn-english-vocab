import { describe, expect, it } from "vitest";
import { buildReviewPlan, computeStats, computeStreak } from "../session";
import { dayKey } from "../date";
import type { DayRecord, SrsCardRecord, Word } from "../types";

const NOW = new Date("2026-03-10T10:00:00+08:00");

function w(key: string): Word {
  return { key, level: "A1", word: key.split("|")[1] ?? key, pos: "n.", cn: "释义", scope: "3000", seq: "" };
}
function card(key: string, dueOffsetDays: number, extra: Partial<SrsCardRecord> = {}): SrsCardRecord {
  return {
    key, due: NOW.getTime() + dueOffsetDays * 86_400_000, stability: 10, difficulty: 5,
    elapsed_days: 0, scheduled_days: 10, learning_steps: 0, reps: 3, lapses: 0, state: 2,
    right: 2, wrong: 1, ...extra,
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
      words, records, mastered: new Map([["k3", NOW.getTime()]]), newLearnedToday: 0,
      prefs: { newPerDay: 0, reviewSize: 50, retention: 0.9 }, now: NOW,
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
      words, records, mastered: new Map(), newLearnedToday: 0,
      prefs: { newPerDay: 0, reviewSize: 50, retention: 0.9 }, now: NOW,
    });
    // b 的 R 最低（stability 小、逾期久），排最前
    expect(plan.items[0]!.word.key).toBe("b");
    expect(plan.items[1]!.word.key).toBe("c");
    expect(plan.items[2]!.word.key).toBe("a");
  });

  it("新词按每日额度补，额度用完不补", () => {
    const words = [w("n1"), w("n2"), w("n3")];
    const plan = buildReviewPlan({
      words, records: new Map(), mastered: new Map(), newLearnedToday: 0,
      prefs: { newPerDay: 2, reviewSize: 50, retention: 0.9 }, now: NOW,
    });
    expect(plan.items).toHaveLength(2);
    expect(plan.newQuotaLeft).toBe(2);

    const used = buildReviewPlan({
      words, records: new Map(), mastered: new Map(), newLearnedToday: 2,
      prefs: { newPerDay: 2, reviewSize: 50, retention: 0.9 }, now: NOW,
    });
    expect(used.items).toHaveLength(0);
  });

  it("按单次题量截断，到期优先于新词", () => {
    const words = [w("d1"), w("d2"), w("n1"), w("n2")];
    const records = new Map([["d1", card("d1", -1)], ["d2", card("d2", -1, { stability: 50 })]]);
    const plan = buildReviewPlan({
      words, records, mastered: new Map(), newLearnedToday: 0,
      prefs: { newPerDay: 10, reviewSize: 3, retention: 0.9 }, now: NOW,
    });
    expect(plan.items).toHaveLength(3);
    expect(plan.items.slice(0, 2).every((i) => i.record !== null)).toBe(true);
    expect(plan.dueTotal).toBe(2);
    expect(plan.newTotal).toBe(2);
  });
});

describe("积压可见", () => {
  it("到期超过单次题量时，装不下的部分算进 carryOver", () => {
    const words = Array.from({ length: 12 }, (_, i) => w(`k${i}`));
    const records = new Map(words.map((word) => [word.key, card(word.key, -1, { stability: 3 })]));
    const plan = buildReviewPlan({
      words, records, mastered: new Map(), newLearnedToday: 0,
      prefs: { newPerDay: 0, reviewSize: 8, retention: 0.9 }, now: NOW,
    });
    expect(plan.items).toHaveLength(8);
    expect(plan.dueTotal).toBe(12);
    expect(plan.carryOver).toBe(4);
  });

  it("做得完就没有欠账", () => {
    const words = [w("k1"), w("k2")];
    const records = new Map([["k1", card("k1", -1)], ["k2", card("k2", -1, { stability: 20 })]]);
    const plan = buildReviewPlan({
      words, records, mastered: new Map(), newLearnedToday: 0,
      prefs: { newPerDay: 0, reviewSize: 300, retention: 0.9 }, now: NOW,
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
      newLearnedToday: 0,
      prefs: { newPerDay: 0, reviewSize: 50, retention: 0.9 },
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
      newLearnedToday: 0,
      prefs: { newPerDay: 0, reviewSize: 50, retention: 0.9 },
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
      prefs: { retention: 0.9 },
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
    const days = new Map([[dayKey(NOW), { day: dayKey(NOW), reviewed: 10, correct: 7, wrong: 3, newWords: 4 }]]);
    const stats = computeStats({
      words, records, mastered: new Map([["k3", NOW.getTime()]]), days,
      prefs: { retention: 0.9 }, now: NOW,
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
      words: [], records: new Map(), mastered: new Map(), days: new Map(),
      prefs: { retention: 0.9 }, now: NOW,
    });
    expect(stats.averageRetrievability).toBe(0);
    expect(stats.todayAccuracy).toBe(0);
  });
});
