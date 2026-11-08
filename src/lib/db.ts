/**
 * IndexedDB 仓储 + 迁移 + 导出/导入（§5 F4 / §6 lib/db.ts）
 *
 * 库 ox5000 v2：
 *   mastery(key) / meta(k)
 *
 * v2 起只有「哪些词已掌握」和偏好两类数据 —— 间隔复习、作答流水、每日计数
 * 随复习/测试功能一起移除；锁屏相关的 meta 键也不再写入。
 * 隐私模式打不开 IDB 时整体降级为内存态，由上层展示「本次进度不会保存」。
 */
import { openDB, type DBSchema, type IDBPDatabase, type OpenDBCallbacks } from "idb";
import { migrateKey, remapWithBuckets } from "./masteryKey";
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_PREFS,
  LEGACY_MASTERED_KEY,
  PAGE_SIZES,
  isLevelFilter,
  type DrillRecord,
  type MetaState,
  type PageSize,
  type Prefs,
} from "./types";

interface OxfordDB extends DBSchema {
  mastery: { key: string; value: { key: string; at: number } };
  meta: { key: string; value: unknown };
  /** 自测流水：追加写，不更新 */
  drills: {
    key: number;
    value: DrillRecord;
    indexes: { at: number };
  };
}

export interface Snapshot {
  /** key → 标记时间（epoch ms） */
  mastery: Map<string, number>;
  meta: MetaState;
  /**
   * 自测流水（只用于内存态降级）。
   *
   * 正常路径下流水在 `drills` store 里，不随快照读出来 —— 首屏没有它的读取方，
   * 每次启动都读一遍纯属白费。这里留着只是让「隐私模式」那条降级路径
   * 也能把本轮结果展示出来，不至于点了自测什么都没有。
   */
  drills: DrillRecord[];
}

export const META_KEYS = {
  migratedFromLocal: "migratedFromLocal",
  prefs: "prefs",
  /**
   * 主键从 `等级|单词|词性` 改成分片式 `板块|单词` 的那次换算做过了没。
   *
   * 与 migratedFromLocal 分开记：那个是「旧版 localStorage → IndexedDB」，
   * 这个是「旧主键 → 新主键」，两件事发生在不同版本、也可能只发生一件
   * （新用户只经历后者、或者从没碰过旧版 localStorage 的用户只经历前者）。
   */
  migratedKeys: "migratedKeys",
} as const;

/** v1 遗留的 meta 键：打开库时顺手清掉，不留在用户的存储里 */
const LEGACY_META_KEYS = ["lockEnabled", "pinHash", "lockGraceUntil", "setupDone"] as const;

export const DEFAULT_META: MetaState = {
  migratedFromLocal: false,
  migratedKeys: false,
  prefs: DEFAULT_PREFS,
};

let connection: Promise<IDBPDatabase<OxfordDB> | null> | null = null;
/** 降级内存态 */
let memory: Snapshot | null = null;

function supportsIdb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * 同步判断「肯定是内存态」。
 *
 * 只能证明没有 IDB，证明不了「有但打不开」—— Safari 无痕模式里
 * `indexedDB` 这个对象是存在的，open() 才抛 SecurityError。
 * 那种情况必须靠下面的 probeStorage() 异步发现。
 */
export function isMemoryMode(): boolean {
  return !supportsIdb();
}

/**
 * 真正验证存储可用：能打开、能写、能读回。
 *
 * 只在启动时跑一次（见 useVocabStore），用来揭穿 isMemoryMode() 看不见的
 * 「API 在但打不开」。单独用探针库，不碰 ox5000，删得掉就删。
 */
export async function probeStorage(): Promise<boolean> {
  if (!supportsIdb()) return false;
  const PROBE = "ox5000-probe";
  try {
    const handle = await openDB(PROBE, 1, {
      upgrade(database) {
        database.createObjectStore("probe");
      },
    });
    try {
      await handle.put("probe", Date.now(), "probe");
      const readBack = await handle.get("probe", "probe");
      return typeof readBack === "number";
    } finally {
      handle.close();
      // 探针库没有价值，能删就删；删不掉也不影响
      indexedDB.deleteDatabase(PROBE);
    }
  } catch {
    return false;
  }
}

function emptySnapshot(): Snapshot {
  return {
    mastery: new Map(),
    meta: { ...DEFAULT_META, prefs: { ...DEFAULT_PREFS } },
    drills: [],
  };
}

/**
 * 打开数据库，且**绝不允许无限期挂着**。
 *
 * ## 为什么必须写这一层
 *
 * `openDB` 在版本升级时，只要还有一个老版本连接没关（另一个标签页开着旧版、
 * 或某个页面留着 v2 的句柄），它就会派发 `blocked` 事件并且**永不 resolve**
 * 也永不 reject。没有处理时，`await db()` 永远不返回，于是
 * `await loadSnapshot()` 不返回，`setReady(true)` 永远轮不到 ——
 * 界面就停在「正在读取本机进度…」，一个连报错都没有的死界面。实测可复现：
 * 另开一个标签页持有 v2 连接，再打开新版，页面 12 秒后仍停在那一行。
 *
 * ## 处理方式
 *
 * 1. `blocked` 一触发就记下来，并**主动关闭自己的连接**（关掉旧连接是解除阻塞的
 *    唯一办法之一，另一条是让老标签页自己关），然后等一小会儿重试一次 ——
 *    多数情况是旧标签页已经走了，只是 `blocked` 派发得比它关闭早。
 * 2. 无论如何都在 `OPEN_TIMEOUT` 后放弃，降到内存态。宁可这一次不写入磁盘
 *    （顶栏会提示「本次进度不会保存」），也不要让用户面对一个永远转圈的界面。
 *
 * 失败结果**不进 `connection` 缓存**：缓存住 null 会让之后每一次重试都直接失败，
 * 而用户完全可能关掉旧标签页再刷新。
 */
const OPEN_TIMEOUT = 3000;

/**
 * 打开数据库，且**绝不允许无限期挂着**。
 *
 * ## 为什么必须写这一层
 *
 * `openDB` 在版本升级时，只要还有一个老版本连接没关（另一个标签页开着旧版、
 * 或某个页面留着 v2 的句柄），它就会派发 `blocked` 事件并且**永不 resolve、
 * 也永不 reject**。没有处理时 `await db()` 永远不返回，于是
 * `await loadSnapshot()` 不返回、`setReady(true)` 永远轮不到 ——
 * 界面停在「正在读取本机进度…」，一个连报错都没有的死界面。
 *
 * 已实测复现：另开一个标签页持有 v2 连接，再打开 v3 版页面，12 秒后仍停在那行。
 *
 * ## 三层处理
 *
 * 1. **自己让路**（`blocking`）：我们这个连接正挡着别的标签页升级时立刻关闭，
 *    否则那边会卡 —— 只要是新版页面就都会走这条路，所以两边都不会卡。
 * 2. **超时降级**：无论卡在什么原因上，`OPEN_TIMEOUT` 之后一律放弃并降到内存态。
 *    宁可不写盘（顶栏会提示「本次进度不会保存」），也不要一个永远转圈的界面。
 * 3. **失败不缓存**：打开失败的结果不进 `connection`，否则之后每次重试都直接失败 ——
 *    而用户完全可能关掉旧标签页再刷新。
 */
function openWithTimeout(
  version: number,
  timeout = OPEN_TIMEOUT,
): Promise<IDBPDatabase<OxfordDB> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: IDBPDatabase<OxfordDB> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeout);

    const request = openDB<OxfordDB>(DB_NAME, version, {
      upgrade(database, oldVersion) {
        upgradeSchema(database, oldVersion);
      },
      blocked() {
        /*
         * 有老连接挡着。不能立刻失败（老标签页常常马上就关），
         * 但也不能干等 —— 上面的计时器仍在跑，超时就走内存态。
         * 记下这件事，让界面能说清原因而不是默默转圈。
         */
        blockedOnce = true;
      },
      blocking() {
        // 我们在挡别人升级：让路。关掉之后对面立刻能升级完成。
        void closeConnection();
      },
      terminated() {
        // 浏览器强制回收了连接：清掉缓存，下次重新打开
        connection = null;
      },
    });

    request.then(finish, () => finish(null));
  });
}

/**
 * 上一次打开是否撞到过 `blocked`（另一个标签页挡着升级）。
 *
 * 只用于诊断文案：撞到时界面能说「另一个标签页占用着数据库」，
 * 而不是让用户面对一个什么也不说的加载态。
 */
let blockedOnce = false;

/** 读并重置阻塞标记（初始化流程用它决定要不要提示用户） */
export function consumeBlockedFlag(): boolean {
  const flag = blockedOnce;
  blockedOnce = false;
  return flag;
}

/** 关掉缓存里的连接（升级阻塞 / 连接被终止时用） */
async function closeConnection(): Promise<void> {
  const pending = connection;
  connection = null;
  if (!pending) return;
  try {
    const handle = await pending;
    handle?.close();
  } catch {
    // 关不掉也不影响：下次会重新 open
  }
}

async function db(): Promise<IDBPDatabase<OxfordDB> | null> {
  if (!supportsIdb()) return null;
  if (!connection) {
    // 注意：这里缓存的是 openWithTimeout 的 promise，它自身保证会 resolve
    connection = openWithTimeout(DB_VERSION);
  }
  return connection;
}

/** 建表 / 升级。抽出来是为了让 openWithTimeout 保持单一职责（超时与重试） */
function upgradeSchema(
  database: Parameters<NonNullable<OpenDBCallbacks<OxfordDB>["upgrade"]>>[0],
  oldVersion: number,
): void {
  /**
   * v1 → v2：删掉复习遗留的三个 store，只剩 mastery / meta。
   * 删除是有意的（那些数据已经没有任何界面在读），用户的「已掌握」标记原样保留。
   */
  {
    if (oldVersion < 2) {
      /*
       * 这三个 store 已经不在 OxfordDB 的 schema 里，所以 contains / deleteObjectStore
       * 的类型入口看不到它们 —— 这正是「要删的正是类型里已不存在的东西」。
       * 走一次显式的未类型化入口，而不是把 schema 声明成它们的联合。
       */
      const raw = database as unknown as {
        objectStoreNames: { contains(name: string): boolean };
        deleteObjectStore(name: string): void;
      };
      for (const store of ["srs", "reviews", "days"]) {
        if (raw.objectStoreNames.contains(store)) raw.deleteObjectStore(store);
      }
    }
    if (!database.objectStoreNames.contains("mastery")) {
      database.createObjectStore("mastery", { keyPath: "key" });
    }
    if (!database.objectStoreNames.contains("meta")) {
      database.createObjectStore("meta");
    }
    /*
     * v3：自测流水。autoIncrement 让「追加一条」不需要先读一次最大 id；
     * `at` 上建索引是为了「按时间倒序取最近 N 条」不用把全表读出来 ——
     * 流水会一直变长，这一条索引是它唯一的查询方式。
     */
    if (!database.objectStoreNames.contains("drills")) {
      const store = database.createObjectStore("drills", {
        keyPath: "id",
        autoIncrement: true,
      });
      store.createIndex("at", "at");
    }
  }
}

/** 清掉 v1 遗留的锁屏 meta 键（删过一次就不再尝试，失败也只是留下无用键） */
async function dropLegacyMeta(handle: IDBPDatabase<OxfordDB>): Promise<void> {
  try {
    const keys = await handle.getAllKeys("meta");
    const stale = keys.filter((key) =>
      (LEGACY_META_KEYS as readonly string[]).includes(String(key)),
    );
    if (stale.length === 0) return;
    await Promise.all(stale.map((key) => handle.delete("meta", key)));
  } catch {
    // 清理失败不影响任何功能
  }
}

/* ── 读取 ─────────────────────────────────────────────────────── */

export async function loadSnapshot(): Promise<Snapshot> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    return memory;
  }
  try {
    const [masteryRows, metaRows] = await Promise.all([
      handle.getAll("mastery"),
      handle.getAll("meta"),
    ]);

    const metaMap = new Map<string, unknown>();
    // getAll 不带 key；meta 用 getAllKeys 配对
    const metaKeys = await handle.getAllKeys("meta");
    metaKeys.forEach((key, index) => metaMap.set(String(key), metaRows[index]));

    const meta: MetaState = {
      migratedFromLocal: Boolean(
        metaMap.get(META_KEYS.migratedFromLocal) ?? DEFAULT_META.migratedFromLocal,
      ),
      migratedKeys: Boolean(metaMap.get(META_KEYS.migratedKeys) ?? DEFAULT_META.migratedKeys),
      prefs: normalizePrefs(metaMap.get(META_KEYS.prefs)),
    };

    // 顺手清掉 v1 的锁屏 meta 键，不阻塞读快照
    void dropLegacyMeta(handle);

    /*
     * 偏好写回。
     *
     * 老库里的 prefs 还带着 reviewSize / quizSize / retention / quizTypes /
     * autoLockMinutes 这些已移除功能的字段。归一后如果存储内容不一样，就写回一份
     * 干净的 —— 否则「这个应用到底存了什么」永远说不清，导出里也会带着死字段。
     */
    const storedPrefs = metaMap.get(META_KEYS.prefs);
    if (storedPrefs !== undefined && !isCleanPrefs(storedPrefs, meta.prefs)) {
      void handle.put("meta", meta.prefs, META_KEYS.prefs).catch(() => undefined);
    }

    return {
      mastery: new Map(masteryRows.map((row) => [row.key, Number(row.at) || 0] as const)),
      meta,
      // 首屏不读流水（没有读取方），要用的时候走 recentDrills()
      drills: [],
    };
  } catch {
    memory ??= emptySnapshot();
    return memory;
  }
}

/** 现在唯一还有意义的两个偏好键 */
const PREF_KEYS = ["pageSize", "defaultLevel"] as const;

/** 存储里的偏好是否已经与归一结果一致（键只有两个，值也合法） */
function isCleanPrefs(value: unknown, normalized: Prefs): boolean {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  if (keys.length !== PREF_KEYS.length) return false;
  if (!keys.every((key) => (PREF_KEYS as readonly string[]).includes(key))) return false;
  const stored = value as Partial<Prefs>;
  return stored.pageSize === normalized.pageSize && stored.defaultLevel === normalized.defaultLevel;
}

function isPrefs(value: unknown): value is Partial<Prefs> {
  return Boolean(value && typeof value === "object" && "pageSize" in value);
}

/**
 * 偏好归一。
 *
 * 只认 pageSize / defaultLevel，其余字段（早期版本的 sessionSize、newPerDay、
 * reviewSize、quizSize、retention、quizTypes、includeExtended、cefrCap、
 * autoLockMinutes）一律丢弃 —— 它们服务的是已经移除的复习/测试/锁屏功能。
 */
export function normalizePrefs(value: unknown): Prefs {
  if (!isPrefs(value)) return { ...DEFAULT_PREFS };
  const input = value as Partial<Prefs>;
  return {
    // 每页条数上限从 500 收到 200：老库里存 500 会落到一个不存在的选项上
    pageSize: clampPageSize(input.pageSize),
    // 非法等级交回默认值；合法值原样保留
    defaultLevel: isLevelFilter(input.defaultLevel)
      ? input.defaultLevel
      : DEFAULT_PREFS.defaultLevel,
  };
}

/** 每页条数只接受 PAGE_SIZES 里的值（上限 200，见 lib/types） */
function clampPageSize(value: unknown): PageSize {
  const fallback: PageSize = 20;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  let best: PageSize = PAGE_SIZES[0] as PageSize;
  let distance = Number.POSITIVE_INFINITY;
  for (const option of PAGE_SIZES) {
    const d = Math.abs(option - value);
    if (d < distance) {
      best = option;
      distance = d;
    }
  }
  return best;
}

/* ── 写入 ─────────────────────────────────────────────────────── */

/* ── 自测流水 ───────────────────────────────────────────────── */

/**
 * 追加一条自测记录。
 *
 * 失败不抛：自测结果只用于看趋势，写不进去不该让「刚才那轮白做了」。
 * 内存态下退化成存在内存里 —— 与其它写入同一条降级路径。
 */
export async function appendDrill(record: DrillRecord): Promise<void> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    memory.drills.push(record);
    return;
  }
  try {
    await handle.add("drills", record);
  } catch {
    // 写流水失败不影响本次自测结果展示
  }
}

/**
 * 最近 N 条自测记录，按时间倒序。
 *
 * 走 `at` 索引从后往前取，而不是全表 `getAll` 再排序：流水会一直变长，
 * 而界面只要「最近几条」。
 */
export async function recentDrills(limit = 10): Promise<DrillRecord[]> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    return [...memory.drills].sort((a, b) => b.at - a.at).slice(0, limit);
  }
  try {
    const tx = handle.transaction("drills", "readonly");
    const index = tx.store.index("at");
    const out: DrillRecord[] = [];
    let cursor = await index.openCursor(null, "prev");
    while (cursor && out.length < limit) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    return out;
  } catch {
    return [];
  }
}

export async function saveMastery(keys: readonly string[], mastered: boolean): Promise<void> {
  if (keys.length === 0) return;
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    for (const key of keys) {
      if (mastered) memory.mastery.set(key, Date.now());
      else memory.mastery.delete(key);
    }
    return;
  }
  const tx = handle.transaction("mastery", "readwrite");
  await Promise.all(
    keys.map((key) => (mastered ? tx.store.put({ key, at: Date.now() }) : tx.store.delete(key))),
  );
  await tx.done;
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    memory.meta = { ...memory.meta, prefs };
    return;
  }
  await handle.put("meta", prefs, META_KEYS.prefs);
}

async function saveMigratedFlag(): Promise<void> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    memory.meta = { ...memory.meta, migratedFromLocal: true };
    return;
  }
  await handle.put("meta", true, META_KEYS.migratedFromLocal);
}

/* ── 迁移（§5 F4）──────────────────────────────────────────────── */

/**
 * 首次启动读旧 localStorage → 写入 mastery，旧键保留作备份。
 * 返回导入的条数；已迁移过则返回 0。
 *
 * `existing`：调用方已经读过的快照。启动时上层本来就为渲染读了一次全表，
 * 这里再读一遍只是重复劳动（已掌握 5323 条时多花约 100ms），传进来即可。
 */
export async function migrateLegacy(
  buckets: ReadonlyMap<string, string>,
  existing?: Snapshot,
): Promise<number> {
  const snapshot = existing ?? (await loadSnapshot());
  if (snapshot.meta.migratedFromLocal) return 0;

  let legacy: string[] = [];
  try {
    const raw = localStorage.getItem(LEGACY_MASTERED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed))
      legacy = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    legacy = [];
  }

  if (legacy.length > 0) {
    // 旧 localStorage 里的键还是旧格式（等级|单词|词性），一并换算
    const remapped = new Set<string>();
    for (const key of legacy) remapped.add(remapWithBuckets(key, buckets) ?? migrateKey(key));
    await saveMastery([...remapped], true);
    // 旧键不删，保留作备份
  }

  await saveMigratedFlag();
  return legacy.length;
}

/**
 * 启动时有没有待做的迁移（只查 meta 标记，不读全表、不碰词表）。
 *
 * 存在的意义是不让「迁移要读词表」变成首屏的常态开销：绝大多数用户升级过一次
 * 之后这里返回全 false，首屏就完全不必 loadAll，仍然只加载默认等级。
 */
export async function pendingMigrations(): Promise<{ keys: boolean; legacy: boolean }> {
  /** 旧 localStorage 还没导过，且确实有数据 → 才值得为它读词表 */
  let hasLegacyData: boolean;
  try {
    const raw = localStorage.getItem(LEGACY_MASTERED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    hasLegacyData = Array.isArray(parsed) && parsed.length > 0;
  } catch {
    hasLegacyData = false;
  }

  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    return {
      keys: !memory.meta.migratedKeys,
      legacy: !memory.meta.migratedFromLocal && hasLegacyData,
    };
  }
  const [keysDone, legacyDone] = await Promise.all([
    handle.get("meta", META_KEYS.migratedKeys),
    handle.get("meta", META_KEYS.migratedFromLocal),
  ]).catch(() => [true, true] as const);
  return { keys: !keysDone, legacy: !legacyDone && hasLegacyData };
}

/**
 * 把库里已有的旧主键换算成新主键，跑一次就记标记。
 *
 * ## 为什么必须做
 *
 * 老版本主键是 `等级|单词|词性[|序号]`，新主键是 `板块|单词`。两套格式
 * **没有任何一个 key 能直接命中**（实测 5321 个旧 key 命中 0 个）——
 * 不换算的话，所有老用户升级后打开就是「进度全空」，而且下次同步还会把
 * 空进度推上云端，把服务端那份也一起覆盖。
 *
 * ## 为什么在本地做而不是在云端做
 *
 * 云端的 word_key 是同一套旧格式，服务端没有词表、无法判断「哪些 key 属于
 * 同一个词」。本地有词表、有 level 与词性，换算在这里做，再把结果作为
 * 一次普通的 upsert 推上去（新 key 在云端没有行 → mergeMastery 会带上它），
 * 顺带就把云端也迁完了，不需要额外的服务端脚本。
 *
 * 返回换算前后的条数；已经做过则返回 null。
 */
export async function migrateMasteryKeys(
  buckets: ReadonlyMap<string, string>,
): Promise<{ before: number; after: number } | null> {
  /** 一条旧 key → 新 key。词表里没有这个词时保留旧格式，不硬塞到错误板块 */
  const remap = (key: string) => remapWithBuckets(key, buckets) ?? migrateKey(key);

  const handle = await db();
  if (!handle) {
    // 内存态：内存就是全部数据，就地换算
    memory ??= emptySnapshot();
    const snapshot = memory;
    if (snapshot.meta.migratedKeys) return null;
    const before = snapshot.mastery.size;
    const remapped = new Map<string, number>();
    for (const [key, at] of snapshot.mastery) {
      const next = remap(key);
      // 同一个词的多行塌成一行时保留最新的标记时间
      const prev = remapped.get(next);
      if (prev === undefined || at > prev) remapped.set(next, at);
    }
    snapshot.mastery = remapped;
    snapshot.meta = { ...snapshot.meta, migratedKeys: true };
    return { before, after: remapped.size };
  }

  // 标记要先查一遍：没有这一步，每次启动都会把全表重写一次
  const done = await handle.get("meta", META_KEYS.migratedKeys);
  if (done) return null;

  const rows = await handle.getAll("mastery");
  if (rows.length === 0) {
    await handle.put("meta", true, META_KEYS.migratedKeys);
    return { before: 0, after: 0 };
  }

  const remapped = new Map<string, number>();
  for (const row of rows) {
    const next = remap(row.key);
    const at = Number(row.at) || 0;
    const prev = remapped.get(next);
    if (prev === undefined || at > prev) remapped.set(next, at);
  }

  /*
   * 先把新 key 全部写进去，再删旧 key。
   *
   * 顺序不能反：中途崩掉时，最坏结果是「新旧并存」（下次启动重跑一遍，
   * 结果一样），而反过来就会出现「旧的删了、新的还没写」—— 那才是真的丢进度。
   */
  const tx = handle.transaction("mastery", "readwrite");
  for (const [key, at] of remapped) await tx.store.put({ key, at });
  for (const row of rows) if (!remapped.has(row.key)) await tx.store.delete(row.key);
  await tx.done;

  await handle.put("meta", true, META_KEYS.migratedKeys);
  return { before: rows.length, after: remapped.size };
}
