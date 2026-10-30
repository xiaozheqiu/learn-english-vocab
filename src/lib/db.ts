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
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_PREFS,
  LEGACY_MASTERED_KEY,
  PAGE_SIZES,
  isLevelFilter,
  type MetaState,
  type PageSize,
  type Prefs,
} from "./types";

interface OxfordDB extends DBSchema {
  mastery: { key: string; value: { key: string; at: number } };
  meta: { key: string; value: unknown };
}

export interface Snapshot {
  /** key → 标记时间（epoch ms） */
  mastery: Map<string, number>;
  meta: MetaState;
}

export const META_KEYS = {
  migratedFromLocal: "migratedFromLocal",
  prefs: "prefs",
} as const;

/** v1 遗留的 meta 键：打开库时顺手清掉，不留在用户的存储里 */
const LEGACY_META_KEYS = ["lockEnabled", "pinHash", "lockGraceUntil", "setupDone"] as const;

export const DEFAULT_META: MetaState = {
  migratedFromLocal: false,
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
  };
}

async function db(): Promise<IDBPDatabase<OxfordDB> | null> {
  if (!supportsIdb()) return null;
  if (!connection) {
    connection = openDB<OxfordDB>(DB_NAME, DB_VERSION, {
      /**
       * v1 → v2：删掉复习遗留的三个 store，只剩 mastery / meta。
       * 删除是有意的（那些数据已经没有任何界面在读），用户的「已掌握」标记原样保留。
       */
      upgrade(database, oldVersion) {
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
      },
    }).catch(() => null);
  }
  return connection;
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
 */
export async function migrateLegacy(): Promise<number> {
  const snapshot = await loadSnapshot();
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
    await saveMastery(legacy, true);
    // 旧键不删，保留作备份
  }

  await saveMigratedFlag();
  return legacy.length;
}
