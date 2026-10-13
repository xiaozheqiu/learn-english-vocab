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
  currentUser,
  signedIn,
} from "./lib/sync.js";
import { supabase, supabaseReady } from "./lib/supabase.js";
import AuthPanel from "./components/AuthPanel.vue";
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
const loading = ref(true);
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
const user = ref(null);
const syncState = ref("idle"); // idle | syncing | ok | error
const syncErr = ref("");
const lastSync = ref(null);
let syncTimer = null;

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

async function onAuthed(u) {
  user.value = u;
  if (!u) return;
  await reconcile();
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
onMounted(async () => {
  // 老版 iOS Safari 忽略 user-scalable=no，用 gesture 再兜一层
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) => {
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  });

  try {
    await ensure(kw.value ? "ALL" : lv.value);
  } catch (e) {
    loadErr.value = "加载失败：" + (e.message || e);
    loading.value = false;
    return;
  }

  if (signedIn()) {
    await onAuthed(await currentUser());
    const { data } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      await onAuthed(session ? session.user : null);
    });
    unsub = () => data.subscription.unsubscribe();
  }

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
  <div class="wrap">
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

    <!-- 没配置 Supabase 时整块不出现，页面退化成纯本机版 -->
    <AuthPanel
      v-if="supabaseReady"
      :user="user"
      :sync-state="syncState"
      :sync-err="syncErr"
      :last-sync="lastSync"
      @signed-in="onAuthed"
    />

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
