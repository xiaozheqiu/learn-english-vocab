/**
 * 拼写题输入（§5 F3）：回车提交，「不会，看答案」记为 hinted。
 *
 * 判定复用 quiz.judge：忽略大小写与尾随标点、接受 `a, an` 并列写法。
 * 本题第一次写对 → easy(4)；第二次才对或看了答案 → hard(2)；两次都错 → again(1)，
 * 评分由页面用 gradeFromQuiz 折算，组件只上报判定结果。
 */
import { useState, type FormEvent } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIsTouchPrimary } from "@/components/DeviceHints";
import type { QuizQuestion } from "@/lib/quiz";

export interface SpellInputProps {
  question: QuizQuestion;
  /** 已提交次数 */
  attempts: number;
  revealed: boolean;
  hinted: boolean;
  /** 最近一次提交的原文（或第一次写错的原文） */
  given: string;
  onJudge: (value: string) => void;
  onReveal: () => void;
}

export function SpellInput({
  question,
  attempts,
  revealed,
  hinted,
  given,
  onJudge,
  onReveal,
}: SpellInputProps) {
  // 输入框草稿：错一次后保留现场，用户改一个字母就能再交（attempts 由页面递增）
  const [value, setValue] = useState("");
  const [empty, setEmpty] = useState(false);
  const touch = useIsTouchPrimary();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (revealed) return;
    if (!value.trim()) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    onJudge(value);
  };

  // 判定后的对错结论由页面统一播报（aria-live），这里只补「你写了什么 / 正确写法」
  if (revealed) {
    return (
      <div className="flex flex-col gap-1.5 rounded-btn border border-line bg-paper px-3 py-2.5 text-[14px]">
        <p className="text-ink-soft">
          你的作答：
          <span className="word-serif break-all text-ink">
            {hinted ? "（看了答案）" : given.trim() || "（空）"}
          </span>
        </p>
        <p className="text-ink-soft">
          正确答案：
          <span className="word-serif text-[17px] font-semibold text-ink">
            {question.answer}
          </span>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor="quiz-spell" className="sr-only">
        输入对应的英文单词
      </label>
      <Input
        id="quiz-spell"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setEmpty(false);
        }}
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        aria-invalid={empty}
        aria-describedby="quiz-spell-help"
        placeholder="拼出这个单词"
        className="h-11 rounded-btn text-[16px] tracking-wide"
      />
      <p id="quiz-spell-help" aria-live="polite" className="px-0.5 text-[12px] text-ink-mute">
        {empty
          ? "先输入单词再提交"
          : attempts > 0
            ? "再试一次，或点「不会，看答案」"
            : touch
              ? "忽略大小写与标点"
              : "回车提交，忽略大小写与标点"}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="touch" className="flex-1">
          提交
        </Button>
        <Button type="button" variant="outline" size="touch" onClick={onReveal}>
          <Eye className="h-4 w-4" aria-hidden="true" />
          不会，看答案
        </Button>
      </div>
    </form>
  );
}
