/**
 * 结果页（§5 F3）：正确率、错词列表（可滚动）、只练错题 / 再来一套。
 * 「回词表」不放：底部导航/顶栏 tab 已经是那个动作的入口。
 *
 * 正确率口径 = 首次作答即答对（未看答案、未二次尝试）。错词列表用它，
 * 「只练错题」也只捞这些 key，FSRS 的评分档另由 gradeFromQuiz 折算。
 */
import { AlertTriangle, RotateCcw, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { percent } from "@/lib/utils";
import type { Judgement, QuizQuestion } from "@/lib/quiz";

export interface QuizAnswerResult {
  question: QuizQuestion;
  judgement: Judgement;
  /** 本题提交次数（选择题点选一次算一次） */
  attempts: number;
  /** 首次作答即答对（未看答案、未二次尝试） */
  firstTry: boolean;
}

export interface QuizResultProps {
  results: readonly QuizAnswerResult[];
  onRetryWrong: (keys: readonly string[]) => void;
  onRestart: () => void;
}

export function QuizResult({ results, onRetryWrong, onRestart }: QuizResultProps) {
  const total = results.length;
  const rightCount = results.filter((item) => item.firstTry).length;
  const rate = total > 0 ? rightCount / total : 0;
  const wrong = results.filter((item) => !item.firstTry);
  // 同一词可能重复出现，去重后重练
  const wrongKeys = [...new Set(wrong.map((item) => item.question.key))];

  return (
    <section className="flex flex-col gap-4" aria-labelledby="quiz-done-title">
      <Card className="px-4 py-5 sm:px-6">
        <h2 id="quiz-done-title" className="text-[20px] font-semibold text-ink">
          本套结束
        </h2>
        <div className="mt-3 flex items-end gap-2" role="status" aria-live="polite">
          <span className="word-serif text-[44px] font-semibold leading-none text-brand-deep tnum">
            {percent(rate)}
          </span>
          <span className="pb-1 text-[13px] text-ink-soft">正确率</span>
        </div>
        <p className="mt-2 text-[12px] text-ink-mute">
          一次答对 {rightCount} / {total} 题
          {wrong.length > 0 ? `，${wrong.length} 题需要再练` : "，全部一次答对"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="touch"
            onClick={() => onRetryWrong(wrongKeys)}
            disabled={wrongKeys.length === 0}
          >
            <Target className="h-4 w-4" aria-hidden="true" />
            只练错题（{wrongKeys.length}）
          </Button>
          <Button variant="outline" size="touch" onClick={onRestart}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            再来一套
          </Button>
        </div>
      </Card>

      {wrong.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-due" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-ink">错词</h3>
            <Badge variant="due" className="tnum">
              {wrong.length}
            </Badge>
          </div>
          {/* 可滚动区域要能聚焦，键盘用户才能滚动（§7 全部键盘可达） */}
          <ul
            tabIndex={0}
            aria-label="错词列表"
            className="max-h-[46vh] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            {wrong.map((item, at) => (
              <li
                key={`${item.question.key}-${at}`}
                className="flex flex-col gap-1 border-b border-line/70 px-4 py-3 last:border-b-0"
              >
                <div className="flex items-baseline gap-2">
                  <span className="word-serif text-[17px] font-semibold text-ink">
                    {item.question.word.word}
                  </span>
                  <span className="text-[12px] text-ink-mute">{item.question.word.pos}</span>
                </div>
                <p className="text-[13px] leading-6 text-ink-soft">{item.question.word.cn}</p>
                <p className="text-[12px] text-danger">
                  你的答案：
                  <span className="text-ink">
                    {item.judgement.hinted ? "看了答案" : item.judgement.given.trim() || "未作答"}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
