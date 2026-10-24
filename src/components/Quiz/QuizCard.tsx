/**
 * 题面卡（§5 F3 / §1.3 字体）：
 * 英→中显示单词（serif 34px）+ 词性；中→英只显示中文释义；拼写显示中文释义 + 词性。
 * 衬线只给英文单词，界面文案一律无衬线（§1.1 第 2 条）。
 */
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { isMobile, transUrl } from "@/lib/trans";
import type { QuizQuestion } from "@/lib/quiz";
import type { QuizType } from "@/lib/types";

export const QUIZ_TYPE_LABELS: Record<QuizType, string> = {
  en2cn: "英 → 中",
  cn2en: "中 → 英",
  spell: "拼写",
};

export const QUIZ_TYPE_HINTS: Record<QuizType, string> = {
  en2cn: "选出正确的中文释义",
  cn2en: "选出正确的英文单词",
  spell: "拼出这个单词",
};

export interface QuizCardProps {
  question: QuizQuestion;
  /** 当前题号，1 起 */
  index: number;
  total: number;
}

export function QuizCard({ question, index, total }: QuizCardProps) {
  const isWord = question.type === "en2cn";
  return (
    <Card className="px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="default" className="tnum">
          第 {index} / {total} 题
        </Badge>
        <Badge variant="brand">{QUIZ_TYPE_LABELS[question.type]}</Badge>
      </div>

      <div className="mt-6 flex min-h-[7rem] flex-col items-center justify-center gap-2 text-center">
        {/*
          英→中的题面就是那个单词，做成外链：答不出来时可以直接查，
          比「先退出应用、再手输一遍」少三步。中→英 / 拼写题的题面是中文释义，
          不给链接 —— 那等于把答案摆在眼前。
        */}
        {isWord ? (
          <h2 className="text-[30px] leading-[1.15] sm:text-[34px]">
            <a
              href={transUrl(question.word.word)}
              target={isMobile ? undefined : "_blank"}
              rel="noopener noreferrer"
              className="word-serif break-words font-semibold text-ink underline-offset-4 hover:text-brand-ink hover:underline"
            >
              {question.prompt}
            </a>
          </h2>
        ) : (
          <h2 className="max-w-[28ch] break-words text-[20px] font-semibold leading-[1.45] text-ink">
            {question.prompt}
          </h2>
        )}
        {/* 中→英不给词性：那等于白送一半答案（§5 F3 题型定义） */}
        {question.type !== "cn2en" && question.hint && (
          <p className="text-[13px] text-ink-mute">{question.hint}</p>
        )}
      </div>

      <p className="mt-4 border-t border-line/70 pt-3 text-center text-[12px] text-ink-mute">
        {QUIZ_TYPE_HINTS[question.type]}
      </p>
    </Card>
  );
}
