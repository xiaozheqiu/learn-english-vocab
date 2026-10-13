// 进度存在自己的 GitHub gist 里。
//
// 为什么是 gist：
//   - 不用新建任何账号（GitHub 账号本来就有），不用建表、不用写 SQL
//   - 不会像免费数据库那样「闲置几天被暂停」
//   - 数据在自己账号里，点开 gist 就能看，还有完整版本历史，写坏能回滚
//
// token 只存在浏览器 localStorage，绝不进构建产物、绝不进仓库。
// 把 PAT 推到公开仓库 / 公开 gist 会被 GitHub 自动吊销，所以这里只允许运行时粘贴。

const TOKEN_KEY = "ox5000-github-token-v1";
const GIST_KEY = "ox5000-gist-id-v1";
const FILE = "ox5000-progress.json";
const API = "https://api.github.com";

/* ---------- token（只放本机） ---------- */

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch (e) {
    return "";
  }
}

export function hasToken() {
  return Boolean(getToken());
}

export function setToken(t) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch (e) {}
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

function getCachedGistId() {
  try {
    return localStorage.getItem(GIST_KEY) || "";
  } catch (e) {
    return "";
  }
}

function setCachedGistId(id) {
  try {
    localStorage.setItem(GIST_KEY, id);
  } catch (e) {}
}

function clearCachedGistId() {
  try {
    localStorage.removeItem(GIST_KEY);
  } catch (e) {}
}

/* ---------- HTTP ---------- */

// 断网时 fetch 会挂很久，状态栏就一直停在「同步中…」，看起来像卡死
function withTimeout(promise, ms = 12000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error("同步超时，网络可能不通")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function api(token, path, init) {
  const opts = init || {};
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (opts.body) headers["Content-Type"] = "application/json";

  const res = await withTimeout(
    fetch(API + path, { method: opts.method || "GET", headers, body: opts.body }),
  );

  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try {
      const j = await res.json();
      if (j && j.message) msg = j.message;
    } catch (e) {}
    if (res.status === 401) msg = "token 无效或已被吊销";
    else if (res.status === 403) msg = "token 权限不足或触发限流";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/* ---------- 账号 ---------- */

export async function whoami(token) {
  const u = await api(token, "/user");
  return { login: u.login, name: u.name || u.login };
}

/* ---------- gist 定位 ---------- */

// 本地缓存了 gist id 就直接用；被删了就重找，找不到再新建。
// 返回值里的 created 很关键：新建出来的 gist 一定是空的，
// 那个「空」没有任何含义，不能被当成「云端说你现在什么都没掌握」。
async function resolveGist(token) {
  const cached = getCachedGistId();
  if (cached) {
    try {
      const g = await api(token, "/gists/" + cached);
      if (g && g.files && g.files[FILE]) return { gist: g, created: false };
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    clearCachedGistId();
  }

  // 在已有 gist 里找那个文件（最多翻 3 页，够用了）
  for (let page = 1; page <= 3; page++) {
    const list = await api(token, "/gists?per_page=100&page=" + page);
    if (!Array.isArray(list) || !list.length) break;
    const hit = list.find((g) => g.files && g.files[FILE]);
    if (hit) {
      setCachedGistId(hit.id);
      return { gist: await api(token, "/gists/" + hit.id), created: false };
    }
    if (list.length < 100) break;
  }

  // 一个都没有：建一个 secret gist（注意：secret 只是不公开列出，
  // 拿到 id 的人仍能读；所以别把 id 到处贴）
  const created = await api(token, "/gists", {
    method: "POST",
    body: JSON.stringify({
      description: "Oxford 5000 背单词进度（自动生成）",
      public: false,
      files: { [FILE]: { content: serialize(new Set()) } },
    }),
  });
  setCachedGistId(created.id);
  return { gist: created, created: true };
}

/* ---------- 序列化 ---------- */

function serialize(keys) {
  return JSON.stringify({
    v: 1,
    updated: new Date().toISOString(),
    keys: [...keys].sort(),
  });
}

function parse(text) {
  try {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : j && j.keys;
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}

// 单文件超过 1MB 时 API 会返回 truncated，得去 raw 地址拿全文。
// 5323 条约 90KB，正常走不到这里，留着兜底。
async function fileText(gist) {
  const f = gist.files[FILE];
  if (!f) return "";
  if (!f.truncated) return f.content || "";
  const res = await withTimeout(fetch(f.raw_url, { cache: "no-store" }));
  return res.text();
}

/* ---------- 读 / 写 ---------- */

export async function pull(token) {
  const { gist, created } = await resolveGist(token);
  const text = created ? "" : await fileText(gist);
  // 「云端什么都没有」= 这份记录还没被任何设备写过，不是「云端说你已掌握的都被清空了」。
  // 刚建出来的 gist 里躺的是 {"v":1,"keys":[]}，文本非空，光看文本会误判成
  // 「云端有内容」，然后拿它去覆盖本机攒的进度。用 created 区分，别用文本长度。
  // 注意也不能用 keys.size===0 判断：云端真的被清空（手机上全取消勾选）时
  // keys 同样是 0，那种情况必须按「云端为准」处理才能把取消同步到电脑。
  return {
    keys: parse(text),
    gistId: gist.id,
    empty: created || !text.trim(),
  };
}

function same(a, b) {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

// 写入并核对。
// 注意：gist 的 PATCH 不接受 If-Match（实测返回 400
// "Conditional request headers are not allowed in unsafe requests"），
// 没有乐观锁可用，所以这里写完再读回来核对；
// 万一另一台设备刚好也写了，就并上它的新增再重试。
export async function push(token, keys) {
  let next = new Set(keys);

  for (let attempt = 0; attempt < 3; attempt++) {
    const { gist } = await resolveGist(token);
    await api(token, "/gists/" + gist.id, {
      method: "PATCH",
      body: JSON.stringify({ files: { [FILE]: { content: serialize(next) } } }),
    });

    const back = parse(await fileText(await api(token, "/gists/" + gist.id)));
    if (same(back, next)) {
      setCachedGistId(gist.id);
      return next;
    }
    // 别人在我们写入的间隙也推了一份，把它的新增并进来再写一次
    next = new Set([...next, ...back]);
  }
  throw new Error("同步冲突，请稍后再试");
}

// 让用户能在页面上直接点开自己的那份记录
export function gistUrl(id) {
  return id ? "https://gist.github.com/" + id : "";
}

export function cachedGistId() {
  return getCachedGistId();
}

export { FILE as GIST_FILE };
