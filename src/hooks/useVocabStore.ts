/**
 * 数据状态 + 写入编排（§6 hooks/useVocabStore.ts）
 *
 * 单一事实来源：所有页面的 mastery / srs / days / prefs 都从这里读。
 * 写入先落内存（乐观更新），再落 IndexedDB；失败只记录不阻塞 UI。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendReview,
  clearProgress as dbClearProgress,
  deleteCard,
  exportAll as dbExportAll,
  importAll as dbImportAll,
  isMemoryMode,
  loadSnapshot,
  migrateLegacy,
  probeStorage,
  saveCard,
  saveDay,
  saveMastery,
  savePrefs as dbSavePrefs,
} from "@/lib/db";
import { dayKey } from "@/lib/date";
import { applyGrade, newCardRecord, type Grade } from "@/lib/srs";
import { cachedAll, isLoaded, loadAll, loadLevel } from "@/lib/words";
import {
  DEFAULT_PREFS,
  LEVELS,
  type DayRecord,
  type Level,
  type LevelFilter,
  type MasteryFilter,
  type Prefs,
  type ReviewLogRecord,
  type SrsCardRecord,
  type Word,
} from "@/lib/types";

export interface VocabStore {
  ready: boolean;
  words: Word[];
  records: Map<string, SrsCardRecord>;
  /** key → 标记「已掌握」的时间（epoch ms）；过冷却期会自动回到复习队列 */
  mastered: Map<string, number>;
  days: Map<string, DayRecord>;
  prefs: Prefs;
  memoryMode: boolean;
  loadError: string;
  loadingWords: boolean;

  ensureLevels: (target: LevelFilter) => Promise<void>;
  toggleMastery: (keys: readonly string[], mastered: boolean) => Promise<void>;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  grade: (
    key: string,
    value: Grade,
    source: ReviewLogRecord["source"],
  ) => Promise<{ days: number; record: SrsCardRecord }>;
  /** 撤销：把卡片恢复到给定快照（null = 删除该条） */
  restoreCard: (key: string, record: SrsCardRecord | null) => Promise<void>;
  exportData: () => Promise<unknown>;
  importData: (payload: unknown) => Promise<void>;
  wipeProgress: () => Promise<void>;
  refresh: () => Promise<void>;
}

const HISTORY_LIMIT = 200;

function bumpDay(
  days: Map<string, DayRecord>,
  today: string,
  patch: Partial<Pick<DayRecord, "reviewed" | "correct" | "wrong" | "newWords">>,
): Map<string, DayRecord> {
  const current = days.get(today) ?? {
    day: today,
    reviewed: 0,
    correct: 0,
    wrong: 0,
    newWords: 0,
  };
  const next: DayRecord = {
    ...current,
    reviewed: current.reviewed + (patch.reviewed ?? 0),
    correct: current.correct + (patch.correct ?? 0),
    wrong: current.wrong + (patch.wrong ?? 0),
    newWords: current.newWords + (patch.newWords ?? 0),
  };
  const copy = new Map(days);
  copy.set(today, next);
  return copy;
}

export function useVocabStore(): VocabStore {
  const [ready, setReady] = useState(false);
  const [words, setWords] = useState<Word[]>([]);
  const [records, setRecords] = useState<Map<string, SrsCardRecord>>(new Map());
  const [mastered, setMastered] = useState<Map<string, number>>(new Map());
  const [days, setDays] = useState<Map<string, DayRecord>>(new Map());
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [memoryMode, setMemoryMode] = useState(isMemoryMode);
  const [loadError, setLoadError] = useState("");
  const [loadingWords, setLoadingWords] = useState(true);

  // 写入历史，供撤销记录回滚（只存最近若干条）
  const history = useRef<
    { key: string; record: SrsCardRecord | null; dayBefore: DayRecord | undefined }[]
  >([]);

  /* ── 初始化 ──────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        /**
         * 先做真实探测，再读快照。
         *
         * 《isMemoryMode() 只证明「没有 IDB」，证明不了「有但打不开」》
         * —— Safari 无痕模式下 API 在、open() 抛，此时所有写入会静默落内存，
         * 用户关掉页面进度全没还看不到任何提示。这里用 probeStorage()
         * 把那种情况也判成内存态，让界面上的告警真的亮起来。
         */
        const storageOk = await probeStorage();
        if (alive && !storageOk) setMemoryMode(true);

        await migrateLegacy();
        const snapshot = await loadSnapshot();
        if (!alive) return;
        setRecords(snapshot.srs);
        setMastered(snapshot.mastery);
        setDays(snapshot.days);
        setPrefsState(snapshot.meta.prefs);
      } catch (error) {
        if (alive) setLoadError(String(error));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 首屏加载**全部**等级。
   *
   * 之前只加载 A1，靠词表页切等级时再补；但复习页和测试页都直接读 words，
   * 结果「只学了 A1」时复习与测试永远只覆盖那 900 个词，剩下 4423 个词
   * 一次都不会被抽到 —— 和「5000 词全掌握」的目标直接冲突。
   * 5 个分包合计 270KB，走 PWA 预缓存后是本地读，不是网络请求，直接全量最省心。
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await loadAll();
        if (!alive) return;
        setWords((current) => (sameWords(current, all) ? current : all));
      } catch (error) {
        if (alive) setLoadError(`词表加载失败：${String(error)}`);
      } finally {
        if (alive) setLoadingWords(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ensureLevels = useCallback(async (target: LevelFilter) => {
    // 幂等：已经加载过就不动 state，否则 setWords 换引用会让调用方 effect 自激
    if (target === "ALL") {
      if (isLoaded(LEVELS)) {
        setWords((current) => {
          const all = cachedAll();
          return sameWords(current, all) ? current : all;
        });
        return;
      }
      setLoadingWords(true);
      try {
        const all = await loadAll();
        setWords((current) => (sameWords(current, all) ? current : all));
      } finally {
        setLoadingWords(false);
      }
      return;
    }
    if (isLoaded([target])) {
      setWords((current) => {
        const all = cachedAll();
        return sameWords(current, all) ? current : all;
      });
      return;
    }
    setLoadingWords(true);
    try {
      const level = await loadLevel(target as Level);
      setWords((current) => mergeWords(current, level));
    } finally {
      setLoadingWords(false);
    }
  }, []);

  /* ── 写入 ────────────────────────────────────────────────── */

  const toggleMastery = useCallback(
    async (keys: readonly string[], value: boolean) => {
      if (keys.length === 0) return;
      setMastered((current) => {
        const next = new Map(current);
        const now = Date.now();
        for (const key of keys) {
          if (value) next.set(key, now);
          else next.delete(key);
        }
        return next;
      });
      try {
        await saveMastery(keys, value);
      } catch (error) {
        setLoadError(String(error));
      }
    },
    [],
  );

  const setPrefs = useCallback(async (patch: Partial<Prefs>) => {
    let next: Prefs = DEFAULT_PREFS;
    setPrefsState((current) => {
      next = { ...current, ...patch };
      return next;
    });
    try {
      await dbSavePrefs(next);
    } catch (error) {
      setLoadError(String(error));
    }
  }, []);

  const grade = useCallback(
    async (key: string, value: Grade, source: ReviewLogRecord["source"]) => {
      const now = new Date();
      const today = dayKey(now);
      const before = records.get(key) ?? null;
      const dayBefore = days.get(today);
      const base = before ?? newCardRecord(key, now);
      const result = applyGrade(base, value, now, prefs.retention);
      const wasNew = !before || before.reps <= 0;
      const nextDays = bumpDay(days, today, {
        reviewed: 1,
        correct: value >= 3 ? 1 : 0,
        wrong: value === 1 ? 1 : 0,
        newWords: wasNew ? 1 : 0,
      });

      const next: SrsCardRecord = {
        ...result.record,
        right: base.right + (value >= 3 ? 1 : 0),
        wrong: base.wrong + (value === 1 ? 1 : 0),
      };

      setRecords((current) => {
        const copy = new Map(current);
        copy.set(key, next);
        return copy;
      });
      setDays(nextDays);

      history.current.push({ key, record: before, dayBefore });
      if (history.current.length > HISTORY_LIMIT) history.current.shift();

      const log: ReviewLogRecord = {
        key,
        at: now.getTime(),
        rating: value,
        source,
        stateBefore: base.state,
        dueBefore: base.due,
        stabilityBefore: base.stability,
        difficultyBefore: base.difficulty,
        scheduledDays: next.scheduled_days,
        correct: value >= 3,
      };

      try {
        await saveCard(next);
        await appendReview(log);
        const updatedDay = nextDays.get(today);
        if (updatedDay) await saveDay(updatedDay);
      } catch (error) {
        setLoadError(String(error));
      }

      return { days: result.days, record: next };
    },
    [days, prefs.retention, records],
  );

  const restoreCard = useCallback(
    async (key: string, record: SrsCardRecord | null) => {
      setRecords((current) => {
        const copy = new Map(current);
        if (record) copy.set(key, record);
        else copy.delete(key);
        return copy;
      });
      try {
        if (record) await saveCard(record);
        else await deleteCard(key);
      } catch (error) {
        setLoadError(String(error));
      }
    },
    [],
  );

  const exportData = useCallback(() => dbExportAll(), []);

  const importData = useCallback(
    async (payload: unknown) => {
      await dbImportAll(payload);
      const snapshot = await loadSnapshot();
      setRecords(snapshot.srs);
      setMastered(snapshot.mastery);
      setDays(snapshot.days);
      setPrefsState(snapshot.meta.prefs);
    },
    [],
  );

  const wipeProgress = useCallback(async () => {
    await dbClearProgress();
    setRecords(new Map());
    setMastered(new Map());
    setDays(new Map());
    history.current = [];
  }, []);

  const refresh = useCallback(async () => {
    const snapshot = await loadSnapshot();
    setRecords(snapshot.srs);
    setMastered(snapshot.mastery);
    setDays(snapshot.days);
    setPrefsState(snapshot.meta.prefs);
    setMemoryMode(isMemoryMode());
  }, []);

  return useMemo(
    () => ({
      ready,
      words,
      records,
      mastered,
      days,
      prefs,
      memoryMode,
      loadError,
      loadingWords,
      ensureLevels,
      toggleMastery,
      setPrefs,
      grade,
      restoreCard,
      exportData,
      importData,
      wipeProgress,
      refresh,
    }),
    [
      ready, words, records, mastered, days, prefs, memoryMode, loadError,
      loadingWords, ensureLevels, toggleMastery, setPrefs, grade, restoreCard,
      exportData, importData, wipeProgress, refresh,
    ],
  );
}

/** 内容相同则返回原数组，保证 setState 不产生新引用（否则依赖 words 的 effect 会自激） */
function sameWords(a: readonly Word[], b: readonly Word[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.key !== b[i]?.key) return false;
  }
  return true;
}

function mergeWords(current: Word[], incoming: readonly Word[]): Word[] {
  if (current.length === 0) return incoming as Word[];
  const seen = new Set(current.map((w) => w.key));
  const extra = incoming.filter((w) => !seen.has(w.key));
  return extra.length ? [...current, ...extra] : current;
}

export type { MasteryFilter };
