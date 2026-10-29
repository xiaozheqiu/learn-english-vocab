/**
 * IndexedDB 仓储 + 迁移 + 导出/导入（§5 F4 / §6 lib/db.ts）
 *
 * 库 ox5000 v1：
 *   mastery(key) / srs(key) / reviews(自增) / days(day) / meta(k)
 * 隐私模式打不开 IDB 时整体降级为内存态，由上层展示「本次进度不会保存」。
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  isCefr,
  DB_NAME,
  DB_VERSION,
  DEFAULT_PREFS,
  DEFAULT_QUIZ_SIZE,
  DEFAULT_REVIEW_SIZE,
  LEGACY_MASTERED_KEY,
  PAGE_SIZES,
  QUIZ_SIZES,
  REVIEW_SIZES,
  type PageSize,
  type DayRecord,
  type MetaState,
  type Prefs,
  type ReviewLogRecord,
  type SrsCardRecord,
} from "./types";

interface OxfordDB extends DBSchema {
  mastery: { key: string; value: { key: string; at: number } };
  srs: { key: string; value: SrsCardRecord };
  reviews: {
    key: number;
    value: ReviewLogRecord & { id: number };
    indexes: { byKey: string; byAt: number };
  };
  days: { key: string; value: DayRecord };
  meta: { key: string; value: unknown };
}

export interface Snapshot {
  /** key → 标记时间（epoch ms）。过了冷却期会重新进入复习队列 */
  mastery: Map<string, number>;
  srs: Map<string, SrsCardRecord>;
  days: Map<string, DayRecord>;
  meta: MetaState;
}

export const META_KEYS = {
  lockEnabled: "lockEnabled",
  pinHash: "pinHash",
  lockGraceUntil: "lockGraceUntil",
  setupDone: "setupDone",
  migratedFromLocal: "migratedFromLocal",
  prefs: "prefs",
} as const;

export const DEFAULT_META: MetaState = {
  lockEnabled: false,
  pinHash: null,
  lockGraceUntil: null,
  setupDone: false,
  migratedFromLocal: false,
  prefs: DEFAULT_PREFS,
};

let connection: Promise<IDBPDatabase<OxfordDB> | null> | null = null;
/** 降级内存态 */
let memory: Snapshot | null = null;
let memoryReviews: ReviewLogRecord[] = [];

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
    srs: new Map(),
    days: new Map(),
    meta: { ...DEFAULT_META, prefs: { ...DEFAULT_PREFS } },
  };
}

async function db(): Promise<IDBPDatabase<OxfordDB> | null> {
  if (!supportsIdb()) return null;
  if (!connection) {
    connection = openDB<OxfordDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("mastery")) {
          database.createObjectStore("mastery", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("srs")) {
          database.createObjectStore("srs", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("reviews")) {
          const store = database.createObjectStore("reviews", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("byKey", "key");
          store.createIndex("byAt", "at");
        }
        if (!database.objectStoreNames.contains("days")) {
          database.createObjectStore("days", { keyPath: "day" });
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta");
        }
      },
    }).catch(() => null);
  }
  return connection;
}

/* ── 读取 ─────────────────────────────────────────────────────── */

export async function loadSnapshot(): Promise<Snapshot> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    return memory;
  }
  try {
    const [masteryRows, srsRows, dayRows, metaRows] = await Promise.all([
      handle.getAll("mastery"),
      handle.getAll("srs"),
      handle.getAll("days"),
      handle.getAll("meta"),
    ]);

    const metaMap = new Map<string, unknown>();
    // getAll 不带 key；meta 用 getAllKeys 配对
    const metaKeys = await handle.getAllKeys("meta");
    metaKeys.forEach((key, index) => metaMap.set(String(key), metaRows[index]));

    const prefs = metaMap.get(META_KEYS.prefs);
    const meta: MetaState = {
      lockEnabled: Boolean(metaMap.get(META_KEYS.lockEnabled) ?? DEFAULT_META.lockEnabled),
      pinHash: (metaMap.get(META_KEYS.pinHash) as MetaState["pinHash"]) ?? null,
      lockGraceUntil: (metaMap.get(META_KEYS.lockGraceUntil) as number | null | undefined) ?? null,
      setupDone: Boolean(metaMap.get(META_KEYS.setupDone) ?? DEFAULT_META.setupDone),
      migratedFromLocal: Boolean(
        metaMap.get(META_KEYS.migratedFromLocal) ?? DEFAULT_META.migratedFromLocal,
      ),
      prefs: normalizePrefs(prefs),
    };

    return {
      mastery: new Map(masteryRows.map((row) => [row.key, Number(row.at) || 0] as const)),
      srs: new Map(srsRows.map((row) => [row.key, row])),
      days: new Map(dayRows.map((row) => [row.day, row])),
      meta,
    };
  } catch {
    memory ??= emptySnapshot();
    return memory;
  }
}

function isPrefs(value: unknown): value is Partial<Prefs> {
  return Boolean(value && typeof value === "object" && "pageSize" in value);
}

/**
 * 偏好归一 + 迁移。
 *
 * 早期版本只有一个 `sessionSize`（复习和测试共用）。现在拆成
 * `reviewSize` / `quizSize`：老库里存过 sessionSize 的，把它的值当复习题量
 * （那正是它当初的含义），测试题量用默认 50 —— 不给用户留一个「测一次 300 题」的坑。
 */
export function normalizePrefs(value: unknown): Prefs {
  if (!isPrefs(value)) return { ...DEFAULT_PREFS };
  const merged: Prefs = { ...DEFAULT_PREFS, ...value };
  const legacy = (value as { sessionSize?: unknown }).sessionSize;
  if (typeof legacy === "number" && Number.isFinite(legacy) && legacy > 0) {
    if ((value as { reviewSize?: unknown }).reviewSize === undefined) {
      merged.reviewSize = clampSize(legacy, REVIEW_SIZES, DEFAULT_REVIEW_SIZE);
    }
  }
  merged.quizSize = clampSize(merged.quizSize, QUIZ_SIZES, DEFAULT_QUIZ_SIZE);
  merged.reviewSize = clampSize(merged.reviewSize, REVIEW_SIZES, DEFAULT_REVIEW_SIZE);
  // 每页条数上限从 500 收到 200：老库里存 500 会落到一个不存在的选项上
  merged.pageSize = clampPageSize(merged.pageSize);
  // 老库里的 newPerDay 字段直接丢弃：新词不再有每日配额，字段已从 Prefs 移除
  delete (merged as { newPerDay?: unknown }).newPerDay;
  // 字符串 "true" 之类一律收敛成布尔：老库里可能来自 JSON 导入
  merged.includeExtended =
    value !== null && typeof value === "object"
      ? (value as { includeExtended?: unknown }).includeExtended === true
      : false;
  // CEFR 上限只接受已知分级，其余（老库没有这个字段、手改成的乱值）回落成「不限」
  const rawCap =
    value !== null && typeof value === "object"
      ? (value as { cefrCap?: unknown }).cefrCap
      : undefined;
  merged.cefrCap = isCefr(rawCap) ? rawCap : "";
  return merged;
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

/**
 * 把任意数值夹到候选集合里最接近的一档。
 *
 * 距离相同时取更大的那一档：老库里的 400 在 300 / 500 之间等距，
 * 用户当初选 400 的意思是「我要多」，降成 300 等于悄悄砍掉他的量。
 */
function clampSize<T extends number>(value: unknown, options: readonly T[], fallback: T): T {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (options.length === 0) return fallback;
  let best = options[0] as T;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const distance = Math.abs(option - value);
    if (distance < bestDistance || (distance === bestDistance && option > best)) {
      best = option;
      bestDistance = distance;
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

export async function saveCard(record: SrsCardRecord): Promise<void> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    memory.srs.set(record.key, record);
    return;
  }
  await handle.put("srs", record);
}

export async function saveCards(records: readonly SrsCardRecord[]): Promise<void> {
  if (records.length === 0) return;
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    for (const record of records) memory.srs.set(record.key, record);
    return;
  }
  const tx = handle.transaction("srs", "readwrite");
  await Promise.all(records.map((record) => tx.store.put(record)));
  await tx.done;
}

/** 撤销支持：直接覆盖回上一版 */
export async function deleteCard(key: string): Promise<void> {
  const handle = await db();
  if (!handle) {
    memory?.srs.delete(key);
    return;
  }
  await handle.delete("srs", key);
}

export async function appendReview(log: ReviewLogRecord): Promise<number> {
  const handle = await db();
  if (!handle) {
    const id = memoryReviews.length + 1;
    memoryReviews.push({ ...log, id });
    return id;
  }
  return handle.add("reviews", log as ReviewLogRecord & { id: number });
}

export async function saveDay(record: DayRecord): Promise<void> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    memory.days.set(record.day, record);
    return;
  }
  await handle.put("days", record);
}

export async function saveMeta(partial: Partial<MetaState>): Promise<void> {
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    memory.meta = { ...memory.meta, ...partial };
    return;
  }
  const tx = handle.transaction("meta", "readwrite");
  const entries: [string, unknown][] = [];
  if (partial.lockEnabled !== undefined) entries.push([META_KEYS.lockEnabled, partial.lockEnabled]);
  if (partial.pinHash !== undefined) entries.push([META_KEYS.pinHash, partial.pinHash]);
  if (partial.lockGraceUntil !== undefined)
    entries.push([META_KEYS.lockGraceUntil, partial.lockGraceUntil]);
  if (partial.setupDone !== undefined) entries.push([META_KEYS.setupDone, partial.setupDone]);
  if (partial.migratedFromLocal !== undefined)
    entries.push([META_KEYS.migratedFromLocal, partial.migratedFromLocal]);
  if (partial.prefs !== undefined) entries.push([META_KEYS.prefs, partial.prefs]);
  await Promise.all(entries.map(([key, value]) => tx.store.put(value, key)));
  await tx.done;
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await saveMeta({ prefs });
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
    const handle = await db();
    if (handle) {
      const tx = handle.transaction("mastery", "readwrite");
      const at = Date.now();
      await Promise.all(legacy.map((key) => tx.store.put({ key, at })));
      await tx.done;
    } else {
      memory ??= emptySnapshot();
      for (const key of legacy) memory.mastery.set(key, Date.now());
    }
    // 旧键不删，保留作备份
  }

  await saveMeta({ migratedFromLocal: true });
  return legacy.length;
}

/* ── 导出 / 导入 / 清空（§2.3 数据分区）────────────────────────── */

export interface ExportPayload {
  version: 2;
  exportedAt: string;
  mastery: string[];
  srs: SrsCardRecord[];
  days: DayRecord[];
  prefs: Prefs;
}

export async function exportAll(): Promise<ExportPayload> {
  const snapshot = await loadSnapshot();
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    mastery: [...snapshot.mastery.keys()].sort(),
    srs: [...snapshot.srs.values()].sort((a, b) => a.key.localeCompare(b.key)),
    days: [...snapshot.days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    prefs: snapshot.meta.prefs,
  };
}

export interface ImportSummary {
  mastery: number;
  srs: number;
  days: number;
}

/** 覆盖式导入。调用方负责二次确认 */
export async function importAll(payload: unknown): Promise<ImportSummary> {
  const parsed = parseExport(payload);
  await clearProgress();

  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    parsed.mastery.forEach((key) => memory!.mastery.set(key, Date.now()));
    parsed.srs.forEach((record) => memory!.srs.set(record.key, record));
    parsed.days.forEach((day) => memory!.days.set(day.day, day));
    await savePrefs(normalizePrefs(parsed.prefs));
    return summarise(parsed);
  }

  const tx = handle.transaction(["mastery", "srs", "days"], "readwrite");
  const at = Date.now();
  await Promise.all([
    ...parsed.mastery.map((key) => tx.objectStore("mastery").put({ key, at })),
    ...parsed.srs.map((record) => tx.objectStore("srs").put(record)),
    ...parsed.days.map((day) => tx.objectStore("days").put(day)),
  ]);
  await tx.done;
  await savePrefs(parsed.prefs);
  return summarise(parsed);
}

function summarise(parsed: ExportPayload): ImportSummary {
  return {
    mastery: parsed.mastery.length,
    srs: parsed.srs.length,
    days: parsed.days.length,
  };
}

export function parseExport(payload: unknown): ExportPayload {
  const source = typeof payload === "string" ? (JSON.parse(payload) as unknown) : payload;
  if (!source || typeof source !== "object") throw new Error("文件内容不是合法 JSON 对象");
  const obj = source as Partial<ExportPayload>;
  const mastery = Array.isArray(obj.mastery)
    ? obj.mastery.filter((key): key is string => typeof key === "string")
    : [];
  const srs = Array.isArray(obj.srs) ? obj.srs.filter(isCardRecord) : [];
  const days = Array.isArray(obj.days) ? obj.days.filter(isDayRecord) : [];
  const prefs = isPrefs(obj.prefs) ? { ...DEFAULT_PREFS, ...obj.prefs } : { ...DEFAULT_PREFS };
  return {
    version: 2,
    exportedAt: String(obj.exportedAt ?? ""),
    mastery,
    srs,
    days,
    prefs,
  };
}

function isCardRecord(value: unknown): value is SrsCardRecord {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<SrsCardRecord>;
  return (
    typeof card.key === "string" &&
    typeof card.due === "number" &&
    typeof card.stability === "number"
  );
}

function isDayRecord(value: unknown): value is DayRecord {
  if (!value || typeof value !== "object") return false;
  const day = value as Partial<DayRecord>;
  return typeof day.day === "string" && typeof day.reviewed === "number";
}

/** 清空进度但保留 meta（锁屏、偏好） */
export async function clearProgress(): Promise<void> {
  memoryReviews = [];
  const handle = await db();
  if (!handle) {
    memory ??= emptySnapshot();
    memory.mastery.clear();
    memory.srs.clear();
    memory.days.clear();
    return;
  }
  const tx = handle.transaction(["mastery", "srs", "reviews", "days"], "readwrite");
  await Promise.all([
    tx.objectStore("mastery").clear(),
    tx.objectStore("srs").clear(),
    tx.objectStore("reviews").clear(),
    tx.objectStore("days").clear(),
  ]);
  await tx.done;
}
