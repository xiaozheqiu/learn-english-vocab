import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RatingBar } from "./RatingBar";
import { ReviewCard } from "./ReviewCard";
import { ReviewDone, type ReviewSummary } from "./ReviewDone";
import { saveDay } from "@/lib/db";
import { dayKey, formatInterval } from "@/lib/date";
import { previewGrades, type Grade } from "@/lib/srs";
import type { ReviewItem } from "@/lib/session";
import { MASTERY_COOLDOWN_DAYS, type DayRecord, type SrsCardRecord, type Word } from "@/lib/types";
import { usePageActive } from "@/hooks/usePageActive";
import { ReviewHint } from "@/components/DeviceHints";
import type { VocabStore } from "@/hooks/useVocabStore";

/** 会话内已提交的一步。撤销靠它把卡片与当日计数一起回滚 */
interface Step {
  key: string;
  /** 提交前的卡片快照；null = 这张此前没有卡片，撤销时删掉 */
  before: SrsCardRecord | null;
  grade: Grade;
  /** 提交前是否「从未评分」，决定要不要退回当日新词额度 */
  wasNew: boolean;
  /** 提交时的本地日期键：跨零点还在复习时，计数要退回到当时那一天而不是今天 */
  day: string;
  word: string;
  /** 这张是本轮补考（答错后末尾重来），统计时不算新学 */
  retry?: boolean;
}

export interface ReviewSessionProps {
  /** 进入时构建一次的队列快照；本组件不重算队列 */
  items: readonly ReviewItem[];
  /** 本次队列的规模信息：到期总量、装不下的部分 */
  plan?: { dueTotal: number; carryOver: number; limit: number };
  store: VocabStore;
  /** 「再来一轮」：由页面重新构建队列 */
  onAgain: () => void;
  onGoQuiz: () => void;
  onExit: () => void;
}

/**
 * 会话容器：进度 7/42、当前卡、四档评分、撤销、空态、结束页。
 * 队列为空不出白屏，直接给「今天已清空」+ 下次到期 + 去测试（§7 空态）。
 */
export function ReviewSession(props: ReviewSessionProps) {
  if (props.items.length === 0) {
    return <ReviewEmpty store={props.store} onGoQuiz={props.onGoQuiz} onExit={props.onExit} />;
  }
  return <ReviewRunner {...props} />;
}

function ReviewRunner({ items: initialItems, plan, store, onAgain, onGoQuiz, onExit }: ReviewSessionProps) {
  // 已提交的评分栈：长度即进度指针；撤销只弹栈，进度与统计自动回退
  const [steps, setSteps] = useState<Step[]>([]);
  /**
   * 本轮队列。答错（again）的卡会在末尾再考一次 —— 这是长期记忆里最划算的一环：
   * 同一天内隔十几张再回忆一次，比隔 24 小时更有效，也不会把「今天没记住」
   * 全堆到明天的队列里变成雪球。本轮已经补考过的就不再补（retry 标记），
   * 免得一张卡反复失败卡住整轮。
   */
  const [items, setItems] = useState<ReviewItem[]>(() => [...initialItems]);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const busyRef = useRef(false);
  const startedAt = useRef(Date.now());

  const total = items.length;
  const done = steps.length;
  const current = items[done] ?? null;
  const record = current ? store.records.get(current.word.key) ?? current.record : null;

  // 预览按「库里当前的卡片」算：撤销后重新评分时，印的间隔仍然是真实排期（验收 4）。
  // record 为 null = 新词，previewGrades 自己会按空卡算，四档按钮必须照样出现。
  const previews = useMemo(
    () => (current ? previewGrades(record, new Date(), store.prefs.retention) : []),
    [current, record, store.prefs.retention],
  );

  const reveal = useCallback(() => setRevealed(true), []);

  const submit = useCallback(
    async (grade: Grade) => {
      const item = items[done];
      if (!item || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        // 快照必须在 store.grade 之前取：grade 内部已经乐观写了新卡片
        const before = store.records.get(item.word.key) ?? null;
        await store.grade(item.word.key, grade, "review");
        const retry = Boolean(item.retry);
        setSteps((prev) => [
          ...prev,
          {
            key: item.word.key,
            before,
            grade,
            wasNew: !before || before.reps <= 0,
            day: dayKey(),
            word: item.word.word,
            retry,
          },
        ]);
        setRevealed(false);
        const preview = previews.find((p) => p.grade === grade);
        const requeued = grade === 1 && !retry;
        if (requeued) {
          // 答错的卡排到队尾再考一次；这一轮结束时才算真正排到明天
          setItems((prev) => {
            const next = [...prev];
            next.push({ ...item, retry: true });
            return next;
          });
          setNotice(`已记为忘记，本轮末尾再考一次 ${item.word.word}`);
        } else {
          setNotice(preview ? `已记为${preview.label}，${preview.text}后复习` : "已记录");
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [done, items, previews, store],
  );

  const undo = useCallback(async () => {
    const step = steps[steps.length - 1];
    if (!step || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await store.restoreCard(step.key, step.before);
      // restoreCard 只回滚卡片；reviewed/correct/newWords 是 grade 写的，得单独退
      await rollbackDay(store, step);
      // 让 days / records / prefs 重新读库，统计与浮窗不会停在旧值
      await store.refresh();
      setSteps((prev) => prev.slice(0, -1));
      // 那一步如果是「答错→追加补考」，撤销时把队尾那张补考一起拿掉，
      // 否则撤销完还会被多考一次
      if (step.grade === 1 && !step.retry) {
        setItems((prev) =>
          prev.length > 0 && prev[prev.length - 1]?.retry ? prev.slice(0, -1) : prev,
        );
      }
      // 回到上一张时保持翻面：撤销通常是「刚才点错了」，不该逼人再按一次空格
      setRevealed(true);
      setNotice(`已撤销 ${step.word}，可以重新评分`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [steps, store]);

  // 键盘：空格/回车翻面、1–4 评分、Ctrl/Cmd+Z 撤销（§7 全部键盘可达）
  // 复习页常驻挂载，切到别的 tab 后这些键必须停用，否则在词表/测试里会误评分。
  const active = usePageActive();
  useEffect(() => {
    // 队列走完 / 已退出到结束页 / 页面被藏起来时不再接评分键
    if (!active || summary || done >= total) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      }
      // 焦点在按钮/链接上时把空格与回车留给原生激活，否则键盘用户按不动「撤销」
      const onControl =
        target instanceof HTMLElement &&
        Boolean(target.closest("button, a, [role='button'], summary"));
      const mod = event.metaKey || event.ctrlKey;
      if (mod) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          void undo();
        }
        return;
      }
      if (event.altKey) return;
      if (event.key === " " || event.key === "Enter") {
        if (onControl || revealed) return;
        event.preventDefault();
        reveal();
        return;
      }
      if (!revealed) return;
      if (["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        void submit(Number(event.key) as Grade);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, revealed, reveal, submit, undo, summary, done, total]);

  const summaryOf = useCallback(
    (list: readonly Step[]): ReviewSummary => ({
      reviewed: list.length,
      byGrade: countGrades(list),
      durationMs: Date.now() - startedAt.current,
    }),
    [],
  );

  // 队列耗尽 → 直接进结束页。用 memo 在这一帧算一次，不会先渲染一张空卡再补统计
  const exhaustedSummary = useMemo<ReviewSummary | null>(
    () => (done >= total ? summaryOf(steps) : null),
    [done, total, steps, summaryOf],
  );

  // 退出 = 进入完成态（§5 F2：队列耗尽或点退出都走结束页）
  const exitNow = useCallback(() => setSummary(summaryOf(steps)), [steps, summaryOf]);

  const finished = summary ?? exhaustedSummary;
  if (finished) {
    return (
      <ReviewDone
        summary={finished}
        carryOver={plan?.carryOver ?? 0}
        onAgain={onAgain}
        onGoQuiz={onGoQuiz}
        onExit={onExit}
      />
    );
  }

  if (!current) return null;

  const isNew = !record || record.reps <= 0;
  const percentDone = (done / total) * 100;

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pb-6 pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[20px] font-semibold leading-[1.3] text-ink">复习</h1>
          {isNew && <Badge variant="brand">新词</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-11 px-2.5"
            onClick={() => void undo()}
            disabled={done === 0 || busy}
            aria-keyshortcuts="Control+Z Meta+Z"
          >
            撤销
          </Button>
          <Button size="sm" variant="outline" className="h-11 px-3" onClick={exitNow}>
            退出
          </Button>
        </div>
      </div>

      {/*
        欠账提示：到期卡比单次题量多时，明确写出「还剩 N 张留到明天」。
        不提示的话，用户会以为今天已经做完了，欠账在后台悄悄累积。
      */}
      {plan && plan.carryOver > 0 && (
        <p
          role="status"
          className="mt-2 rounded-btn border border-due/30 bg-due-wash px-2.5 py-1.5 text-[12px] leading-5 text-due tnum"
        >
          今天到期 {plan.dueTotal} 张，本轮做 {items.length} 张，剩余 {plan.carryOver} 张留到明天
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Progress
          value={percentDone}
          label={`复习进度：已完成 ${done} 张，共 ${total} 张`}
          className="flex-1"
        />
        <span aria-hidden="true" className="text-[12px] tnum text-ink-mute">
          {done}/{total}
        </span>
      </div>

      {/* 评分变化用 aria-live 播报：不靠颜色也知道刚才记成了什么 */}
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>

      <div className="mt-4">
        <ReviewCard word={current.word} revealed={revealed} onReveal={reveal} />
      </div>

      <div className="mt-3">
        {revealed ? (
          <RatingBar
            previews={previews}
            onGrade={(grade) => void submit(grade)}
            disabled={busy}
          />
        ) : (
          <p className="text-center text-[12px] text-ink-mute">
            先在心里回忆一遍，再显示释义
          </p>
        )}
      </div>

      <ReviewHint className="mt-5 text-center text-[12px] text-ink-mute" />
      <div className="mt-1 text-center">
        <Button variant="link" size="sm" onClick={onGoQuiz}>
          直接去测试
        </Button>
      </div>
    </div>
  );
}

/** 无到期（§5 F2 / §7 空态）：今天已清空 + 下次到期时间 + 去测试 */
function ReviewEmpty({
  store,
  onGoQuiz,
  onExit,
}: {
  store: VocabStore;
  onGoQuiz: () => void;
  onExit: () => void;
}) {
  const { words, records, mastered } = store;
  const nextDue = useMemo(() => nextDueAt(words, records, mastered), [words, records, mastered]);

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-8">
      <div className="rounded-card border border-line bg-card p-6 shadow-card">
        <h1 className="text-[20px] font-semibold leading-[1.3] text-ink">今天已清空</h1>
        <p className="mt-1.5 text-[13px] leading-[1.65] text-ink-soft">
          {nextDue === null
            ? "还没有排期的卡片。去词表挑一些词开始学，或者先做一轮测试。"
            : `下一张到期：${formatInterval(new Date(nextDue))}。今天可以先做点别的。`}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button size="touch" className="sm:flex-1" onClick={onGoQuiz}>
            去测试
          </Button>
          <Button size="touch" variant="outline" className="sm:flex-1" onClick={onExit}>
            回词表
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── 内部工具 ─────────────────────────────────────────────────── */

/**
 * 回滚当日 reviewed / correct / wrong / newWords。
 * store.grade 已经 bumpDay 并落库，restoreCard 只管卡片；
 * 少了这一步「撤销一次答错」会永久多记一次错，当日新词额度也回不来。
 */
async function rollbackDay(store: VocabStore, step: Step): Promise<void> {
  const current = store.days.get(step.day);
  if (!current) return;
  await saveDay({
    ...current,
    reviewed: Math.max(0, current.reviewed - 1),
    correct: Math.max(0, current.correct - (step.grade >= 3 ? 1 : 0)),
    wrong: Math.max(0, current.wrong - (step.grade === 1 ? 1 : 0)),
    newWords: Math.max(0, current.newWords - (step.wasNew ? 1 : 0)),
  } satisfies DayRecord);
}

function countGrades(steps: readonly Step[]): Record<Grade, number> {
  const out: Record<Grade, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const step of steps) out[step.grade] += 1;
  return out;
}

/** 最近一次到期时间（未掌握、已评分的卡片） */
function nextDueAt(
  words: readonly Word[],
  records: ReadonlyMap<string, SrsCardRecord>,
  mastered: ReadonlyMap<string, number>,
): number | null {
  let next: number | null = null;
  const now = new Date();
  for (const word of words) {
    // 免检期内的已掌握词不算「下一张到期」；过了冷却期它自己就是下一张
    const markedAt = mastered.get(word.key);
    if (markedAt !== undefined) {
      const recheck = markedAt + MASTERY_COOLDOWN_DAYS * 86_400_000;
      if (recheck <= now.getTime()) {
        if (next === null || recheck < next) next = recheck;
        continue;
      }
      if (now.getTime() < recheck) continue;
    }
    const card = records.get(word.key);
    if (!card || card.reps <= 0) continue;
    if (next === null || card.due < next) next = card.due;
  }
  return next;
}
