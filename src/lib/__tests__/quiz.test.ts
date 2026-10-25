import { describe, expect, it } from "vitest";
import {
  buildQuiz,
  gradeFromQuiz,
  judgeSpelling,
  makeRng,
  questionWeight,
  weightedSample,
} from "../quiz";
import type { SrsCardRecord, Word } from "../types";

function word(key: string, w: string, cn: string, pos = "n.", level: Word["level"] = "A1"): Word {
  return { key, level, word: w, pos, cn, scope: "3000", seq: "" };
}

const words: Word[] = [
  word("A1|abandon|v.", "abandon", "放弃"),
  word("A1|ability|n.", "ability", "能力"),
  word("A1|about|prep.", "about", "关于"),
  word("A1|above|prep.", "above", "在……上方"),
  word("A2|accept|v.", "accept", "接受", "v.", "A2"),
  word("A2|account|n.", "account", "账户", "n.", "A2"),
  word("B1|achieve|v.", "achieve", "实现"),
  word("B1|active|adj.", "active", "积极的"),
];

describe("加权抽样", () => {
  it("同种子两次生成同一套题（验收 7）", () => {
    const a = buildQuiz({ words, records: new Map(), seed: "seed-1", size: 5, types: ["en2cn"] });
    const b = buildQuiz({ words, records: new Map(), seed: "seed-1", size: 5, types: ["en2cn"] });
    expect(a.map((q) => q.key)).toEqual(b.map((q) => q.key));
    expect(a.map((q) => q.answer)).toEqual(b.map((q) => q.answer));
  });

  it("不同种子给出不同顺序", () => {
    const a = buildQuiz({ words, records: new Map(), seed: "s1", size: 5, types: ["en2cn"] });
    const b = buildQuiz({ words, records: new Map(), seed: "s2", size: 5, types: ["en2cn"] });
    expect(a.map((q) => q.key).join()).not.toBe(b.map((q) => q.key).join());
  });

  it("错词在下一套题中出现概率更高（验收 7）", () => {
    const records = new Map<string, SrsCardRecord>();
    for (const w of words) {
      records.set(w.key, {
        key: w.key,
        due: 0,
        stability: 1,
        difficulty: 5,
        elapsed_days: 0,
        scheduled_days: 1,
        learning_steps: 0,
        reps: 3,
        lapses: 0,
        state: 2,
        right: w.key === "A1|abandon|v." ? 0 : 8,
        wrong: w.key === "A1|abandon|v." ? 8 : 0,
      });
    }
    const hits = { bad: 0, good: 0 };
    for (let i = 0; i < 120; i += 1) {
      const quiz = buildQuiz({ words, records, seed: `r${i}`, size: 2, types: ["en2cn"] });
      const keys = quiz.map((q) => q.key);
      if (keys.includes("A1|abandon|v.")) hits.bad += 1;
      if (keys.includes("A1|ability|n.")) hits.good += 1;
    }
    expect(hits.bad).toBeGreaterThan(hits.good);
  });

  it("权重公式符合文档", () => {
    expect(questionWeight(null, "en2cn")).toBeCloseTo(2, 6);
    expect(questionWeight(null, "spell")).toBeCloseTo(2.5, 6);
    const rec = { right: 2, wrong: 6 };
    const expected = ((0.6 + 2.6 * 0.75) / Math.sqrt(1 + 8 / 8)) * 1;
    expect(questionWeight(rec, "en2cn")).toBeCloseTo(expected, 6);
  });

  it("加权无放回不重复", () => {
    const rng = makeRng("x");
    const picked = weightedSample([1, 2, 3, 4, 5], () => 1, 5, rng);
    expect(new Set(picked).size).toBe(5);
  });

  it("count 超过池子时全部返回", () => {
    const rng = makeRng("x");
    expect(weightedSample([1, 2], () => 1, 10, rng)).toHaveLength(2);
  });

  it("选择题四选一且含正确答案", () => {
    const quiz = buildQuiz({ words, records: new Map(), seed: "s", size: 6, types: ["en2cn"] });
    for (const q of quiz) {
      expect(q.choices).toHaveLength(4);
      expect(q.choices).toContain(q.answer);
      expect(new Set(q.choices).size).toBe(4);
    }
  });

  it("干扰项不与正确答案同义", () => {
    const quiz = buildQuiz({ words, records: new Map(), seed: "s", size: 8, types: ["en2cn"] });
    for (const q of quiz) {
      const others = q.choices.filter((c) => c !== q.answer);
      expect(others).not.toContain(q.answer);
    }
  });

  it("拼写题接受并列写法，忽略大小写与尾随标点", () => {
    const q = buildQuiz({
      words: [word("A1|a, an|indefinite article", "a, an", "一（个）", "indefinite article")],
      records: new Map(),
      seed: "s",
      size: 1,
      types: ["spell"],
    })[0]!;
    expect(judgeSpelling(q, "a").correct).toBe(true);
    expect(judgeSpelling(q, "An").correct).toBe(true);
    expect(judgeSpelling(q, "a,").correct).toBe(true);
    expect(judgeSpelling(q, "the").correct).toBe(false);
  });

  it("回写 FSRS 的评分映射", () => {
    const q = buildQuiz({ words, records: new Map(), seed: "s", size: 1, types: ["spell"] })[0]!;
    expect(gradeFromQuiz(q, { correct: false, hinted: false, given: "" }, 1)).toBe(1);
    expect(gradeFromQuiz(q, { correct: true, hinted: false, given: "" }, 1)).toBe(4);
    expect(gradeFromQuiz(q, { correct: true, hinted: true, given: "" }, 1)).toBe(2);
    expect(gradeFromQuiz(q, { correct: true, hinted: false, given: "" }, 2)).toBe(2);
  });

  it("选择题答对最多记 hard —— 四选一有 25% 是蒙对的", () => {
    const choice = (type: "en2cn" | "cn2en") =>
      buildQuiz({
        words,
        records: new Map(),
        seed: "s",
        size: 1,
        types: [type],
        only: [words[0]!.key],
      })[0]!;

    // 英→中：认出释义不等于能想起英文，蒙对率最高，只给 hard
    const en2cn = choice("en2cn");
    expect(en2cn.type).toBe("en2cn");
    expect(gradeFromQuiz(en2cn, { correct: true, hinted: false, given: "" }, 1)).toBe(2);

    // 中→英：需要真的提取出英文单词，一次答对给 good
    const cn2en = choice("cn2en");
    expect(cn2en.type).toBe("cn2en");
    expect(gradeFromQuiz(cn2en, { correct: true, hinted: false, given: "" }, 1)).toBe(3);
  });
});
