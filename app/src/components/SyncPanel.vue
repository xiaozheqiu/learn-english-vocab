<script setup>
import { ref, computed } from "vue";
import { connect, disconnect, cachedGistId, gistUrl } from "../lib/sync.js";

const props = defineProps({
  login: { type: String, default: "" },
  syncState: { type: String, default: "idle" }, // idle | syncing | ok | error
  syncErr: { type: String, default: "" },
  lastSync: { type: Number, default: null },
});

const emit = defineEmits(["connected", "disconnected"]);

const open = ref(false);
const token = ref("");
const busy = ref(false);
const err = ref("");
const showSteps = ref(false);

const connected = computed(() => Boolean(props.login));

const statusText = computed(() => {
  if (!connected.value) return "未同步";
  if (props.syncState === "syncing") return "同步中…";
  if (props.syncState === "error") return "同步失败";
  if (props.lastSync) {
    const d = new Date(props.lastSync);
    const p = (n) => String(n).padStart(2, "0");
    return `已同步 ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return "已连接";
});

async function submit() {
  busy.value = true;
  err.value = "";
  try {
    const me = await connect(token.value);
    token.value = "";
    open.value = false;
    emit("connected", me);
  } catch (ex) {
    const m = ex && ex.message ? ex.message : String(ex);
    if (/bad credentials|401/i.test(m)) err.value = "token 不对，检查一下有没有复制全";
    else if (/not found|404/i.test(m)) err.value = "连不上 GitHub，检查一下网络";
    else err.value = m;
  }
  busy.value = false;
}

function doDisconnect() {
  disconnect();
  open.value = false;
  emit("disconnected");
}
</script>

<template>
  <div class="sbar">
    <button class="stoggle" :class="{ on: connected }" @click="open = !open">
      <span class="sdot" :class="syncState"></span>
      {{ statusText }}
    </button>

    <!-- 展开后的面板：不连接也能正常用，这里只是可选的同步设置 -->
    <div v-if="open" class="spanel">
      <template v-if="connected">
        <div class="srow">
          <span class="slabel">已连接</span>
          <span class="sval">{{ login }}</span>
        </div>
        <div v-if="syncErr" class="serr">{{ syncErr }}</div>
        <div class="shint">
          进度存在你自己 GitHub 账号的一个 gist 里，其他设备粘同一个 token 就能同步。
        </div>
        <div class="sacts">
          <a
            v-if="cachedGistId()"
            class="slink"
            :href="gistUrl(cachedGistId())"
            target="_blank"
            rel="noopener"
            >查看我的记录</a
          >
          <button class="sbtn ghost" @click="doDisconnect">断开</button>
        </div>
        <div class="shint tiny">断开只会清掉本机的 token，勾选进度保留。</div>
      </template>

      <template v-else>
        <div class="snote">
          不连接也能正常用，勾选会存在本机浏览器里。连接之后可以在手机和电脑之间同步。
        </div>
        <form class="sform" @submit.prevent="submit">
          <label class="sfield">
            <span>GitHub token</span>
            <input
              v-model="token"
              type="password"
              autocomplete="off"
              spellcheck="false"
              placeholder="ghp_… 或 github_pat_…"
              :disabled="busy"
            />
          </label>
          <button class="sbtn" type="submit" :disabled="busy">
            {{ busy ? "验证中…" : "连接" }}
          </button>
        </form>
        <div v-if="err" class="serr">{{ err }}</div>

        <button class="smore" @click="showSteps = !showSteps">
          {{ showSteps ? "收起步骤" : "怎么拿到 token？" }}
        </button>
        <ol v-if="showSteps" class="ssteps">
          <li>
            打开
            <a
              href="https://github.com/settings/tokens/new?scopes=gist&description=Oxford%205000%20%E8%83%8C%E5%8D%95%E8%AF%8D"
              target="_blank"
              rel="noopener"
              >创建 token</a
            >
            页（已帮你勾好 <code>gist</code>）
          </li>
          <li>
            <b>把其它权限全部取消</b>，只留 <code>gist</code>
            ——这样即使 token 泄露，别人也只能动你的 gist
          </li>
          <li>选 Classic token（不要 Fine-grained，后者对 gist 支持不全）</li>
          <li>生成后复制，粘到上面的输入框</li>
        </ol>
        <div class="shint tiny">
          token 只存在这台设备的浏览器里，不会进代码，也不会上传。
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sbar {
  position: relative;
}
.stoggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--sub);
  cursor: pointer;
}
.stoggle.on {
  color: var(--txt);
}
.sdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c9c7c0;
}
.sdot.ok {
  background: var(--ok);
}
.sdot.syncing {
  background: #d9a441;
}
.sdot.error {
  background: #c0392b;
}

.spanel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  width: 310px;
  max-width: calc(100vw - 36px);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.1);
}
.snote {
  background: #fdf6e3;
  border: 1px solid #e8d9a8;
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 12px;
  line-height: 1.7;
  color: #6b5a1e;
  margin-bottom: 12px;
}
.sform {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.sfield {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--sub);
}
.sfield input {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 10px;
  font-size: 16px; /* 移动端 ≥16px，聚焦时才不会自动放大 */
  background: #fff;
  color: var(--txt);
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.sfield input:focus {
  outline: none;
  border-color: var(--ok);
}
.sbtn {
  padding: 9px;
  border: none;
  border-radius: 8px;
  background: var(--ok);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.sbtn:disabled {
  opacity: 0.6;
  cursor: default;
}
.sbtn.ghost {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--sub);
  padding: 6px 12px;
  font-size: 12px;
}
.serr {
  color: #c0392b;
  font-size: 12px;
  margin-top: 8px;
  line-height: 1.6;
}
.shint {
  color: var(--sub);
  font-size: 11.5px;
  line-height: 1.7;
  margin-top: 10px;
}
.shint.tiny {
  font-size: 11px;
  color: #b4b2a9;
}
.smore {
  margin-top: 10px;
  background: none;
  border: none;
  padding: 0;
  color: var(--link);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.ssteps {
  margin: 8px 0 0;
  padding-left: 17px;
  font-size: 12px;
  line-height: 1.85;
  color: var(--txt);
}
.ssteps code {
  background: #f1efe8;
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 11px;
}
.ssteps a {
  color: var(--link);
}
.srow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}
.slabel {
  color: var(--sub);
  font-size: 12px;
}
.sval {
  font-weight: 500;
  word-break: break-all;
}
.sacts {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
}
.slink {
  color: var(--link);
  font-size: 12.5px;
}
</style>
