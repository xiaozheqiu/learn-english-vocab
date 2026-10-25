/**
 * 四选一列表（§5 F3「选择题即时判定，错则高亮正确项」）。
 *
 * 判定权在页面：这里只渲染三种态 —— 普通、答错（--danger + 图标 + 「答错」）、
 * 正确答案（--brand + 图标 + 「正确答案」）。
 * 颜色之外一定有图标和文字，色觉障碍用户不依赖颜色（§7 三重编码）。
 */
import { useEffect } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageActive } from "@/hooks/usePageActive";
import { ChoiceHint } from "@/components/DeviceHints";
import type { QuizQuestion } from "@/lib/quiz";

export interface ChoiceListProps {
  question: QuizQuestion;
  /** 最后一次点选的选项原文，用于 aria-pressed */
  selected: string | null;
  /** 已判错的选项，红标 */
  wrongChoices: readonly string[];
  /** 是否已揭晓正确答案 */
  revealed: boolean;
  /** 本题结束，不能再选 */
  locked: boolean;
  onPick: (choice: string) => void;
}

const DIGITS = "1234";
const LETTERS = "ABCD";

export function ChoiceList({
  question,
  selected,
  wrongChoices,
  revealed,
  locked,
  onPick,
}: ChoiceListProps) {
  // 键盘 1–4 / A–D：挂在 window 上，焦点停在「下一题」按钮上也能直接选。
  // 页面被切走后必须停用：测试页常驻挂载，否则在词表里敲 1 会选掉看不见的选项。
  const active = usePageActive();
  useEffect(() => {
    if (locked || !active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      const key = event.key.toUpperCase();
      const digit = DIGITS.indexOf(key);
      const at = digit >= 0 ? digit : LETTERS.indexOf(key);
      if (at < 0) return;
      const choice = question.choices[at];
      if (choice === undefined) return;
      event.preventDefault();
      onPick(choice);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, locked, onPick, question.choices]);

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-2">
        {question.choices.map((choice, at) => {
          const wrong = wrongChoices.includes(choice);
          const answer = revealed && choice === question.answer;
          const dimmed = locked && !wrong && !answer;
          return (
            <li key={choice}>
              <button
                type="button"
                aria-pressed={selected === choice}
                aria-disabled={locked}
                onClick={() => {
                  if (!locked) onPick(choice);
                }}
                className={cn(
                  // min-h 52px：远超 44px 触控下限（§7）
                  "flex min-h-[52px] w-full items-center gap-3 rounded-btn border px-3 py-2 text-left text-[15px] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
                  !wrong &&
                    !answer &&
                    "border-line bg-card text-ink hover:border-brand/40 hover:bg-brand-wash/50",
                  answer && "border-brand bg-brand-wash text-brand-ink",
                  wrong && "border-danger bg-danger-wash text-danger",
                  dimmed && "opacity-55",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] tnum",
                    answer
                      ? "border-brand text-brand-ink"
                      : wrong
                        ? "border-danger text-danger"
                        : "border-line text-ink-mute",
                  )}
                >
                  {at + 1}
                </span>
                <span className="min-w-0 flex-1 break-words">{choice}</span>
                {answer && (
                  <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    正确答案
                  </span>
                )}
                {wrong && (
                  <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium">
                    <X className="h-4 w-4" aria-hidden="true" />
                    答错
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {/* 判定后「回车继续」的提示在下一步按钮旁边，这里不重复 */}
      {!locked && <ChoiceHint className="px-0.5 text-[12px] text-ink-mute" />}
    </div>
  );
}
