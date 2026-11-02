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
