/**
 * 云端同步的轻量部分：状态类型、合并规则、enabled 判定。
 *
 * ## 为什么这里不 import supabase-js
 *
 * 真正的客户端在 `cloudClient.ts`，用动态 import 加载。理由和 GuidePage 一样：
 * 同步是个「登录之后才有」的能力，而未登录的人占了绝大多数打开次数。
 * 把 supabase-js 静态import 进来，等于让每个首屏都为它付 4.5KB gzip 的下载
 * 与解析成本 —— 对比一下，被移出首屏的 Markdown 解析器是 40KB，这里虽然小得多，
 * 但道理完全相同，没有理由破例。
 *
 * 所以：本文件只放不碰网络的东西，`cloudClient.ts` 才是重的那一半。
 */
import type { CloudState } from "./cloudState";
import { buildBucketMap, migrateKey } from "./masteryKey";

export type { CloudState };

/** 云端一行：key 是否已掌握 + 服务端写这行的时间 */
export interface RemoteRow {
  mastered: boolean;
  /** 服务端 updated_at（epoch ms） */
  at: number;
}

/**
 * 是否配置了云端。
 *
 * 三个变量缺一不可：URL、anon key 决定「能不能连」，邮箱决定「登录谁」。
 * 少任何一个都整体停用 —— 本地开发、e2e、首次 clone 的开发者都拿到一个
 * 和接入之前一模一样的纯本地应用，不报错、也不出现一个点了必然失败的登录框。
 */
export const cloudEnabled = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY &&
  import.meta.env.VITE_CLOUD_EMAIL,
);

/* ── 合并（纯函数，可单测）──────────────────────────────────── */

export interface MergeResult {
  merged: Map<string, number>;
  /** 需要回写云端的 key：本地更新、或云端还没有的 */
  upload: string[];
}

/**
 * 本地快照 + 云端快照 → 合并结果。
 *
 * 规则只有两条：
 *   1. 远端这一行比本地新 → 采信远端（mastered 为真就加上，为假就删掉）
 *   2. 本地比远端新、而远端是墓碑 → 本地赢，回写云端把墓碑翻回来
 *
 * 第三条隐含规则：云端压根没有这行、本地有 → 传上去。这就是「第一次接入
 * 云同步」时把历史进度一次性搬上云的路径，不需要额外的迁移脚本。
 *
 * 为什么必须靠服务端时间戳：手机和电脑的时钟差几分钟是常态，用各自
 * `Date.now()` 当裁判会出现「刚标的被旧数据覆盖」这种鬼故事。
 * `updated_at` 由 Postgres 触发器写 now()，客户端不传（见 supabase/schema.sql）。
 */
export function mergeMastery(
  local: ReadonlyMap<string, number>,
  remote: ReadonlyMap<string, RemoteRow>,
): MergeResult {
  const merged = new Map(local);

  for (const [key, row] of remote) {
    const localAt = merged.get(key);
    if (row.mastered) {
      // 远端说已掌握：本地没有、或本地更旧，都采信远端
      if (localAt === undefined || row.at > localAt) merged.set(key, row.at);
    } else if (localAt !== undefined && row.at > localAt) {
      // 远端是墓碑且更新 → 本地跟着取消
      merged.delete(key);
    }
  }

  const upload: string[] = [];
  for (const [key, at] of merged) {
    const row = remote.get(key);
    if (!row) {
      // 云端没这行：首次接入的全量上传，或离线期间新标的
      upload.push(key);
    } else if (!row.mastered && at > row.at) {
      // 云端是旧墓碑、本地更新：本地这一票要回写，否则下次拉取又把它删掉
      upload.push(key);
    }
  }

  return { merged, upload };
}

/**
 * 把云端的旧主键归一化到新主键。
 *
 * 云端存的是同一套旧格式（`A1|arm|n.`），主键规则改掉之后这些行在新词表里
 * 一个都找不到。不归一化就直接合并的话，它们会被当成「云端有、本地没有的词」
 * 灌进本地状态 —— 界面上看不见（词表里没有这些 key），但它们会：
 *   1. 让「已掌握」总数虚高；
 *   2. 每次同步都被当作待处理项，白跑一遍。
 *
 * 同一个词的多行塌成一行时，按「最近的一行说了算」合并：
 * 已掌握的取最新时间，全是墓碑就当没掌握。这与 mergeMastery 的时间戳规则一致。
 *
 * 旧行本身不清洗：删云端数据要额外权限与确认，而这些行不匹配任何词条、
 * 不会再影响任何界面。留着的成本是几行死数据，删错的成本是用户进度。
 */
export function normalizeRemoteKeys(
  remote: ReadonlyMap<string, RemoteRow>,
  buckets?: ReadonlyMap<string, string>,
): Map<string, RemoteRow> {
  /*
   * 两套对照，优先级明确：
   *   1. `buckets`（调用方从真实词表建的）—— 权威，能处理「云端只存了半边数据」
   *   2. buildBucketMap(remote.keys()) —— 兜底，只能靠云端自己那批 key 推
   *
   * 为什么不能逐行直接 migrateKey：arm 的两行分别写着 A1 与 C1，各自换算会得到
   * A1|arm 与 C1|arm 两个 key —— 一个词被拆成两行，而 C1|arm 在词表里不存在。
   * 板块只由单词决定，所以必须收敛。
   */
  const fallback = buildBucketMap(remote.keys());
  const out = new Map<string, RemoteRow>();
  for (const [key, row] of remote) {
    const word = key.split("|")[1] ?? "";
    const bucket = buckets?.get(word) ?? fallback.get(word);
    const next = bucket === undefined ? migrateKey(key) : `${bucket}|${word}`;
    const prev = out.get(next);
    if (!prev) {
      out.set(next, row);
      continue;
    }
    // 时间新的赢；时间相同则「已掌握」赢（宁可多认一个词，也别把进度吞掉）
    if (row.at > prev.at || (row.at === prev.at && row.mastered)) out.set(next, row);
  }
  return out;
}

/** 两个 Map 内容一致就不换引用，避免 setState 触发下游 effect 自激 */
export function sameMastery(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, at] of a) if (b.get(key) !== at) return false;
  return true;
}

/* ── 懒加载入口 ─────────────────────────────────────────────── */

/**
 * 取真正的客户端模块。
 *
 * 用 `() => import(...)` 而不是顶层 import：Vite 会把它切成独立 chunk，
 * 首屏不下载。只有真的点了同步 / 登录，或者用户已有登录态时才拉。
 *
 * 记住这个 Promise，避免连点两次「立即同步」拉两遍模块。
 */
let clientModule: Promise<typeof import("./cloudClient")> | null = null;

export function loadCloudClient(): Promise<typeof import("./cloudClient")> {
  clientModule ??= import("./cloudClient");
  return clientModule;
}
