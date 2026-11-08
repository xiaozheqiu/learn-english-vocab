import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DrillRecord } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { DialogDescription, DialogTitle, Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
  buildDrill,
  judgeSpelling,
  summarize,
  type DrillAnswer,
  type DrillQuestion,
} from "@/lib/drill";
import { cn } from "@/lib/utils";
import type { Word } from "@/lib/types";

export interface DrillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前筛选结果（题就从这里面出） */
  words: readonly Word[];
  /** key → 中文释义 */
  glosses: ReadonlyMap<string, string>;
  /**
   * 释义分包还在下载。
   *
   * 必须和「一个都没有」分开报：弱网下第一次点开自测，分包要几百毫秒，
   * 那时算出来是 0 个可用词，若据此把「开始」置灰，用户看到的是一个
   * 点了没反应、也没说为什么的按钮。
   */
  glossesLoading?: boolean;
  /** 已掌握集合，用来决定「只测未掌握」时排除哪些词 */
  mastered: { has(key: string): boolean };
  /** 答错的词交回去取消掌握，回到待背队列 */
  onMarkTodo: (keys: readonly string[]) => void;
  /** 历史记录（按时间倒序），用于结果页那句趋势 */
  history: readonly DrillRecord[];
  /** 一轮做完时回调：把这次结果交给上层落库 */
  onFinish: (result: { at: number; total: number; correct: number }) => void;
}

const LIMITS = [10, 20, 30] as const;

/**
 * 中→英 自测。
 *
 * ## 为什么是抽屉而不是新页面
 *
 * 它做的事和词表是一件事的两面：词表给你看，自测问你。做成第三个 tab 会把
 * 「背单词」这件事拆成两个互不相干的地方，而正确答案往往就在你刚翻过的那一屏里。
 * 所以它是词表上的一个动作：拿**当前筛选结果**出题，做完关掉还在原地。
 *
 * ## 为什么不写库
 *
 * 这一版只出本轮结果。错词的下场是「取消掌握」（已有的语义），不新增
 * 「错题本」概念 —— 一份还没人用过的东西，先别急着给它建表。
 */
export function DrillSheet({
  open,
  onOpenChange,
  words,
  glosses,
  glossesLoading = false,
  mastered,
  onMarkTodo,
  history,
  onFinish,
}: DrillSheetProps) {
  const isDesktop = useIsDesktop();
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(20);
  const [todoOnly, setTodoOnly] = useState(false);
  const [seed, setSeed] = useState(0);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [answers, setAnswers] = useState<DrillAnswer[]>([]);
  /** 刚提交那一题的判定结果；null = 还没提交 */
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 题目只在「开始」那一刻定下来。
   *
   * 不能在渲染时算：`buildDrill` 依赖 seed，而每答一题都会 setState，
   * 现算会导致同一轮里题面在变 —— 与 listView 的乱序种子是同一个坑。
   */
  const [questions, setQuestions] = useState<DrillQuestion[]>([]);

  const reset = useCallback(() => {
    setStarted(false);
    setQuestions([]);
    setIndex(0);
    setInput("");
    setAnswers([]);
    setVerdict(null);
  }, []);

  const onOpen = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const start = () => {
    const exclude = todoOnly ? mastered : undefined;
    /*
     * 每一轮都要一颗**新**种子。
     *
     * 之前写的是 `seed || Date.now()` 再 `setSeed(cur => cur || Date.now())`——
     * 那只在 seed 为 0 时赋值，于是「再来一轮」沿用上一轮的 seed：题目一模一样
     * （这还算轻的），更糟的是下面「已上报」的去重键也相同，第二轮根本不记录。
     * 现在每次开始都换，并把这一轮真正用的种子存起来当去重键。
     */
    const roundSeed = Date.now() + (Math.floor(performance.now() * 1000) % 1000);
    const next = buildDrill({ words, glosses, exclude, limit, seed: roundSeed });
    /*
     * 一题都组不出来就留在设置页，别切到「0 题的结果页」。
     * 走到这里只有两种可能：释义确实一条都没到，或者筛出来的词全被排除了 ——
     * 两种情况都该让人看见「能出题 0 个」，而不是一个空的成绩单。
     */
    if (next.length === 0) return;
    setSeed(roundSeed);
    setQuestions(next);
    setIndex(0);
    setAnswers([]);
    setInput("");
    setVerdict(null);
    setStarted(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const current = questions[index];
  const done = started && index >= questions.length;
  const summary = useMemo(() => summarize(answers), [answers]);

  /**
   * 一轮做完时记一条流水。
   *
   * 去重键是「这一轮用的种子」：`done` 会随重渲染反复为真，而 effect 的依赖里
   * 又有 `summary`，不加这把锁会把同一轮记很多遍 —— 第一版就是这么把
   * 「上一次」写成了「和刚才那次持平」。
   */
  const reportedRef = useRef<number | null>(null);
  const { total: roundTotal, correct: roundCorrect } = summary;
  useEffect(() => {
    if (!done || questions.length === 0) return;
    if (reportedRef.current === seed) return;
    reportedRef.current = seed;
    onFinish({ at: Date.now(), total: roundTotal, correct: roundCorrect });
  }, [done, onFinish, questions.length, roundCorrect, roundTotal, seed]);

  /**
   * 上一次的成绩。
   *
   * 刚记下的这一轮已经在 `history[0]` 里（`saveDrill` 写完立刻重读），
   * 所以「上一次」要取第二条；只有一条时说明这是首轮，不显示趋势。
   */
  const previous = done ? history[1] : history[0];

  const submit = () => {
    if (!current || verdict !== null) return;
    const correct = current.accepted.some((want) => judgeSpelling(want, input));
    setVerdict(correct);
    setAnswers((all) => [
      ...all,
      {
        key: current.key,
        prompt: current.prompt,
        answer: current.answer,
        given: input,
        correct,
      },
    ]);
    /*
     * 答错立刻取消掌握：这是本轮唯一会改动数据的地方，而且用的是已有的语义。
     * 不额外记「错题」—— 「未掌握」本来就是这个意思，多一个集合只会互相打架。
     */
    if (!correct) onMarkTodo([current.key]);
  };

  const next = () => {
    setVerdict(null);
    setInput("");
    setIndex((value) => value + 1);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <Sheet open={open} onOpenChange={onOpen}>
      <SheetContent
        data-testid="drill-sheet"
        side={isDesktop ? "center" : "bottom"}
        className={cn(isDesktop && "max-w-md")}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-1">
          <DialogTitle className="text-[16px] font-semibold text-ink">中→英 自测</DialogTitle>
          <DialogDescription className="text-[12px] text-ink-mute">
            {started
              ? done
                ? `本轮 ${summary.total} 题，对 ${summary.correct} 题`
                : `第 ${index + 1} / ${questions.length} 题`
              : "给出中文，写出英文。只从当前筛选结果里出题。"}
          </DialogDescription>

          {!started && (
            <>
              <section className="mt-4" aria-labelledby="drill-limit-title">
                <h3 id="drill-limit-title" className="text-[13px] font-medium text-ink">
                  本轮题量
                </h3>
                <div
                  data-testid="drill-limit"
                  role="group"
                  aria-labelledby="drill-limit-title"
                  className="mt-1.5 grid grid-cols-3 gap-1.5"
                >
                  {LIMITS.map((value) => (
                    <Button
                      key={value}
                      size="touch"
                      variant={limit === value ? "subtle" : "outline"}
                      aria-pressed={limit === value}
                      onClick={() => setLimit(value)}
                      className={cn(
                        "w-full tnum",
                        limit === value && "border-brand/40 font-medium",
                      )}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </section>

              <section className="mt-4" aria-labelledby="drill-scope-title">
                <h3 id="drill-scope-title" className="text-[13px] font-medium text-ink">
                  出题范围
                </h3>
                <div
                  data-testid="drill-scope"
                  role="group"
                  aria-labelledby="drill-scope-title"
                  className="mt-1.5 grid grid-cols-2 gap-1.5"
                >
                  {(
                    [
                      { value: false, label: "全部筛选结果" },
                      { value: true, label: "只测未掌握" },
                    ] as const
                  ).map((item) => (
                    <Button
                      key={String(item.value)}
                      size="touch"
                      variant={todoOnly === item.value ? "subtle" : "outline"}
                      aria-pressed={todoOnly === item.value}
                      onClick={() => setTodoOnly(item.value)}
                      className={cn(
                        "w-full",
                        todoOnly === item.value && "border-brand/40 font-medium",
                      )}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
                <p
                  className="mt-1 text-[12px] leading-5 text-ink-mute"
                  data-testid="drill-pool"
                  data-loading={glossesLoading ? "1" : "0"}
                >
                  {glossesLoading
                    ? "正在载入释义…"
                    : `当前筛选结果里能出题的有 ${countAnswerable(words, glosses, todoOnly ? mastered : undefined)} 个。`}
                </p>
              </section>

              <p className="mt-4 rounded-card border border-line bg-paper/70 px-3 py-2 text-[12px] leading-5 text-ink-soft">
                答错的词会当场取消「已掌握」，回到待背队列。本轮结果不写库 ——
                这个功能先看看你用不用得上，等你真的想要曲线了再加记录。
              </p>
            </>
          )}

          {started && current && (
            <div className="mt-5" data-testid="drill-question" data-key={current.key}>
              <p className="rounded-card border border-line bg-paper/70 px-4 py-6 text-center">
                <span className="word-serif text-[22px] font-semibold text-ink">
                  {current.prompt}
                </span>
              </p>

              <label className="sr-only" htmlFor="drill-input">
                写出这个释义对应的英文
              </label>
              <Input
                id="drill-input"
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (verdict === null) submit();
                  else next();
                }}
                /*
                 * 判定完之后用 readOnly 而不是 disabled。
                 *
                 * disabled 的元素不可聚焦：一按回车提交，焦点掉到 body，
                 * 于是「再按回车进下一题」就不成立了 —— 用户得先拿鼠标去点按钮。
                 * readOnly 保留焦点，键盘全流程（输入 → 回车提交 → 回车下一题）
                 * 才真正成立。视觉上它和禁用几乎一样，行为上差别很大。
                 */
                readOnly={verdict !== null}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="写出英文"
                className="mt-3 h-11 text-center text-[16px]"
              />

              {verdict !== null && (
                <div
                  data-testid="drill-verdict"
                  data-correct={verdict ? "1" : "0"}
                  role="status"
                  className={cn(
                    "mt-3 flex items-start gap-2 rounded-card border px-3 py-2 text-[13px]",
                    verdict
                      ? "border-brand/30 bg-brand-wash text-brand-ink"
                      : "border-danger/25 bg-danger-wash text-danger",
                  )}
                >
                  {verdict ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0">
                    {verdict ? (
                      "对了"
                    ) : (
                      <>
                        答案是 <strong>{current.answer}</strong>
                        {current.pos && <span className="ml-1.5 opacity-70">{current.pos}</span>}
                        {input.trim() && (
                          <span className="ml-1.5 opacity-70">· 你写的「{input.trim()}」</span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {started && done && (
            <div className="mt-5" data-testid="drill-result" data-wrong={summary.wrong.length}>
              <p className="text-center text-[15px] font-medium text-ink">
                对 {summary.correct} / {summary.total}
              </p>
              {previous && (
                <p
                  className="mt-1 text-center text-[12px] text-ink-mute"
                  data-testid="drill-trend"
                  data-prev={previous.correct}
                >
                  上一次：对 {previous.correct} / {previous.total}
                  {summary.correct > previous.correct
                    ? " · 这次更好"
                    : summary.correct < previous.correct
                      ? " · 比上次少"
                      : " · 持平"}
                </p>
              )}
              {history.length > 1 && (
                <details className="mt-3 rounded-card border border-line bg-paper/50 px-3 py-2">
                  <summary className="cursor-pointer text-[12px] text-ink-soft">
                    最近 {Math.min(history.length, 5)} 次
                  </summary>
                  <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-mute tnum">
                    {history.slice(0, 5).map((record) => (
                      <li key={`${record.at}-${record.total}`} className="flex justify-between">
                        <span>{formatDrillTime(record.at)}</span>
                        <span>
                          {record.correct} / {record.total}
                          <span className="ml-2 opacity-70">{record.scope}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {summary.wrong.length > 0 ? (
                <>
                  <p className="mt-1 text-center text-[12px] text-ink-mute">
                    这些词已经退回「未掌握」，回到词表就能看到
                  </p>
                  <ul className="mt-3 divide-y divide-line/70 rounded-card border border-line">
                    {summary.wrong.map((answer) => (
                      <li
                        key={answer.key}
                        data-wrong-key={answer.key}
                        className="flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]"
                      >
                        <span className="min-w-0 truncate text-ink-soft">{answer.prompt}</span>
                        <span className="shrink-0 font-semibold text-ink">{answer.answer}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-center text-[12px] text-ink-mute">
                  全对。换一批词，或者把题量调大再来一轮。
                </p>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-card px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          {!started ? (
            <div className="flex gap-2">
              <Button
                size="touch"
                variant="outline"
                className="flex-1"
                onClick={() => onOpen(false)}
              >
                取消
              </Button>
              <Button
                data-testid="drill-start"
                size="touch"
                className="flex-1"
                onClick={start}
                // 释义还没到时不禁用：那时算出的 0 是「不知道」，不是「没有」
                disabled={
                  !glossesLoading &&
                  countAnswerable(words, glosses, todoOnly ? mastered : undefined) === 0
                }
              >
                开始
              </Button>
            </div>
          ) : done ? (
            <div className="flex gap-2">
              <Button
                data-testid="drill-restart"
                size="touch"
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={() => {
                  reset();
                  window.setTimeout(start, 0);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                再来一轮
              </Button>
              <Button size="touch" className="flex-1" onClick={() => onOpen(false)}>
                回到词表
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="touch"
                variant="outline"
                className="flex-1"
                onClick={() => onOpen(false)}
              >
                结束
              </Button>
              <Button
                data-testid="drill-submit"
                size="touch"
                className="flex-1"
                onClick={verdict === null ? submit : next}
                disabled={verdict === null && input.trim().length === 0}
              >
                {verdict === null ? "检查" : "下一题"}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** 流水的时间显示：月-日 时:分，本地时区 */
function formatDrillTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 能出多少题：有释义、且（选了「只测未掌握」时）不在已掌握集合里。
 * 出题前把这个数报出来，免得「点了开始，结果一道题都没有」。
 */
function countAnswerable(
  words: readonly Word[],
  glosses: ReadonlyMap<string, string>,
  exclude?: { has(key: string): boolean },
): number {
  let total = 0;
  for (const word of words) {
    if (exclude?.has(word.key)) continue;
    if (glosses.get(word.key)?.trim()) total += 1;
  }
  return total;
}
