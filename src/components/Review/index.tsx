import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewSession } from "./ReviewSession";
import { dayKey } from "@/lib/date";
import { buildReviewPlan, type ReviewItem } from "@/lib/session";
import type { PageProps } from "@/components/contracts";

export interface ReviewPageProps extends PageProps {
  /** 「去测试」出口，由 App 负责切路由 */
  onGoQuiz: () => void;
}

interface PlanMeta {
  /** 到期卡总数（截断前） */
  dueTotal: number;
  /** 本次装不下、留到明天的数量 */
  carryOver: number;
  /** 本次题量上限 */
  limit: number;
}

type QueueState =
  | { status: "loading" }
  | { status: "ready"; items: ReviewItem[]; meta: PlanMeta };

/**
 * 复习页（§5 F2）
 *
 * 队列只在进入（或「再来一轮」）时用 buildReviewPlan 构建一次并保持——
 * 评分会不断改 records，如果跟着 store 每帧重算，队列会在手里变形。
 * 之后的指针推进完全靠 ReviewSession 内部的已提交栈。
 */
export function ReviewPage({ store, onExit, onGoQuiz }: ReviewPageProps) {
  const [round, setRound] = useState(0);
  const [state, setState] = useState<QueueState>({ status: "loading" });

  // 构队需要最新的 store 快照，但不能把 store 放进依赖（它每次写入都会换引用）
  const storeRef = useRef(store);
  storeRef.current = store;
  // 已构过队的轮次：数据继续加载（loadingWords 翻转、新等级到货）也不重建队列
  const builtRound = useRef(-1);

  const ready = store.ready;
  const loadingWords = store.loadingWords;

  useEffect(() => {
    if (!ready || loadingWords) return;
    if (builtRound.current === round) return;
    builtRound.current = round;
    const current = storeRef.current;
    // 今日已学新词从当日计数取：额度只看库里的事实，不看本次会话
    const newLearnedToday = current.days.get(dayKey())?.newWords ?? 0;
    const plan = buildReviewPlan({
      words: current.words,
      records: current.records,
      mastered: current.mastered,
      newLearnedToday,
      prefs: current.prefs,
    });
    setState({
      status: "ready",
      items: plan.items,
      meta: { dueTotal: plan.dueTotal, carryOver: plan.carryOver, limit: plan.limit },
    });
  }, [ready, loadingWords, round]);

  const again = useCallback(() => {
    setState({ status: "loading" });
    setRound((n) => n + 1);
  }, []);

  if (state.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-[560px] px-4 py-8" aria-busy="true">
        <p className="text-[13px] text-ink-soft">正在整理今天的复习队列…</p>
      </div>
    );
  }

  return (
    <ReviewSession
      key={round}
      items={state.items}
      plan={state.meta}
      store={store}
      onAgain={again}
      onGoQuiz={onGoQuiz}
      onExit={onExit}
    />
  );
}

export { ReviewSession } from "./ReviewSession";
export { ReviewCard } from "./ReviewCard";
export { RatingBar } from "./RatingBar";
export { ReviewDone } from "./ReviewDone";
export type { ReviewSummary } from "./ReviewDone";
