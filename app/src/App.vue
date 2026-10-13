<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ALL,
  LEVELS,
  SIZES,
  loadLevel,
  loadAll,
  needOf,
} from "./lib/data.js";
import {
  loadLocal,
  saveLocal,
  markDirty,
  syncOnLogin,
  syncChanges,
  restoreSession,
  signOut,
} from "./lib/sync.js";
import { supabase, supabaseReady } from "./lib/supabase.js";
import LoginScreen from "./components/LoginScreen.vue";
import Pager from "./components/Pager.vue";
import WordTable from "./components/WordTable.vue";

const VKEY = "ox5000-view-v1";

/* ---------- 视图状态（sessionStorage 里恢复上次位置） ---------- */
let vs = {};
try {
  vs = JSON.parse(sessionStorage.getItem(VKEY) || "{}");
} catch (e) {}

const lv = ref(ALL.includes(vs.lv) ? vs.lv : "A1");
const mode = ref(["all", "todo", "done"].includes(vs.mode) ? vs.mode : "all");
const kw = ref(typeof vs.kw === "string" ? vs.kw : "");
const page = ref(vs.page > 0 ? Math.floor(vs.page) : 1);
const size = ref(SIZES.includes(vs.size) ? vs.size : 20);

function saveView() {
  try {
    sessionStorage.setItem(
      VKEY,
      JSON.stringify({
        lv: lv.value,
        mode: mode.value,
        kw: kw.value,
        page: page.value,
        size: size.value,
      }),
    );
  } catch (e) {}
}

/* ---------- 数据 ---------- */
const STORE = ref({}); // { A1: [...], ... }
// 初始不显示加载条：登录前不发数据请求，登录后由 bootData() 接管
const loading = ref(false);
const loadingMsg = ref("正在加载词表…");
const loadPct = ref(0);
const loadErr = ref("");

function loadedLevels() {
  return Object.keys(STORE.value);
}

async function ensure(target) {
  const todo = needOf(target).filter((x) => !STORE.value[x]);
  if (!todo.length) return;
  loading.value = true;
  loadingMsg.value = "正在加载词表…";
  loadPct.value = 0;
  let n = 0;
  await Promise.all(
    todo.map(async (x) => {
      const rows = await loadLevel(x);
      STORE.value = { ...STORE.value, [x]: rows };
      loadPct.value = Math.round((++n / todo.length) * 100);
    }),
  );
  loading.value = false;
}

/* ---------- 进度（勾选） ---------- */
const done = ref(loadLocal());
let prevDone = new Set(done.value);

function persist() {
  saveLocal(done.value);
  markDirty();
  scheduleSync();
}

/* ---------- 同步 ---------- */
const user = ref(null); // 没登录时为 null；模板据此决定是否放行
const authChecked = ref(false); // 是否已经判定过登录态
const syncState = ref("idle"); // idle | syncing | ok | error
const syncErr = ref("");
const lastSync = ref(null);
let syncTimer = null;
let dataBooted = false;

function fmtTime(t) {
  if (!t) return "";
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function scheduleSync() {
  if (!supabase || !user.value) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, 1200);
}

async function doSync() {
  if (!supabase || !user.value) return;
  syncState.value = "syncing";
  syncErr.value = "";
  try {
    const before = new Set(prevDone);
    await syncChanges(user.value.id, done.value, before);
    prevDone = new Set(done.value);
    syncState.value = "ok";
    lastSync.value = Date.now();
  } catch (e) {
    syncState.value = "error";
    syncErr.value = e.message || String(e);
  }
}

// 登录后 / 从后台切回来时做一次全量对齐：
// 本机没有未同步的改动 → 以云端为准，别的设备上的「取消勾选」也能带过来；
// 本机有未同步的改动   → 取并集再推上去，绝不丢掉刚勾的进度。
async function reconcile() {
  if (!supabase || !user.value) return;
  syncState.value = "syncing";
  syncErr.value = "";
  try {
    const merged = await syncOnLogin(user.value.id);
    done.value = merged;
    prevDone = new Set(merged);
    saveLocal(merged);
    syncState.value = "ok";
    lastSync.value = Date.now();
  } catch (e) {
    syncState.value = "error";
    syncErr.value = e.message || String(e);
  }
}

/* ---------- 筛选 ---------- */
const levelSet = computed(() => {
  let a = [];
  for (const L of needOf(lv.value)) if (STORE.value[L]) a = a.concat(STORE.value[L]);
  return a;
});

const baseSet = computed(() => {
  if (!kw.value) return levelSet.value;
  let a = [];
  for (const L of LEVELS) if (STORE.value[L]) a = a.concat(STORE.value[L]);
  return a;
});

const filtered = computed(() => {
  let a = baseSet.value;
  const k = kw.value.trim().toLowerCase();
  if (k) {
    a = a.filter(
      (d) => d.w.toLowerCase().includes(k) || (d.cn || "").toLowerCase().includes(k),
    );
  }
  if (mode.value === "todo") a = a.filter((d) => !done.value.has(d._k));
  if (mode.value === "done") a = a.filter((d) => done.value.has(d._k));
  return a;
});

const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)));
const slice = computed(() => {
  const p = Math.min(page.value, pages.value);
  return filtered.value.slice((p - 1) * size.value, p * size.value);
});

// 页码越界时收敛并落盘
watch([pages, page], () => {
  if (page.value > pages.value) page.value = pages.value;
});

const statDone = computed(() => levelSet.value.filter((d) => done.value.has(d._k)).length);
const statPct = computed(() =>
  levelSet.value.length ? (statDone.value / levelSet.value.length) * 100 : 0,
);
const pageAllDone = computed(
  () => slice.value.length > 0 && slice.value.every((d) => done.value.has(d._k)),
);

// 任何视图变化都记一份，从百度翻译按返回键回来能停在原处
watch([lv, mode, kw, page, size], saveView);

/* ---------- 交互 ---------- */
async function pickLevel(l) {
  if (lv.value === l) return;
  lv.value = l;
  page.value = 1;
  await ensure(l);
}

async function onSearch(e) {
  kw.value = e.target.value.trim();
  page.value = 1;
  if (kw.value && needOf("ALL").some((x) => !STORE.value[x])) {
    loadingMsg.value = "正在加载全部等级的词表以便搜索…";
    loading.value = true;
    try {
      STORE.value = { ...STORE.value, ...(await loadAll()) };
    } catch (err) {
      loadErr.value = "加载全部等级失败：" + (err.message || err);
    }
    loading.value = false;
  }
}

function pickMode(m) {
  mode.value = m;
  page.value = 1;
}

function toggle(k) {
  if (done.value.has(k)) done.value.delete(k);
  else done.value.add(k);
  // Set 是可变对象，换个引用触发响应式
  done.value = new Set(done.value);
  persist();
}

function selectPage() {
  const rows = slice.value;
  if (!rows.length) return;
  const all = rows.every((d) => done.value.has(d._k));
  for (const d of rows) {
    if (all) done.value.delete(d._k);
    else done.value.add(d._k);
  }
  done.value = new Set(done.value);
  persist();
  toTop();
}

function toTop() {
  document.getElementById("list")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

/* ---------- 启动 ---------- */
let unsub = null;

// 词表数据只在登录后才加载：没登录连数据请求都不发出去
async function bootData() {
  if (dataBooted) return;
  dataBooted = true;
  loading.value = true;
  try {
    await ensure(kw.value ? "ALL" : lv.value);
    loadErr.value = "";
  } catch (e) {
    loadErr.value = "加载失败：" + (e.message || e);
    dataBooted = false;
  }
  loading.value = false;
}

async function onAuthed(u) {
  user.value = u;
  if (!u) return;
  // 顺序很重要：词表数据是随包发布的本地产物，先渲染出来。
  // 反过来先 await 同步的话，断网时那个请求会一直重试，
  // 用户就只能对着空列表停在「同步中…」。
  await bootData();
  // 再跟云端对齐；失败只影响进度同步，不影响继续浏览。
  await reconcile();
}

async function logout() {
  await signOut();
  user.value = null;
  syncState.value = "idle";
  syncErr.value = "";
  lastSync.value = null;
}

onMounted(async () => {
  // 老版 iOS Safari 忽略 user-scalable=no，用 gesture 再兜一层
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) => {
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  });

  // 没有配置 Supabase：连登录都没法做，直接停在说明页，不发任何数据请求
  if (!supabase) {
    loading.value = false;
    authChecked.value = true;
    return;
  }

  // 先看本机有没有已存在的会话（刷新页面、PWA 重开、断网都走这里）。
  // 不校验 token 有效性：那需要联网，断网时会把已登录的人挡在门外。
  // 会话真失效时，下面第一次同步会报错，状态栏会显示"同步失败"。
  const u = await restoreSession();
  authChecked.value = true;
  if (u) await onAuthed(u);

  const { data } = supabase.auth.onAuthStateChange(async (_evt, session) => {
    await onAuthed(session ? session.user : null);
  });
  unsub = () => data.subscription.unsubscribe();

  // 从别的设备同步过来的进度：回到前台时对齐一次（拉取 + 推送）
  document.addEventListener("visibilitychange", onVisible);
});

function onVisible() {
  if (document.visibilityState !== "visible") return;
  // 待发的推送会被这次对齐覆盖掉，先撤掉，避免两个请求互相打架
  clearTimeout(syncTimer);
  reconcile();
}

onUnmounted(() => {
  if (unsub) unsub();
  document.removeEventListener("visibilitychange", onVisible);
  clearTimeout(syncTimer);
});
</script>

<template>
  <div id="loadbar" :class="{ off: !loading }" :style="{ width: loadPct + '%' }"></div>

  <!-- 还没判定完登录态：先给一个中性占位，避免登录页闪一下 -->
  <div v-if="!authChecked && supabase" class="wrap">
    <div class="empty">正在检查登录状态…</div>
  </div>

  <!-- 没登录（或没配数据库）：只给登录页，词表一个字都不渲染 -->
  <LoginScreen
    v-else-if="!user"
    :ready="supabaseReady"
    @signed-in="onAuthed"
  />

  <div v-else class="wrap">
    <div class="topbar">
      <span class="who">{{ user.email }}</span>
      <span class="sstat" :class="syncState">
        <template v-if="syncState === 'syncing'">同步中…</template>
        <template v-else-if="syncState === 'error'">同步失败</template>
        <template v-else-if="lastSync">已同步 {{ fmtTime(lastSync) }}</template>
        <template v-else>已登录</template>
      </span>
      <button class="obtn" @click="logout">退出</button>
    </div>
    <div v-if="syncErr" class="serr">{{ syncErr }}</div>

    <div class="bar">
      <div class="tabs" id="tabs">
        <button
          v-for="l in ALL"
          :key="l"
          class="tab"
          :class="{ on: l === lv }"
          @click="pickLevel(l)"
        >
          {{ l === "ALL" ? "全部" : l }}<i class="dot"></i>
        </button>
      </div>
      <div class="row2">
        <input
          type="search"
          id="q"
          placeholder="搜索单词或中文释义…"
          :value="kw"
          @input="onSearch"
        />
        <button class="btn" :class="{ on: mode === 'all' }" @click="pickMode('all')">全部</button>
        <button class="btn" :class="{ on: mode === 'todo' }" @click="pickMode('todo')">
          未掌握
        </button>
        <button class="btn" :class="{ on: mode === 'done' }" @click="pickMode('done')">
          已掌握
        </button>
        <span class="stat" id="stat">已掌握 {{ statDone }} / {{ levelSet.length }}</span>
      </div>
      <div class="bar2"><i id="prog" :style="{ width: statPct + '%' }"></i></div>
    </div>

    <!-- 登录状态与同步状态现在移到顶部一行，见上面的 .topbar -->

    <div id="list">
      <div v-if="loadErr" class="empty">{{ loadErr }}</div>
      <div v-else-if="loading" class="empty">{{ loadingMsg }}</div>
      <div v-else-if="!filtered.length" class="empty">没有匹配的词</div>
      <WordTable
        v-else
        :rows="slice"
        :done="done"
        :start="(Math.min(page, pages) - 1) * size"
        @toggle="toggle"
      />
    </div>

    <Pager
      v-if="!loading && !loadErr && filtered.length"
      :page="Math.min(page, pages)"
      :pages="pages"
      :size="size"
      :total="filtered.length"
      :row-count="slice.length"
      :all-done="pageAllDone"
      @update:page="(p) => (page = p)"
      @update:size="
        (s) => {
          size = s;
          page = 1;
        }
      "
      @select-page="selectPage"
      @nav="toTop"
    />
  </div>
</template>
