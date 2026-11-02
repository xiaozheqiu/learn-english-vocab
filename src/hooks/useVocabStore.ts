/**
 * 数据状态 + 写入编排（§6 hooks/useVocabStore.ts）
 *
 * 单一事实来源：词表页的 mastered / prefs 都从这里读。
 * 写入先落内存（乐观更新），再落 IndexedDB；失败只记录不阻塞 UI。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  cloudEnabled,
  loadCloudClient,
  mergeMastery,
  sameMastery,
  type CloudState,
} from "@/lib/cloud";
import { clearPending, enqueuePending, readPending } from "@/lib/pendingPush";
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
  /** 云端同步状态；未配置环境变量时恒为 disabled */
  cloud: CloudState;

  ensureLevels: (target: LevelFilter) => Promise<void>;
  ensureIndexes: () => Promise<void>;
  toggleMastery: (keys: readonly string[], mastered: boolean) => Promise<void>;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  /** 手动再对齐一次（关于页的按钮）；登录态变化后也用它 */
  syncCloud: () => Promise<void>;
  /** 云端同步失败的原因，成功或未启用时为空串 */
  cloudError: string;
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
  const [cloud, setCloud] = useState<CloudState>(cloudEnabled ? "signedOut" : "disabled");
  const [cloudError, setCloudError] = useState("");

  /**
   * 云端对齐：拉全量 → 与本地合并 → 把本地更新的一侧回写。
   *
   * 用 ref 存主体函数而不是 useCallback：初始化 effect 里要用它，而那个 effect
   * 的依赖列表是空的（只跑一次）。把函数塞 ref 里，effect 就能拿到最新闭包，
   * 又不必把任何状态塞进依赖导致重跑。
   *
   * `aliveRef` 让组件卸载后回来的响应不再 setState。
   */
  const aliveRef = useRef(true);
  const syncRef = useRef<() => Promise<void>>(async () => undefined);

  syncRef.current = async () => {
    if (!cloudEnabled) return;
    setCloud((state) => (state === "disabled" ? state : "syncing"));
    setCloudError("");

    /**
     * 整个流程包 try/catch，且必须在 finally 之外收口。
     *
     * 没有这层的话，任何一步抛错（模块加载失败、DNS 挂了、IDB 正在被别的标签页
     * 占用……）都会让状态永久停在「正在同步…」—— 界面永远转圈，用户既看不到
     * 成功也看不到失败。弱网和离线是该功能的常态，不是例外。
     */
    try {
      // 到这里才把 supabase-js 拉下来。没登录的人第一次同步会多一次模块加载，
      // 之后走缓存；比起让每个首屏都背这个包，这点延迟是划算的。
      const cloud = await loadCloudClient();
      if (!aliveRef.current) return;

      const remote = await cloud.pull();
      if (!aliveRef.current) return;
      if (remote === null) {
        /**
         * pull 返回 null 只有两种含义：没登录，或者已登录但读失败。
         *
         * **绝不能把 null 当成「云端为空」。** RLS 对匿名请求的回应是空结果集
         * 而不是报错，早期版本据此判成「云端没有数据 → 合并无变化 → 已对齐」，
         * 于是一个从没登录过的设备会显示「已与云端对齐」，登录入口不出现，
         * 本机进度也就永远传不上去。区分这两者的责任在 cloudClient.pull()，
         * 它先查会话再查表；这里只负责把结果翻译成界面状态。
         */
        const signedIn = await cloud.isSignedIn().catch(() => false);
        if (!aliveRef.current) return;
        if (!signedIn) {
          setCloud("signedOut");
          return;
        }
        setCloud("error");
        setCloudError("云端读取失败，稍后重试");
        return;
      }

      // 合并要看最新的本地快照；闭包里的 mastered 可能是旧的
      const local = await loadSnapshot();
      const { merged, upload } = mergeMastery(local.mastery, remote);

      /**
       * 把待推队列里的 key 一并纳入这一轮回写。
       *
       * 队列记的是「上次没推成功」的 key。它们可能已经在云端有行（比如上一轮
       * 其实写成功了、只是页面在响应回来之前被关掉），mergeMastery 因此不会
       * 把它们放进 upload —— 但它们的云端状态仍可能是旧的，而且更重要的是：
       * 不推就永远销不了账，每次打开都会重推一遍。
       *
       * 并集去重后按「云端与实际状态的差异」分流：云端没有、或值不同的照常走
       * upload；云端已经一致的直接销账，不发请求。
       */
      const queued = readPending();
      const needPush = new Set(upload);
      const resolved: string[] = [];
      for (const key of queued) {
        const row = remote.get(key);
        const localHas = merged.has(key);
        if (!row || row.mastered !== localHas) needPush.add(key);
        else resolved.push(key);
      }
      if (resolved.length) clearPending(resolved);

      if (!sameMastery(merged, local.mastery)) {
        // 云端更新的部分落地：内存与 IndexedDB 一起改，否则刷新就丢
        const added = [...merged].filter(([key]) => !local.mastery.has(key));
        const removed = [...local.mastery.keys()].filter((key) => !merged.has(key));
        if (added.length) await saveMastery(added.map(([key]) => key), true);
        if (removed.length) await saveMastery(removed, false);
        if (!aliveRef.current) return;
        setMastered(merged);
      }

      // 按「实际状态」拆成两批发：已掌握的一批、取消掌握（墓碑）的一批
      const pushTrue = [...needPush].filter((key) => merged.has(key));
      const pushFalse = [...needPush].filter((key) => !merged.has(key));

      if (pushTrue.length || pushFalse.length) {
        const stampsTrue = pushTrue.length
          ? ((await cloud.push(pushTrue, true)) ?? new Map<string, number>())
          : new Map<string, number>();
        const stampsFalse = pushFalse.length
          ? ((await cloud.push(pushFalse, false)) ?? new Map<string, number>())
          : new Map<string, number>();
        const stamps = new Map<string, number>([...stampsTrue, ...stampsFalse]);
        if (stamps.size) {
          /**
           * 推成功的 key 一律销账。队列是「跟云端不一致」的记号，一致了就该消失 ——
           * 不销账的话，下次打开会为同一批 key 再推一遍。
           */
          clearPending([...stamps.keys()]);
          if (aliveRef.current) {
            setMastered((current) => {
              const next = new Map(current);
              for (const [key, at] of stamps) if (next.has(key)) next.set(key, at);
              return next;
            });
          }
        }
      }

      if (aliveRef.current) setCloud("synced");
    } catch {
      // 云端出问题的任何形态都收敛到 error，绝不留在 syncing
      if (!aliveRef.current) return;
      setCloud("error");
      setCloudError("同步失败，本地进度未受影响");
    }
  };

  const runCloudSync = useCallback(async () => {
    await syncRef.current();
  }, []);

  /**
   * 把队列里积压的 key 补推上去。
   *
   * 每条 key 的「已掌握」状态现读 IndexedDB —— 队列只记「这个 key 需要推」，
   * 不记值，所以同一个词被反复开合也只有一次推送，不会出现顺序错乱。
   *
   * `keepalive: true` 让浏览器在页面卸载过程中也把请求发完（fetch 的标准选项，
   * supabase-js 不暴露它，所以这里为了保命走原生 fetch —— 见 flushPendingNow）。
   */
  const flushPending = useCallback(async () => {
    if (!cloudEnabled) return;
    const pending = readPending();
    if (pending.size === 0) return;
    try {
      const mod = await loadCloudClient();
      const local = await loadSnapshot();
      const toTrue = [...pending].filter((key) => local.mastery.has(key));
      const toFalse = [...pending].filter((key) => !local.mastery.has(key));
      let ok = true;
      if (toTrue.length) ok = (await mod.push(toTrue, true)) !== null && ok;
      if (toFalse.length) ok = (await mod.push(toFalse, false)) !== null && ok;
      if (ok) {
        clearPending(pending);
        if (aliveRef.current) setCloud("synced");
      }
    } catch {
      // 补推失败不入 error：正常的那次推送可能已经成功，别用一个兜底路径惊动用户
    }
  }, []);

  /**
   * 页面进入后台 / 被关掉时，用原生 fetch + keepalive 把积压补出去。
   *
   * 为什么不用 supabase-js：它的 fetch 包装没有暴露 `keepalive`，而普通请求
   * 在 `visibilitychange → hidden` 之后随时可能被掐断 —— 那正是我们要救的场景。
   * 这里直接拼 REST 请求，只带已经在内存里的 session token。
   */
  const flushPendingNow = useCallback(() => {
    if (!cloudEnabled) return;
    const pending = readPending();
    if (pending.size === 0) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!base || !key) return;

    void (async () => {
      try {
        const mod = await loadCloudClient();
        const uid = await mod.currentUserId();
        if (!uid) return;
        const token = await mod.currentAccessToken();
        if (!token) return;
        const local = await loadSnapshot();
        const rows = [...pending].map((word_key) => ({
          user_id: uid,
          word_key,
          mastered: local.mastery.has(word_key),
        }));
        const res = await fetch(`${base}/rest/v1/mastery`, {
          method: "POST",
          keepalive: true,
          headers: {
            apikey: key,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(rows),
        });
        if (res.ok) clearPending(pending);
      } catch {
        // 页面正在关闭，失败也没人能处理；队列留着下次补
      }
    })();
  }, []);

  /**
   * 三个触发点：启动时补一次积压、页面隐藏时抢救、回到前台时对齐。
   *
   * 回到前台也叫一次同步，是因为另一台设备可能刚改过 —— 用户切回来那一刻
   * 本来就该看到最新的。
   */
  useEffect(() => {
    if (!cloudEnabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushPendingNow();
      else void flushPending();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [flushPending, flushPendingNow]);

  // 卸载后回来的网络响应不再 setState
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

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

        // 云端对齐放在最后、且不 await：首屏已经该渲染的都渲染了。
        // 走 ref 而不是 runCloudSync：这个 effect 只该跑一次，把回调塞进依赖
        // 列表会让「初始化」变成可重跑的，那不是这里要的语义。
        //
        // 同步本身会把「本地有、云端没有」的 key 推上去，队列里的积压因此
        // 顺带被消化 —— 不需要额外再调一次 flushPending。
        if (alive) void syncRef.current();
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

    /**
     * 云端推送排在本地写入之后，且不 await。
     *
     * 顺序不能反：saveMastery 是数据安全的底线，云端只是备份。
     * 用 void 而不是 await，是因为手机弱网下一次 upsert 可能几百毫秒，
     * 而用户点下一个词不该等它 —— 本地已经落了，刷新也不丢。
     *
     * 未登录 / 未配置时 push 自己会立刻返回，这里不需要额外判断。
     */
    if (cloudEnabled) {
      // 先记账再发请求：那次请求完全可能在页面被关掉时被浏览器掐断，
      // 记在 localStorage 里的这一笔就是下次启动补推的依据。
      enqueuePending(keys);
      void loadCloudClient()
        .then((mod) => mod.push(keys, value))
        .then((stamps) => {
          if (!stamps) return;
          // 推送成功才销账
          clearPending(keys);
          if (!aliveRef.current) return;
          setCloud("synced");
          // 用服务端时间替换本地时间戳，避免下次合并时两边反复打架
          setMastered((current) => {
            const next = new Map(current);
            for (const [key, at] of stamps) if (next.has(key)) next.set(key, at);
            return next;
          });
        })
        .catch(() => {
          // 云端失败只影响多设备同步，本地进度已经安全落盘，不打扰用户。
          // 队列不动：下次打开（或页面隐藏时的补推）会重试。
          if (aliveRef.current) setCloud("error");
        });
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
      cloud,
      cloudError,
      syncCloud: runCloudSync,
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
      cloud,
      cloudError,
      runCloudSync,
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
