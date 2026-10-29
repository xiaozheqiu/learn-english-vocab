import { describe, expect, it } from "vitest";
import { listLeeches, leechSeverity } from "../leech";
import { buildReviewPlan } from "../session";
import { isLeech, isShelvedAsLeech, leechDueAt, statusOf } from "../srs";
import { LEECH_COOLDOWN_DAYS, LEECH_THRESHOLD, type SrsCardRecord, type Word } from "../types";

const DAY = 86_400_000;
const NOW = new Date("2026-03-10T10:00:00+08:00");

function w(word: string): Word {
  const key = `A1|${word}|n.`;
  return {
    key,
    level: "A1",
    word,
    pos: "n.",
    cn: "释义",
    scope: "3000",
    seq: "",
    rank: 1,
    tier: "core",
    cefr: "a1",
    senseCefr: ["a1"],
    ox3000: false,
    ox5000: false,
  };
}

function card(key: string, lapses: number, lastReview = NOW.getTime() - DAY): SrsCardRecord {
  return {
    key,
    due: NOW.getTime() - DAY,
    stability: 0.3,
    difficulty: 8,
    elapsed_days: 1,
    scheduled_days: 1,
    learning_steps: 0,
    reps: lapses + 3,
    lapses,
    state: 2,
    last_review: lastReview,
    right: 2,
    wrong: lapses,
  };
}

const prefs = { reviewSize: 300, retention: 0.9, includeExtended: false, cefrCap: "" as const };

describe("顽固词判定", () => {
  it("忘记次数达到阈值才算顽固词", () => {
    expect(isLeech(card("k", LEECH_THRESHOLD - 1))).toBe(false);
    expect(isLeech(card("k", LEECH_THRESHOLD))).toBe(true);
    expect(isLeech(card("k", LEECH_THRESHOLD + 5))).toBe(true);
  });

  it("没有记录不算顽固词", () => {
    expect(isLeech(null)).toBe(false);
  });

  it("冷却期内被挡在队列外，到期后自动放行", () => {
    const record = card("k", 9);
    expect(isShelvedAsLeech(record, NOW)).toBe(true);

    const later = new Date(NOW.getTime() + (LEECH_COOLDOWN_DAYS + 1) * DAY);
    expect(isShelvedAsLeech(record, later)).toBe(false);
  });

  it("leechDueAt 从最近一次复习起算冷却期", () => {
    const record = card("k", 9);
    expect(leechDueAt(record)).toBe(record.last_review! + LEECH_COOLDOWN_DAYS * DAY);
  });
});

describe("顽固词不占主复习队列", () => {
  const words = [w("hard"), w("easy")];

  it("冷却期内的顽固词不出现在计划里", () => {
    const records = new Map([["A1|hard|n.", card("A1|hard|n.", 10)]]);
    const plan = buildReviewPlan({ words, records, mastered: new Map(), prefs, now: NOW });
    const keys = plan.items.map((i) => i.word.word);
    expect(keys).not.toContain("hard");
    expect(keys).toContain("easy");
  });

  it("冷却期过后的顽固词会自己回到队列", () => {
    const old = NOW.getTime() - (LEECH_COOLDOWN_DAYS + 2) * DAY;
    const records = new Map([["A1|hard|n.", card("A1|hard|n.", 10, old)]]);
    const plan = buildReviewPlan({ words, records, mastered: new Map(), prefs, now: NOW });
    expect(plan.items.map((i) => i.word.word)).toContain("hard");
  });

  it("普通到期词正常进队列，未评分的词按新词进队列", () => {
    // easy 是「已学、到期待复习」；hard 完全没有记录，会当作新词出现在队列里 ——
    // 这条测试确认的是：leech 过滤只作用于达到阈值的卡，不会误伤新词。
    const records = new Map([["A1|easy|n.", card("A1|easy|n.", 1)]]);
    const plan = buildReviewPlan({ words, records, mastered: new Map(), prefs, now: NOW });
    expect(plan.items.map((i) => i.word.word)).toEqual(["easy", "hard"]);
  });
});

describe("顽固词状态显示", () => {
  it("冷却期内显示忘记次数", () => {
    const info = statusOf(card("k", 11), false, NOW);
    expect(info.kind).toBe("leech");
    expect(info.label).toContain("11");
  });

  it("冷却期满后提示待复考", () => {
    const old = NOW.getTime() - (LEECH_COOLDOWN_DAYS + 2) * DAY;
    const info = statusOf(card("k", 11, old), false, NOW);
    expect(info.kind).toBe("leech");
    expect(info.label).toContain("待复考");
  });

  it("已掌握优先于顽固词", () => {
    expect(statusOf(card("k", 20), true, NOW).kind).toBe("mastered");
  });
});

describe("顽固词清单", () => {
  it("只收达到阈值的词，按忘记次数降序", () => {
    const records = new Map([
      ["A1|a|n.", card("A1|a|n.", 9)],
      ["A1|b|n.", card("A1|b|n.", 15)],
      ["A1|c|n.", card("A1|c|n.", 2)],
    ]);
    const items = listLeeches([w("a"), w("b"), w("c")], records, NOW);
    expect(items.map((i) => i.word.word)).toEqual(["b", "a"]);
    expect(items[0]!.lapses).toBe(15);
  });

  it("同次数下，快回归的排前面", () => {
    const soon = card("A1|soon|n.", 9, NOW.getTime() - (LEECH_COOLDOWN_DAYS - 1) * DAY);
    const later = card("A1|later|n.", 9, NOW.getTime() - 1 * DAY);
    const records = new Map([
      ["A1|soon|n.", soon],
      ["A1|later|n.", later],
    ]);
    const items = listLeeches([w("soon"), w("later")], records, NOW);
    expect(items[0]!.word.word).toBe("soon");
    expect(items[0]!.daysUntilReturn).toBeLessThan(items[1]!.daysUntilReturn);
  });

  it("严重程度分档", () => {
    expect(leechSeverity(8)).toBe("medium");
    expect(leechSeverity(11)).toBe("high");
    expect(leechSeverity(20)).toBe("severe");
  });
});
