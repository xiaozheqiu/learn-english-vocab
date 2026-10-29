/**
 * 跨组件的公共 props 契约（§6）。
 * 各页面组件只通过这个文件声明的形状拿到状态，避免互相耦合到 internals。
 */
import type { Stats } from "@/lib/session";
import type { LockApi } from "@/hooks/useLock";
import type { VocabStore } from "@/hooks/useVocabStore";

export interface PageProps {
  store: VocabStore;
  onExit: () => void;
}

export interface FloatingPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: VocabStore;
  stats: Stats;
  lock: LockApi;
  onLockNow: () => void;
  canInstall: boolean;
  onInstall: () => void;
  /** 关于页的词性对照表入口 */
  onOpenGuide: () => void;
  /** 空态/学习分区的「去做测试」 */
  onGoQuiz: () => void;
  /** 顽固词清单入口 */
  onOpenLeech: () => void;
  /** 今日日期键，供统计分区展示 */
  today: string;
}

export type { Stats, LockApi, VocabStore };

/** 复习页对外签名 */
export interface ReviewPageProps {
  store: VocabStore;
  onExit: () => void;
  onGoQuiz: () => void;
}

/** 测试页对外签名 */
export interface QuizPageProps {
  store: VocabStore;
  onExit: () => void;
  /** 只练错题时传入的 key 白名单 */
  onlyKeys?: string[] | null;
  /** 抽题请求序号：外层每推进一次就表示「换一套新题」 */
  requestId?: number;
  /** 「只练错题」回调，由 App 记住白名单 */
  onPracticeWrong?: (keys: string[]) => void;
  onGoReview?: () => void;
}
