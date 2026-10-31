/**
 * 数据状态 + 写入编排（§6 hooks/useVocabStore.ts）
 *
 * 单一事实来源：词表页的 mastered / prefs 都从这里读。
 * 写入先落内存（乐观更新），再落 IndexedDB；失败只记录不阻塞 UI。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isMemoryMode,
  loadSnapshot,
  migrateLegacy,
  probeStorage,
  saveMastery,
  savePrefs as dbSavePrefs,
} from "@/lib/db";
import { cachedAll, enrichAll, indexesReady, isLoaded, loadAll, loadLevel } from "@/lib/words";
import { LIST_VIEW_KEY } from "@/lib/listView";
import {
  DEFAULT_PREFS,
  LEGACY_MASTERED_KEY,
  LEVELS,
  type Level,
  type LevelFilter,
  type Prefs,
  type Word,
} from "@/lib/types";

/**
 * 持久化的视图是否正开着「需要索引」的筛选（档位 / 牛津标记）。
 *
 * 首屏默认走不解索引的快路径，那时 rank / tier / oxford 全是默认值。档位与牛津
 * 两档恰好只读这两个索引 —— 若用户上次停在 `tier=extended` 或 `oxford=none`，
 * 快路径会先画出一份错的结果（extended 一条都没有、none 变成全库）。
 * 所以开屏前先问一句：上次的视图要索引吗？要，就老老实实等索引，慢一点但结果对。
 *
 * 读不出来（无 localStorage / 坏 JSON）按「要索引」处理：宁可慢，不可错。
 */
function firstPaintNeedsIndexes(): boolean {
  try {
    const raw = window.localStorage.getItem(LIST_VIEW_KEY);
    if (!raw) return false;
    const view = JSON.parse(raw) as { tier?: unknown; oxford?: unknown };
    return (view.tier ?? "all") !== "all" || (view.oxford ?? "all") !== "all";
  } catch {
    return true;
  }
}

/** 空闲时执行；没有 requestIdleCallback（Safari 早期）就退回短延时 */
function onIdle(callback: () => void): void {
  if ("requestIdleCallback" in window) {
    (window as unknown as { requestIdleCallback(cb: () => void): void }).requestIdleCallback(
      callback,
    );
    return;
  }
  setTimeout(callback, 300);
}

export interface VocabStore {
  ready: boolean;
  words: Word[];
  /** key → 标记「已掌握」的时间（epoch ms） */
  mastered: Map<string, number>;
  prefs: Prefs;
  memoryMode: boolean;
  loadError: string;
  loadingWords: boolean;
  /** rank / tier / 牛津标记补齐了没；档位与牛津筛选只在这之后才可信 */
  indexesReady: boolean;

  ensureLevels: (target: LevelFilter) => Promise<void>;
  ensureIndexes: () => Promise<void>;
  toggleMastery: (keys: readonly string[], mastered: boolean) => Promise<void>;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
}

export function useVocabStore(): VocabStore {
  const [ready, setReady] = useState(false);
  const [words, setWords] = useState<Word[]>([]);
  const [mastered, setMastered] = useState<Map<string, number>>(new Map());
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [memoryMode, setMemoryMode] = useState(isMemoryMode);
  const [loadError, setLoadError] = useState("");
  const [loadingWords, setLoadingWords] = useState(true);
  const [indexesReadyState, setIndexesReadyState] = useState(indexesReady);

  /* ── 初始化 ──────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        /**
         * 探测与读快照并行，迁移复用这份快照。
         *
         * 三件事都要碰 IndexedDB，但相互不依赖：
         * - probeStorage() 用独立的探针库验证「存储真的能写能读」
         *   （Safari 无痕模式下 API 在、open() 抛，只有这一层能揭穿）
         * - loadSnapshot() 读已掌握的 key 与偏好
         * - migrateLegacy(snapshot) 只在第一台设备上导入旧 localStorage，
         *   平时读到 migratedFromLocal 就立即返回
         *
         * 以前是严格串行：探测（建库+写+读+删库）→ 迁移（内部读一遍全表）→
         * 快照（再读一遍全表）。第二遍全表纯属浪费，串行又把耗时变成三者之和。
         * 现在只读一次快照，探测与它并行，迁移直接吃现成的。
         */
        const storageProbe = probeStorage();
        const snapshot = await loadSnapshot();
        if (!alive) return;

        setMastered(snapshot.mastery);
        setPrefsState(snapshot.meta.prefs);
        setReady(true);

        /**
         * 迁移在快照之后跑，所以它导入的那些 key 不在 snapshot 里 —— 必须自己补进
         * 内存，否则「第一次打开新版」那一屏会看不到刚从旧版 localStorage 继承来的
         * 已掌握标记（刷新一次才出现，用户会以为进度丢了）。
         */
        const importLegacy = async () => {
          const imported = await migrateLegacy(snapshot).catch(() => 0);
          if (!alive || imported <= 0) return;
          const raw = window.localStorage.getItem(LEGACY_MASTERED_KEY);
          if (!raw) return;
          const keys: unknown = JSON.parse(raw);
          if (!Array.isArray(keys)) return;
          setMastered((current) => {
            const next = new Map(current);
            const now = Date.now();
            for (const key of keys) if (typeof key === "string") next.set(key, now);
            return next;
          });
        };

        // 收尾两件：内存态告警要亮；迁移失败只是这次没导入旧进度，不挡首屏。
        if (!(await storageProbe)) setMemoryMode(true);
        await importLegacy();
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
   * 首屏：先只加载默认等级，其余等级与索引交给空闲时段。
   *
   * 以前这里是 `await loadAll()` —— 5 个等级分包（321KB）+ tiers.json + oxford.json
   * （228KB）全部要下载、解析、建完 5323 条主键之后才肯渲染第一行。缓存能省下载，
   * 省不了 JSON.parse 和建索引，所以低端机上这段是纯等待。
   *
   * 现在的顺序：
   *   1. 默认等级（通常是 A1，900 条）单独快进 → `loadingWords` 立刻落下，列表可交互
   *   2. 空闲时补齐其余 4 个等级 + 两份索引，补完再换一次数组引用
   *
   * 搜索不受影响：`ensureLevels("ALL")` 在用户敲下第一个字时才走全量加载，
   * 只是那时候分包已经在缓存里（甚至已解析），不会再等网络。
   *
   * 例外：持久化的视图正开着档位 / 牛津筛选时，快路径会画错（它没有索引），
   * 这时走全量，见 firstPaintNeedsIndexes()。
   */
  useEffect(() => {
    /**
     * 等偏好读出来再决定首屏加载哪个等级。
     *
     * 不依赖也不行：这个 effect 与上面读 IDB 的 effect 同批挂载，此时 prefs 还是
     * `DEFAULT_PREFS`，用户设成 B2 的默认等级会被无视，首屏先白解析一遍 A1。
     * 读 IDB 只要几毫秒（实测 5~25ms），等得起，也别为了抠这点时间把默认等级搞错。
     */
    if (!ready) return;
    let alive = true;
    (async () => {
      try {
        const firstLevel = prefs.defaultLevel === "ALL" ? "A1" : (prefs.defaultLevel as Level);
        const first = await loadLevel(firstLevel, firstPaintNeedsIndexes());
        if (!alive) return;
        setWords((current) => (sameWords(current, first) ? current : first));
        setLoadingWords(false);

        onIdle(() => {
          if (!alive) return;
          void loadAll()
            .then((all) => {
              if (alive) setWords((current) => (sameWords(current, all) ? current : all));
            })
            .catch(() => undefined);
        });
      } catch (error) {
        if (alive) setLoadError(`词表加载失败：${String(error)}`);
        if (alive) setLoadingWords(false);
      }
    })();
    return () => {
      alive = false;
    };
    // 只认第一次 ready：之后 prefs 再变由 setPrefs 那条路径处理，不需要重跑首屏加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

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
        setIndexesReadyState(true);
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
      setIndexesReadyState(indexesReady());
    } finally {
      setLoadingWords(false);
    }
  }, []);

  /**
   * 补齐索引（幂等）。
   *
   * 档位 / 牛津筛选、以及按 rank 排序都读 rank/tier/oxford，而首屏快路径
   * 故意没载那两个索引文件。所以任何要动这两维的入口都先 await 这里，
   * 而不是指望「空闲补全大概已经跑完了」。
   */
  const ensureIndexes = useCallback(async () => {
    if (indexesReady()) {
      setIndexesReadyState(true);
      return;
    }
    const all = await enrichAll();
    setWords((current) => (sameWords(current, all) ? current : all));
    setIndexesReadyState(true);
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

  return useMemo(
    () => ({
      ready,
      words,
      mastered,
      prefs,
      memoryMode,
      loadError,
      loadingWords,
      indexesReady: indexesReadyState,
      ensureLevels,
      ensureIndexes,
      toggleMastery,
      setPrefs,
    }),
    [
      ready,
      words,
      mastered,
      prefs,
      memoryMode,
      loadError,
      loadingWords,
      indexesReadyState,
      ensureLevels,
      ensureIndexes,
      toggleMastery,
      setPrefs,
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
