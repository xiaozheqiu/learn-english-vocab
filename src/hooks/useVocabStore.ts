/**
 * 数据状态 + 写入编排（§6 hooks/useVocabStore.ts）
 *
 * 单一事实来源：词表页的 mastered / prefs 都从这里读。
 * 写入先落内存（乐观更新），再落 IndexedDB；失败只记录不阻塞 UI。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearProgress as dbClearProgress,
  exportAll as dbExportAll,
  importAll as dbImportAll,
  isMemoryMode,
  loadSnapshot,
  migrateLegacy,
  probeStorage,
  saveMastery,
  savePrefs as dbSavePrefs,
} from "@/lib/db";
import { cachedAll, isLoaded, loadAll, loadLevel } from "@/lib/words";
import {
  DEFAULT_PREFS,
  LEVELS,
  type Level,
  type LevelFilter,
  type Prefs,
  type Word,
} from "@/lib/types";

export interface VocabStore {
  ready: boolean;
  words: Word[];
  /** key → 标记「已掌握」的时间（epoch ms） */
  mastered: Map<string, number>;
  prefs: Prefs;
  memoryMode: boolean;
  loadError: string;
  loadingWords: boolean;

  ensureLevels: (target: LevelFilter) => Promise<void>;
  toggleMastery: (keys: readonly string[], mastered: boolean) => Promise<void>;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  exportData: () => Promise<unknown>;
  importData: (payload: unknown) => Promise<void>;
  wipeProgress: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useVocabStore(): VocabStore {
  const [ready, setReady] = useState(false);
  const [words, setWords] = useState<Word[]>([]);
  const [mastered, setMastered] = useState<Map<string, number>>(new Map());
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [memoryMode, setMemoryMode] = useState(isMemoryMode);
  const [loadError, setLoadError] = useState("");
  const [loadingWords, setLoadingWords] = useState(true);

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
        setMastered(snapshot.mastery);
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
   * 搜索需要跨等级：只加载 A1 的话，搜 abandon（B2）在默认 A1 下永远「没有匹配」，
   * 明明全库都在，用户却以为词表里没这个词。
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

  const toggleMastery = useCallback(async (keys: readonly string[], value: boolean) => {
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
  }, []);

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

  const exportData = useCallback(() => dbExportAll(), []);

  const importData = useCallback(async (payload: unknown) => {
    await dbImportAll(payload);
    const snapshot = await loadSnapshot();
    setMastered(snapshot.mastery);
    setPrefsState(snapshot.meta.prefs);
  }, []);

  const wipeProgress = useCallback(async () => {
    await dbClearProgress();
    setMastered(new Map());
  }, []);

  const refresh = useCallback(async () => {
    const snapshot = await loadSnapshot();
    setMastered(snapshot.mastery);
    setPrefsState(snapshot.meta.prefs);
    setMemoryMode(isMemoryMode());
  }, []);

  return useMemo(
    () => ({
      ready,
      words,
      mastered,
      prefs,
      memoryMode,
      loadError,
      loadingWords,
      ensureLevels,
      toggleMastery,
      setPrefs,
      exportData,
      importData,
      wipeProgress,
      refresh,
    }),
    [
      ready,
      words,
      mastered,
      prefs,
      memoryMode,
      loadError,
      loadingWords,
      ensureLevels,
      toggleMastery,
      setPrefs,
      exportData,
      importData,
      wipeProgress,
      refresh,
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
