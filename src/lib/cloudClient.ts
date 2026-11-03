/**
 * Supabase 客户端与网络操作 —— 只在真正需要同步时才被加载。
 *
 * 由 `cloud.ts` 的 `loadCloudClient()` 动态 import。**不要**在任何首屏路径上
 * 静态 import 这个文件，否则 supabase-js（约 4.5KB gzip）会回到主包，
 * 让每个没登录的人替它付下载与解析成本。
 *
 * ## 分工
 *
 * **IndexedDB 仍然是唯一事实来源，云端只是备份与中转。** 所以每个网络调用
 * 都由上层用 `void` 触发：失败只置状态，不回滚内存，更不阻塞词表渲染。
 * 这条和 db.ts 里「隐私模式降级内存态」是同一个取向。
 *
 * ## 为什么表里存 mastered 而不只存「存在的行」
 *
 * 本地 mastery 只有「已掌握」的键，取消掌握 = 删掉一行。若云端也只存存在的行，
 * 删除这个动作就没有任何东西可同步：另一台设备拉取时看不到这行，会把自己本地
 * 的「已掌握」当成正确的留下来，下次一 push 又把它复活。
 *
 * 所以取消必须落成 `mastered = false` 的墓碑行 —— 有行、有状态、有时间。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RemoteRow } from "./cloud";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * 唯一的账号。全站只有一个用户 —— 手机、电脑登录的都是它。
 *
 * 邮箱写进构建而不是让用户输：多用户注册体系的界面复杂度（邮箱校验、
 * 账号不存在 vs 密码错误的区分、找回密码）服务的是一个不存在的问题。
 * 这里只需要「是不是本人」，那一个密码就是全部。
 */
const cloudEmail = (import.meta.env.VITE_CLOUD_EMAIL ?? "").trim();

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  client ??= createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // OAuth 回调会把 token 放在 URL 片段里，必须让 supabase-js 自己去捡
      detectSessionInUrl: true,
    },
  });
  return client;
}

/* ── 认证 ───────────────────────────────────────────────────── */

export async function currentUserId(): Promise<string | null> {
  const db = supabase();
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * 当前 access token。
 *
 * 给「页面正在关闭时用原生 fetch + keepalive 补推」那条路径用的：
 * supabase-js 的链式调用不暴露 `keepalive`，必须自己拼请求头。
 */
export async function currentAccessToken(): Promise<string | null> {
  const db = supabase();
  if (!db) return null;
  const { data } = await db.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function isSignedIn(): Promise<boolean> {
  return (await currentUserId()) !== null;
}

/**
 * 密码登录。
 *
 * 只收密码，邮箱来自构建期注入的 `VITE_CLOUD_EMAIL`。用邮箱密码而不是 OAuth：
 * 单用户场景下 OAuth 要跑去 GitHub 建应用、填 Client ID/Secret、配回调白名单，
 * 三处配置换来的只是「少打一次密码」。而账号本来就在 Supabase 的 auth.users 里。
 *
 * 注意这里登录的是 **Supabase Auth 的用户**，不是 Postgres 连接账号 —— 两者
 * 完全无关。前者决定「这份进度属于谁」，后者只用来建表改结构，永远不进前端。
 */
export async function signInWithPassword(password: string): Promise<string | null> {
  const db = supabase();
  if (!db) return "未配置云端";
  if (!cloudEmail) return "未配置账号邮箱（VITE_CLOUD_EMAIL）";
  const email = cloudEmail;
  const { error } = await db.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut();
}

/* ── 读写 ───────────────────────────────────────────────────── */

/**
 * 拉取云端全量。
 *
 * **未登录时返回 null，绝不返回空 Map。** 这一条是这块最容易写错的地方：
 * RLS 对匿名请求的回应不是报错，而是一个空结果集 —— `error` 为 null、
 * `data` 为 `[]`。若把它当成「云端为空」，上层会认为「合并没有任何变化、
 * 已与云端对齐」，于是登录入口永远不出现，本机进度也永远传不上去。
 *
 * 所以先确认会话，再发查询：没登录 = null（上层据此显示登录框），
 * 已登录但查询失败 = null（上层显示同步失败）。两者都不该被当成「空」。
 */
/**
 * 单次同步的等待上限。
 *
 * 没有它的话，网络半通不通时浏览器会自己撑到几十秒才放弃，期间界面一直显示
 * 「正在同步…」。超过这个时间就当作失败、明确告诉用户可以稍后再来 —— 本地
 * 数据不受影响，队列也会留着下次补推。
 */
const TIMEOUT_MS = 12_000;

/** 给任意请求套一个超时；超时后返回 null，语义与「失败」一致 */
function withTimeout<T>(task: PromiseLike<T>, ms = TIMEOUT_MS): Promise<T | null> {
  return Promise.race([
    Promise.resolve(task),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function pull(): Promise<Map<string, RemoteRow> | null> {
  const db = supabase();
  if (!db) return null;
  if (!(await isSignedIn())) return null;

  /**
   * 查询构造器是 thenable 而不是真 Promise，`Promise.race` 直接吃它会拿不到
   * `.then` 之外的东西；先 await 成普通对象再套超时。
   */
  const query = db.from("mastery").select("word_key, mastered, updated_at");
  const result = await withTimeout<{
    data: { word_key: string; mastered: boolean; updated_at: string }[] | null;
    error: unknown;
  }>(query.then((r) => ({ data: r.data as never, error: r.error })));
  if (!result || result.error || !result.data) return null;

  const rows = new Map<string, RemoteRow>();
  for (const row of result.data) {
    rows.set(row.word_key, {
      mastered: Boolean(row.mastered),
      at: Date.parse(row.updated_at) || 0,
    });
  }
  return rows;
}

/**
 * 把一个动作写进云端，返回服务端给的时间戳。
 *
 * `mastered=false` 落的是墓碑，不是删行 —— 见文件头。回传时间戳是为了让上层
 * 把本地时间换成服务端时间，下次合并时两边不会因为时钟差反复打架。
 */
export async function push(
  keys: readonly string[],
  mastered: boolean,
): Promise<Map<string, number> | null> {
  const db = supabase();
  if (!db || keys.length === 0) return null;
  const uid = await currentUserId();
  if (!uid) return null;

  const { data, error } = await db
    .from("mastery")
    .upsert(
      keys.map((word_key) => ({ user_id: uid, word_key, mastered })),
      { onConflict: "user_id,word_key" },
    )
    .select("word_key, updated_at");
  if (error || !data) return null;

  const stamps = new Map<string, number>();
  for (const row of data as { word_key: string; updated_at: string }[]) {
    stamps.set(row.word_key, Date.parse(row.updated_at) || Date.now());
  }
  return stamps;
}
