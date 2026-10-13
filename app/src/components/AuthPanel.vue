<script setup>
import { ref } from "vue";
import { signIn, signOut } from "../lib/sync.js";

const props = defineProps({
  user: { type: Object, default: null },
  syncState: { type: String, default: "idle" },
  syncErr: { type: String, default: "" },
  lastSync: { type: Number, default: null },
});
const emit = defineEmits(["signed-in"]);

const open = ref(false);
const email = ref("");
const password = ref("");
const busy = ref(false);
const err = ref("");

async function submit() {
  if (!email.value || !password.value) {
    err.value = "请填写邮箱和密码";
    return;
  }
  busy.value = true;
  err.value = "";
  try {
    await signIn(email.value.trim(), password.value);
    open.value = false;
    password.value = "";
  } catch (e) {
    err.value = e.message || String(e);
  }
  busy.value = false;
}

async function out() {
  busy.value = true;
  await signOut();
  emit("signed-in", null);
  busy.value = false;
}

function fmt(t) {
  if (!t) return "";
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
</script>

<template>
  <div class="auth">
    <template v-if="!user">
      <button class="abtn" @click="open = !open">
        {{ open ? "收起" : "登录以同步进度" }}
      </button>
      <form v-if="open" class="af" @submit.prevent="submit">
        <input v-model="email" type="email" placeholder="邮箱" autocomplete="username" />
        <input
          v-model="password"
          type="password"
          placeholder="密码"
          autocomplete="current-password"
        />
        <button class="abtn primary" type="submit" :disabled="busy">
          {{ busy ? "登录中…" : "登录" }}
        </button>
        <div v-if="err" class="aerr">{{ err }}</div>
        <div class="ahint">没有账号？在 Supabase 后台先建一个即可，这是自己用的。</div>
      </form>
    </template>

    <template v-else>
      <span class="awho">{{ user.email }}</span>
      <span class="astat" :class="syncState">
        <template v-if="syncState === 'syncing'">同步中…</template>
        <template v-else-if="syncState === 'error'">同步失败</template>
        <template v-else-if="lastSync">已同步 {{ fmt(lastSync) }}</template>
        <template v-else>已登录</template>
      </span>
      <button class="abtn small" :disabled="busy" @click="out">退出</button>
      <div v-if="syncErr" class="aerr">{{ syncErr }}</div>
    </template>
  </div>
</template>

<style scoped>
.auth {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 10px 0 4px;
  font-size: 12px;
  color: var(--sub);
}
.abtn {
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--txt);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}
.abtn.primary {
  background: var(--ok);
  border-color: var(--ok);
  color: #fff;
}
.abtn.small {
  padding: 3px 8px;
}
.abtn:disabled {
  opacity: 0.6;
  cursor: default;
}
.af {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  flex: 1 1 100%;
}
.af input {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  min-width: 0;
  flex: 1 1 140px;
}
.awho {
  color: var(--txt);
  word-break: break-all;
}
.astat.ok {
  color: var(--ok);
}
.astat.error,
.aerr {
  color: #c0392b;
}
.ahint {
  flex: 1 1 100%;
  color: #b4b2a9;
}
</style>
