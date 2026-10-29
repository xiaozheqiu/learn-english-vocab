import { describe, expect, it } from "vitest";
import { buildReviewPlan } from "../session";
import { CEFR_LEVELS, CEFR_RANK, isCefr, type Word } from "../types";

function w(word: string, rank: number, cefr: Word["cefr"], tier: Word["tier"] = "core"): Word {
  const key = `A1|${word}|n.`;
  return {
    key,
    level: "A1",
    word,
    pos: "n.",
    cn: "释义",
    scope: "3000",
    seq: "",
    rank,
    tier,
    cefr,
    senseCefr: [cefr],
    ox3000: false,
    ox5000: false,
  };
}

const empty = {
  records: new Map(),
  mastered: new Map(),
  prefs: { reviewSize: 300, retention: 0.9, includeExtended: false, cefrCap: "" as const },
};

describe("CEFR 基础", () => {
  it("isCefr 只认六个合法值", () => {
    for (const level of CEFR_LEVELS) expect(isCefr(level)).toBe(true);
    expect(isCefr("")).toBe(false);
    expect(isCefr("A1")).toBe(false);
    expect(isCefr("d1")).toBe(false);
    expect(isCefr(undefined)).toBe(false);
  });

  it("CEFR_RANK 单调递增", () => {
    const ranks = CEFR_LEVELS.map((l) => CEFR_RANK[l]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe("新词按 CEFR 先易后难", () => {
  it("a1 的词排在任何 b2 之前，即使 b2 的词频更高", () => {
    const words = [
      w("hard", 1, "b2"), // 词频最好，但更难
      w("easy", 9000, "a1"),
      w("mid", 50, "b1"),
    ];
    const plan = buildReviewPlan({ words, ...empty });
    expect(plan.items.map((i) => i.word.word)).toEqual(["easy", "mid", "hard"]);
  });

  it("同难度内仍按词频排", () => {
    const words = [w("rare", 5000, "a1"), w("common", 10, "a1")];
    const plan = buildReviewPlan({ words, ...empty });
    expect(plan.items.map((i) => i.word.word)).toEqual(["common", "rare"]);
  });

  it("牛津未标分级（空串）排在有分级的之后", () => {
    const words = [w("unknown", 1, ""), w("known", 9000, "c1")];
    const plan = buildReviewPlan({ words, ...empty });
    expect(plan.items.map((i) => i.word.word)).toEqual(["known", "unknown"]);
  });
});

describe("难度上限只限制新词发放", () => {
  it("cefrCap=b1 时不发 b2/c1 的新词", () => {
    const words = [w("a", 1, "a1"), w("b", 2, "b1"), w("c", 3, "b2"), w("d", 4, "c1")];
    const plan = buildReviewPlan({
      words,
      ...empty,
      prefs: { ...empty.prefs, cefrCap: "b1" },
    });
    expect(plan.items.map((i) => i.word.word)).toEqual(["a", "b"]);
  });

  it("上限不删除词：取消上限后它们回来", () => {
    const words = [w("a", 1, "a1"), w("c", 3, "b2")];
    const capped = buildReviewPlan({ words, ...empty, prefs: { ...empty.prefs, cefrCap: "a2" } });
    const free = buildReviewPlan({ words, ...empty });
    expect(capped.items.length).toBe(1);
    expect(free.items.length).toBe(2);
  });

  it("已在复习中的难词不受上限影响", () => {
    const hard = w("hard", 1, "c2");
    const records = new Map([
      [
        hard.key,
        {
          key: hard.key,
          due: Date.now() - 1000,
          stability: 1,
          difficulty: 5,
          elapsed_days: 1,
          scheduled_days: 1,
          learning_steps: 0,
          reps: 3,
          lapses: 0,
          state: 2 as const,
          right: 1,
          wrong: 0,
        },
      ],
    ]);
    const plan = buildReviewPlan({
      words: [hard],
      records,
      mastered: new Map(),
      prefs: { ...empty.prefs, cefrCap: "a2" },
    });
    expect(plan.items.map((i) => i.word.word)).toEqual(["hard"]);
  });
});
