import { describe, expect, it } from "vitest";
import {
  acceptedSpellings,
  buildDrill,
  judgeSpelling,
  normalize,
  summarize,
  type DrillAnswer,
} from "../drill";
import type { Word } from "../types";

function w(word: string, gloss: string, level: Word["level"] = "A1"): Word {
  return {
    key: `${level}|${word}`,
    level,
    word,
    pos: "n.",
    rank: 0,
    tier: "core",
    ox3000: false,
    ox5000: false,
  };
}

const WORDS: Word[] = [
  w("apple", "苹果"),
  w("abandon", "放弃"),
  w("knee", "膝盖"),
  w("a, an", "一个"),
  w("ice cream", "冰淇淋"),
  // 没有释义的词：不该出现在题里
  w("ghost", ""),
];

const GLOSSES = new Map<string, string>([
  ["A1|apple", "苹果"],
  ["A1|abandon", "放弃"],
  ["A1|knee", "膝盖"],
  ["A1|a, an", "一个"],
  ["A1|ice cream", "冰淇淋"],
]);

describe("判分", () => {
  it("大小写、首尾空白、尾随标点都不该判错", () => {
    expect(judgeSpelling("apple", "APPLE")).toBe(true);
    expect(judgeSpelling("apple", "  apple  ")).toBe(true);
    expect(judgeSpelling("apple", "apple.")).toBe(true);
    expect(judgeSpelling("ice cream", "Ice   Cream")).toBe(true);
  });

  it("拼错就是错，不做近似匹配", () => {
    expect(judgeSpelling("apple", "aple")).toBe(false);
    expect(judgeSpelling("apple", "apples")).toBe(false);
    expect(judgeSpelling("knee", "kneel")).toBe(false);
  });

  it("空输入不算对（哪怕答案本身为空也不会）", () => {
    expect(judgeSpelling("apple", "")).toBe(false);
    expect(judgeSpelling("apple", "   ")).toBe(false);
  });

  it("并列写法任一都对：a, an 的 an 与 a 都算", () => {
    const accepted = acceptedSpellings("a, an");
    expect(accepted).toContain("a");
    expect(accepted).toContain("an");
    expect(accepted).toContain("a an");
    expect(accepted.some((want) => judgeSpelling(want, "an"))).toBe(true);
    expect(accepted.some((want) => judgeSpelling(want, "a"))).toBe(true);
  });

  it("含空格的短语整体也接受，不按空格拆", () => {
    const accepted = acceptedSpellings("ice cream");
    expect(accepted).toContain("ice cream");
    expect(accepted.some((want) => judgeSpelling(want, "ice cream"))).toBe(true);
  });

  it("归一化只关心「不该判错」的那几样", () => {
    expect(normalize("  A, An  ")).toBe("a an");
    expect(normalize("Ice-Cream")).toBe("ice cream");
  });
});

describe("出题", () => {
  it("只挑有释义的词", () => {
    const questions = buildDrill({ words: WORDS, glosses: GLOSSES, limit: 99, seed: 1 });
    expect(questions.map((q) => q.key)).not.toContain("A1|ghost");
    expect(questions).toHaveLength(5);
  });

  it("题面是那个词的中文，答案是那个词的英文", () => {
    for (const question of buildDrill({ words: WORDS, glosses: GLOSSES, limit: 5, seed: 1 })) {
      expect(question.prompt).toBe(GLOSSES.get(question.key));
      expect(question.key).toBe(`${question.key.split("|")[0]}|${question.answer}`);
    }
  });

  it("同一颗种子给出同一套题、同一顺序", () => {
    const a = buildDrill({ words: WORDS, glosses: GLOSSES, limit: 5, seed: 42 });
    const b = buildDrill({ words: WORDS, glosses: GLOSSES, limit: 5, seed: 42 });
    expect(a.map((q) => q.key)).toEqual(b.map((q) => q.key));
  });

  it("换种子换一套顺序", () => {
    const a = buildDrill({ words: WORDS, glosses: GLOSSES, limit: 5, seed: 42 });
    const b = buildDrill({ words: WORDS, glosses: GLOSSES, limit: 5, seed: 43 });
    expect(a.map((q) => q.key)).not.toEqual(b.map((q) => q.key));
  });

  it("题量上限生效，且不重复出同一题", () => {
    const questions = buildDrill({ words: WORDS, glosses: GLOSSES, limit: 3, seed: 7 });
    expect(questions).toHaveLength(3);
    expect(new Set(questions.map((q) => q.key)).size).toBe(3);
  });

  it("可用词不够时给多少算多少，不报错", () => {
    const questions = buildDrill({ words: WORDS, glosses: GLOSSES, limit: 50, seed: 7 });
    expect(questions).toHaveLength(5);
  });

  it("exclude 里的词不出题（只测未掌握时用）", () => {
    const exclude = { has: (key: string) => key === "A1|apple" || key === "A1|knee" };
    const questions = buildDrill({ words: WORDS, glosses: GLOSSES, exclude, limit: 99, seed: 3 });
    expect(questions.map((q) => q.key).sort()).toEqual(["A1|a, an", "A1|abandon", "A1|ice cream"]);
  });

  it("释义表为空时出不了题（不是出一堆空题干）", () => {
    expect(buildDrill({ words: WORDS, glosses: new Map(), limit: 10, seed: 1 })).toEqual([]);
  });
});

describe("本轮统计", () => {
  const answer = (key: string, correct: boolean): DrillAnswer => ({
    key,
    prompt: "中文",
    answer: "word",
    given: correct ? "word" : "wrong",
    correct,
  });

  it("数出对错，错题按出现顺序列出", () => {
    const summary = summarize([answer("a", true), answer("b", false), answer("c", false)]);
    expect(summary.total).toBe(3);
    expect(summary.correct).toBe(1);
    expect(summary.wrong.map((x) => x.key)).toEqual(["b", "c"]);
  });

  it("全对时错词清单为空", () => {
    const summary = summarize([answer("a", true)]);
    expect(summary.wrong).toEqual([]);
    expect(summary.correct).toBe(1);
  });
});
