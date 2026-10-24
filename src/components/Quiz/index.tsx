/**
 * 测试页（§5 F3）：抽题 → 逐题作答 → 判分 → 回写 FSRS → 结果页。
 *
 * 三条刻意的行为：
 * 1. 一套题在抽出时冻结：种子只在「换一套」时生成（Date.now()），题目数组直接存进 run，
 *    作答期间 store.records 的写入不会触发重抽 —— 否则每答一题题序都会重排。
 * 2. 判定后不自动跳题：先高亮对错并给完整释义，用户点「下一题」或按回车再前进，
 *    移动端来得及看清。
 * 3. 评分一律走 quiz.gradeFromQuiz → store.grade(key, grade, "quiz")，测试也是学习。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { PageProps } from "@/components/contracts";
import { usePageActive } from "@/hooks/usePageActive";
import { ContinueHint } from "@/components/DeviceHints";
import { buildQuiz, gradeFromQuiz, judge, type Judgement, type QuizQuestion } from "@/lib/quiz";
import { QUIZ_TYPES, type QuizType } from "@/lib/types";
import { ChoiceList } from "./ChoiceList";
import { QuizCard } from "./QuizCard";
import { QuizResult, type QuizAnswerResult } from "./QuizResult";
import { SpellInput } from "./SpellInput";

export interface QuizPageProps extends PageProps {
  /** 只练错题：给定 key 白名单，按它重新开始一套 */
  onlyKeys?: readonly string[] | null;
  /**
   * 抽题请求序号。外层每加一次就表示「给我一套新题」——
   * 只练同一批错词两次时 key 内容相同，靠内容比不出这是新请求。
   */
  requestId?: number;
  /** 换一套的范围回传，供外层记住筛选（可选） */
  onPracticeWrong?: (keys: string[]) => void;
  /** 结果页次要出口（可选）：去复习 */
  onGoReview?: () => void;
}

/** 四选一需要同池干扰项；少于这个数只能凑跨等级选项，先让用户去加载等级 */
const MIN_POOL = 8;

interface Run {
  /** 抽题种子：Date.now().toString()，实测可复现（§9 验收 7） */
  seed: string;
  /** null = 全量抽题 */
  only: string[] | null;
  /** 抽出即冻结 */
  questions: readonly QuizQuestion[];
}

/** 一套题的身份：同毫秒连开两套也不会共用 React key */
let runSeq = 0;

function normalizeTypes(raw: readonly QuizType[]): QuizType[] {
  return QUIZ_TYPES.filter((type) => raw.includes(type));
}

export function QuizPage({
  store,
  onExit,
  onlyKeys,
  requestId = 0,
  onPracticeWrong,
  onGoReview,
}: QuizPageProps) {
  // 抽题要读最新的词表/记录/偏好，但又不该被它们的变化触发重抽：走 ref 读现值
  const inputs = useRef(store);
  useEffect(() => {
    inputs.current = store;
  }, [store]);

  const draw = useCallback((only: readonly string[] | null | undefined): Run => {
    const { words, records, prefs } = inputs.current;
    const types = normalizeTypes(prefs.quizTypes);
    const seed = Date.now().toString();
    const size = Math.max(1, Math.min(prefs.quizSize, words.length));
    const limited = only && only.length > 0 ? [...only] : null;
    return {
      seed,
      only: limited,
      questions: buildQuiz({
        words,
        records,
        seed,
        size,
        types,
        // 干扰项用全量池子，才有同等级 / 同词性的选项
        pool: words,
        ...(limited ? { only: limited } : {}),
      }),
    };
  }, []);

  const [run, setRun] = useState<Run>(() => draw(onlyKeys));
  const [runStamp, setRunStamp] = useState(0);
  /**
   * 这套题有没有开始作答。
   * 测试页是常驻面板：在浮窗里改了「单套测试题量」再回来，如果这套还一道都没答，
   * 直接按新题量重抽（用户看不到任何损失）；已经答过就保持不动，改动留到下一套。
   */
  const answered = useRef(false);

  /** 换一套（空数组 = 全量）。题目抽出即冻结，答卷跟着 runner 的 key 一起归零 */
  const restart = useCallback(
    (keys: readonly string[]) => {
      answered.current = false;
      runSeq += 1;
      setRunStamp(runSeq);
      setRun(draw(keys));
    },
    [draw],
  );

  // 外层请求了一次新题（含第一次进页面）：序号变了才重抽，普通重渲染不碰这套题
  const appliedTicket = useRef(requestId);
  useEffect(() => {
    if (requestId === appliedTicket.current) return;
    appliedTicket.current = requestId;
    restart(onlyKeys ?? []);
  }, [onlyKeys, requestId, restart]);

  /**
   * 「只练错题」优先交给外层（App 会把白名单塞回来并推进请求序号），
   * 这样从结果页进入的下一套题也走同一条请求路径；外层没接就本地直接换。
   */
  const practiceWrong = useCallback(
    (keys: readonly string[]) => {
      if (onPracticeWrong) onPracticeWrong([...keys]);
      else restart(keys);
    },
    [onPracticeWrong, restart],
  );

  const onGrade = useCallback(
    (question: QuizQuestion, result: Judgement, attempts: number) => {
      answered.current = true;
      const grade = gradeFromQuiz(question, result, attempts);
      void store.grade(question.key, grade, "quiz");
    },
    [store],
  );

  // 题量改了：只在「还没开始答」时重抽，避免把正在做的这套清空
  const quizSize = store.prefs.quizSize;
  const appliedSize = useRef(quizSize);
  useEffect(() => {
    if (quizSize === appliedSize.current) return;
    appliedSize.current = quizSize;
    if (answered.current) return;
    restart(onlyKeys ?? []);
  }, [onlyKeys, quizSize, restart]);

  const types = normalizeTypes(store.prefs.quizTypes);
  const poolReady = store.ready && store.words.length >= MIN_POOL;
  const canBuild = poolReady && types.length > 0;

  /**
   * 进入页面时词表可能还在加载、题型也可能刚在浮窗里勾上，那时抽出来的是空套。
   * 一旦凑齐条件就自动补抽一套；抽不出来（比如 onlyKeys 不在当前词表里）就不动，
   * 交给下面的空态给用户下一步。
   */
  useEffect(() => {
    if (!canBuild || run.questions.length > 0) return;
    const next = draw(run.only);
    if (next.questions.length === 0) return;
    runSeq += 1;
    setRunStamp(runSeq);
    setRun(next);
  }, [canBuild, draw, run]);

  /* ── 空态（§7：每个空态都给下一步动作）────────────────────── */

  if (!store.ready || (store.loadingWords && store.words.length === 0)) {
    return (
      <Shell>
        <EmptyCard title="正在加载词表…" body="第一次打开需要读取等级分包，稍等一下。" />
      </Shell>
    );
  }

  if (types.length === 0) {
    return (
      <Shell>
        <EmptyCard
          title="没有启用任何题型"
          body="到浮窗「学习」分区勾选「英→中 / 中→英 / 拼写」中的至少一个，再回来测试。"
          action={
            <Button size="touch" onClick={onExit}>
              回词表打开浮窗
            </Button>
          }
        />
      </Shell>
    );
  }

  if (!poolReady) {
    return (
      <Shell>
        <EmptyCard
          title={`词表只有 ${store.words.length} 个词`}
          body={`四选一需要同一池子里的干扰项，至少 ${MIN_POOL} 个词才能开始。先去词表加载更多等级。`}
          action={
            <Button size="touch" onClick={onExit}>
              去词表加载等级
            </Button>
          }
        />
      </Shell>
    );
  }

  if (run.questions.length === 0) {
    return (
      <Shell>
        <EmptyCard
          title={run.only ? "这批错题练完了" : "这一套没有可出的题"}
          body={
            run.only
              ? "这些词不在当前已加载的词表里，或者单次题量设置太小。回词表加载等级后再来。"
              : "当前词表抽不出题目，换一套再试；也可能是单次题量设置过小。"
          }
          action={
            <Button size="touch" onClick={() => restart([])}>
              换一套完整的题
            </Button>
          }
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <QuizRunner
        // 换一套就换一个 runner：答案与进度自然归零，不需要在 effect 里 setState
        key={runStamp}
        questions={run.questions}
        onGrade={onGrade}
        onRestart={() => restart([])}
        onRetryWrong={practiceWrong}
        onGoReview={onGoReview}
      />
    </Shell>
  );
}

/* ── 一套题的运行态 ─────────────────────────────────────────── */

interface RunnerProps {
  questions: readonly QuizQuestion[];
  onGrade: (question: QuizQuestion, result: Judgement, attempts: number) => void;
  onRestart: () => void;
  onRetryWrong: (keys: readonly string[]) => void;
  onGoReview?: (() => void) | undefined;
}

interface AnswerState {
  /** 本题已提交次数 */
  attempts: number;
  /** 最近一次提交的原文 */
  lastGiven: string;
  /** 第一次写错的原文，结果页展示用 */
  firstWrongGiven: string;
  /** 已判错的选项（用于红标） */
  wrongChoices: string[];
  /** 已揭晓答案，本题结束 */
  revealed: boolean;
  judgement: Judgement | null;
}

const emptyAnswer = (): AnswerState => ({
  attempts: 0,
  lastGiven: "",
  firstWrongGiven: "",
  wrongChoices: [],
  revealed: false,
  judgement: null,
});

function QuizRunner({
  questions,
  onGrade,
  onRestart,
  onRetryWrong,
  onGoReview,
}: RunnerProps) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<QuizAnswerResult[]>([]);
  const [answer, setAnswer] = useState<AnswerState>(emptyAnswer);
  // 同一题只结算一次：连点两下不该写两条 FSRS 流水
  const settled = useRef<string | null>(null);

  const total = questions.length;
  const current = questions[index];
  const judgement = answer.judgement;
  const revealed = answer.revealed;

  const finalize = useCallback(
    (question: QuizQuestion, result: Judgement, attempts: number) => {
      if (settled.current === question.key) return;
      settled.current = question.key;
      onGrade(question, result, attempts);
      setResults((prev) => [
        ...prev,
        {
          question,
          judgement: result,
          attempts,
          // 一次答对 = 未看答案、未二次尝试；正确率与错题重练都按这个口径
          firstTry: result.correct && !result.hinted && attempts <= 1,
        },
      ]);
    },
    [onGrade],
  );

  const advance = useCallback(() => {
    settled.current = null;
    setAnswer(emptyAnswer());
    setIndex((value) => value + 1);
  }, []);

  /** 选择题即时判定（§5 F3）：错则标红该项并高亮正确项，本题结束 */
  const handlePick = useCallback(
    (choice: string) => {
      if (!current || answer.revealed) return;
      const result = judge(current, choice);
      setAnswer((prev) => ({
        ...prev,
        attempts: prev.attempts + 1,
        lastGiven: choice,
        revealed: true,
        judgement: result,
        wrongChoices: result.correct ? prev.wrongChoices : [...prev.wrongChoices, choice],
      }));
      finalize(current, result, 1);
    },
    [answer.revealed, current, finalize],
  );

  /** 拼写：第一次写错不给答案，允许再试一次（第二次才对 → hard） */
  const handleSpell = useCallback(
    (value: string) => {
      if (!current || answer.revealed) return;
      const result = judge(current, value);
      const attempts = answer.attempts + 1;
      const firstWrong = answer.firstWrongGiven || value;

      if (result.correct) {
        // 第二次才对算 hard：展示的「你的答案」仍记第一次写错的那个
        const shown: Judgement = { ...result, given: answer.firstWrongGiven || value };
        setAnswer((prev) => ({
          ...prev,
          attempts,
          lastGiven: value,
          revealed: true,
          judgement: shown,
        }));
        finalize(current, shown, attempts);
        return;
      }

      if (attempts < 2) {
        setAnswer((prev) => ({
          ...prev,
          attempts,
          lastGiven: value,
          firstWrongGiven: firstWrong,
        }));
        return;
      }

      const shown: Judgement = { ...result, given: firstWrong };
      setAnswer((prev) => ({
        ...prev,
        attempts,
        lastGiven: value,
        firstWrongGiven: firstWrong,
        revealed: true,
        judgement: shown,
      }));
      finalize(current, shown, attempts);
    },
    [answer, current, finalize],
  );

  /**
   * 不会，看答案 → hinted。
   * gradeFromQuiz 的「有提示 → hard(2)」要求 correct=true 且 hinted=true，
   * 所以这里给 correct: true；firstTry 仍然算错，结果页照旧把它列进错词。
   */
  const handleReveal = useCallback(() => {
    if (!current || answer.revealed) return;
    const shown: Judgement = {
      correct: true,
      hinted: true,
      given: answer.firstWrongGiven || answer.lastGiven,
    };
    setAnswer((prev) => ({ ...prev, revealed: true, judgement: shown }));
    finalize(current, shown, Math.max(1, answer.attempts));
  }, [answer, current, finalize]);

  // 判定后：回车前进。焦点在按钮/输入框上时交给原生行为，避免双重触发。
  // 页面被切走后（常驻挂载）不接这个键，否则在词表里按回车会把隐藏的题翻过去。
  const active = usePageActive();
  useEffect(() => {
    if (!revealed || !active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.isComposing) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("button, a, input, select, textarea, [contenteditable='true']")
      ) {
        return;
      }
      event.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, advance, revealed]);

  /* ── 结果页 ───────────────────────────────────────────────── */

  if (index >= total) {
    return (
      <>
        <QuizResult results={results} onRetryWrong={onRetryWrong} onRestart={onRestart} />
        {onGoReview && (
          <div className="flex justify-center">
            <Button variant="link" size="sm" onClick={onGoReview}>
              去复习到期卡片
            </Button>
          </div>
        )}
      </>
    );
  }

  if (!current) return null;

  /* ── 答题 ─────────────────────────────────────────────────── */

  const isLast = index + 1 >= total;
  const feedback = judgement
    ? judgement.hinted
      ? "已看答案，记作有提示"
      : judgement.correct
        ? answer.attempts > 1
          ? "第二次答对"
          : "答对了"
        : "答错了"
    : answer.attempts > 0
      ? "拼写不正确，再试一次"
      : "";
  const tone = judgement
    ? judgement.hinted
      ? "text-due"
      : judgement.correct
        ? "text-brand-ink"
        : "text-danger"
    : "text-danger";

  return (
    <>
      <Progress value={((index + 1) / total) * 100} label="测试进度" />

      <QuizCard question={current} index={index + 1} total={total} />

      {current.type === "spell" ? (
        <SpellInput
          // 换题重建输入框，上一题的草稿不会带过来
          key={index}
          question={current}
          attempts={answer.attempts}
          revealed={revealed}
          hinted={judgement?.hinted ?? false}
          given={judgement?.given ?? answer.lastGiven}
          onJudge={handleSpell}
          onReveal={handleReveal}
        />
      ) : (
        <ChoiceList
          question={current}
          selected={answer.lastGiven || null}
          wrongChoices={answer.wrongChoices}
          revealed={revealed}
          locked={revealed}
          onPick={handlePick}
        />
      )}

      {/* 反馈三重编码：图标 + 文案 + aria-live（§7） */}
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-6 items-center gap-1.5 px-0.5 text-[13px] font-medium"
      >
        {feedback && (
          <>
            {judgement?.hinted ? (
              <Eye className={`h-4 w-4 ${tone}`} aria-hidden="true" />
            ) : judgement?.correct ? (
              <Check className={`h-4 w-4 ${tone}`} aria-hidden="true" />
            ) : (
              <X className={`h-4 w-4 ${tone}`} aria-hidden="true" />
            )}
            <span className={tone}>{feedback}</span>
          </>
        )}
      </div>

      {/* 拼写题的「不会，看答案」在 SpellInput 里，页面上不重复放第二颗 */}
      {!revealed && current.type !== "spell" && (
        <div className="flex justify-center">
          <Button variant="outline" size="touch" onClick={handleReveal}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            不会，看答案
          </Button>
        </div>
      )}

      {revealed && (
        <>
          <Card className="border-brand/25 bg-brand-wash/40 px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="word-serif text-[20px] font-semibold text-ink">
                {current.word.word}
              </span>
              <span className="text-[12px] text-ink-mute">{current.word.pos}</span>
              <span className="text-[12px] text-ink-mute">· {current.word.level}</span>
            </div>
            <p className="mt-1 text-[13px] leading-6 text-ink-soft">{current.word.cn}</p>
          </Card>
          <div className="flex flex-col gap-1.5">
            <Button size="touch" className="w-full" onClick={advance} autoFocus>
              {isLast ? "查看结果" : "下一题"}
            </Button>
            <ContinueHint className="text-center text-[12px] text-ink-mute" />
          </div>
        </>
      )}
    </>
  );
}

/* ── 外壳与空态 ─────────────────────────────────────────────── */

/**
 * 页面外壳。
 * App 已经渲染了 <main id="main"> 和带 <h1>「测试」的 TopBar，这里只做局部容器与退出入口，
 * 不再套一层 main / h1（重复地标会让读屏的「跳转到主内容」失效）。
 */
/**
 * 页面外壳。
 *
 * 不放返回按钮：测试是底部导航（桌面是顶栏 tab）里的常驻页，
 * 切走靠导航本身，左上角再来一个「←」等于给同一个动作做两个入口。
 * 空态里那些「回词表 / 去复习」按钮是给「这一步走不下去」的情况的，
 * 和导航不是一回事，保留。
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <section aria-label="测试" className="mx-auto w-full max-w-xl px-3 pb-10 pt-3 sm:px-4">
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function EmptyCard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card className="px-4 py-8 text-center">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <p className="prose-measure mx-auto mt-2 text-[13px] leading-6 text-ink-soft">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}

export default QuizPage;
