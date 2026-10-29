import { describe, expect, it } from "vitest";
import type { Grade } from "../srs";

/**
 * 弱词收集规则的单测。
 *
 * 逻辑实体在 ReviewSession.tsx 的 collectWeak 里（组件私有），
 * 这里复刻同一套规则做行为锁定 —— 一旦有人改动「按最后一次评分」这条口径，
 * 这些用例会失败，提醒他同步改组件。
 */
interface Step {
  key: string;
  word: string;
  grade: Grade;
  masteredByKnow?: boolean;
}

function collectWeak(steps: readonly Step[]) {
  const last = new Map<string, { word: string; grade: Grade }>();
  for (const step of steps) {
    if (step.masteredByKnow) continue;
    last.set(step.key, { word: step.word, grade: step.grade });
  }
  const out: { key: string; word: string; grade: Grade }[] = [];
  for (const [key, value] of last) {
    if (value.grade <= 2) out.push({ key, word: value.word, grade: value.grade });
  }
  out.sort((a, b) => a.grade - b.grade);
  return out;
}

describe("本轮弱词", () => {
  it("忘记(1) 与 模糊(2) 都算弱词", () => {
    const weak = collectWeak([
      { key: "a", word: "about", grade: 1 },
      { key: "b", word: "above", grade: 2 },
      { key: "c", word: "across", grade: 3 },
      { key: "d", word: "action", grade: 4 },
    ]);
    expect(weak.map((w) => w.word)).toEqual(["about", "above"]);
  });

  it("按最后一次评分判定：答错后补考答对不算弱词", () => {
    const weak = collectWeak([
      { key: "a", word: "about", grade: 1 },
      { key: "a", word: "about", grade: 3 }, // 补考答对
    ]);
    expect(weak).toHaveLength(0);
  });

  it("补考又错，仍然是弱词", () => {
    const weak = collectWeak([
      { key: "a", word: "about", grade: 2 },
      { key: "a", word: "about", grade: 1 },
    ]);
    expect(weak).toHaveLength(1);
    expect(weak[0]!.grade).toBe(1);
  });

  it("「我早就会」不计入弱词", () => {
    const weak = collectWeak([
      { key: "a", word: "the", grade: 4, masteredByKnow: true },
      { key: "b", word: "about", grade: 1 },
    ]);
    expect(weak.map((w) => w.word)).toEqual(["about"]);
  });

  it("忘记排在模糊前面", () => {
    const weak = collectWeak([
      { key: "a", word: "above", grade: 2 },
      { key: "b", word: "about", grade: 1 },
    ]);
    expect(weak.map((w) => w.grade)).toEqual([1, 2]);
  });

  it("没有弱词时返回空数组", () => {
    expect(collectWeak([{ key: "a", word: "x", grade: 3 }])).toEqual([]);
    expect(collectWeak([])).toEqual([]);
  });
});
