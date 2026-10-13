<script setup>
import { ref } from "vue";
import { signIn } from "../lib/sync.js";

const props = defineProps({
  // Supabase 环境变量是否已注入；没注入时只显示配置说明
  ready: { type: Boolean, default: false },
});

const emit = defineEmits(["signed-in"]);

const email = ref("");
const password = ref("");
const busy = ref(false);
const err = ref("");

async function submit() {
  const e = email.value.trim();
  if (!e || !password.value) {
    err.value = "请填写邮箱和密码";
    return;
  }
  busy.value = true;
  err.value = "";
  try {
    const user = await signIn(e, password.value);
    password.value = "";
    emit("signed-in", user);
  } catch (ex) {
    const m = ex && ex.message ? ex.message : String(ex);
    // Supabase 的原文是英文，这里翻一下最常见的两种
    if (/invalid login credentials/i.test(m)) err.value = "邮箱或密码不对";
    else if (/email not confirmed/i.test(m)) err.value = "这个邮箱还没确认，去 Supabase 后台确认一下";
    else if (/failed to fetch|networkerror|load failed/i.test(m)) err.value = "连不上服务器，检查一下网络";
    else err.value = m;
  }
  busy.value = false;
}
</script>

<template>
  <div class="gate">
    <div class="gcard">
      <h1>Oxford 5000 词汇表</h1>
      <p class="gsub">共 5323 条 · 分级 A1–C1 · 登录后进度多端同步</p>

      <!-- 环境变量没注入：给出配置步骤，因为编译时就写死了，改完必须重新部署 -->
      <template v-if="!ready">
        <div class="gnote">
          这个站点还没接上数据库，所以暂时进不去。需要先在 Supabase 建一个项目，
          然后把地址和 anon key 配到仓库里。
        </div>
        <ol class="gsteps">
          <li>
            在 <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>
            新建一个免费项目
          </li>
          <li>打开 SQL Editor，把 <code>app/supabase/schema.sql</code> 整段粘进去执行</li>
          <li>
            Authentication → Users → Add user，建一个你自己的邮箱账号
            <span class="ghi">（页面上没有注册入口，就是自己用的）</span>
          </li>
          <li>
            Settings → API 里复制 <code>Project URL</code> 和 <code>anon</code> key，
            存到仓库的 Actions secrets：<code>VITE_SUPABASE_URL</code>、
            <code>VITE_SUPABASE_ANON_KEY</code>
          </li>
          <li>重新跑一次部署（这两个值是编译进产物的，光刷新页面不生效）</li>
        </ol>
      </template>

      <!-- 已配置：登录表单 -->
      <form v-else class="gform" @submit.prevent="submit">
        <label class="gfield">
          <span>邮箱</span>
          <input
            v-model="email"
            type="email"
            autocomplete="username"
            inputmode="email"
            placeholder="you@example.com"
            :disabled="busy"
          />
        </label>
        <label class="gfield">
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            :disabled="busy"
          />
        </label>
        <button class="gbtn" type="submit" :disabled="busy">
          {{ busy ? "登录中…" : "登录" }}
        </button>
        <div v-if="err" class="gerr">{{ err }}</div>
        <div class="ghint">账号在 Supabase 后台手工建，页面上不提供注册。</div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.gate {
  min-height: 62vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 0;
}
.gcard {
  width: 100%;
  max-width: 430px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 24px 22px 20px;
}
.gcard h1 {
  font-size: 20px;
  margin: 0 0 4px;
}
.gsub {
  margin: 0 0 18px;
  color: var(--sub);
  font-size: 12px;
}
.gform {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gfield {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--sub);
}
.gfield input {
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 10px 11px;
  font-size: 16px; /* 移动端 ≥16px 才不会聚焦时自动放大 */
  background: #fff;
  color: var(--txt);
  width: 100%;
}
.gfield input:focus {
  outline: none;
  border-color: var(--ok);
}
.gbtn {
  margin-top: 2px;
  padding: 11px;
  border: none;
  border-radius: 9px;
  background: var(--ok);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}
.gbtn:disabled {
  opacity: 0.65;
  cursor: default;
}
.gerr {
  color: #c0392b;
  font-size: 12px;
}
.ghint {
  color: #b4b2a9;
  font-size: 11px;
  line-height: 1.6;
}
.gnote {
  background: #fdf6e3;
  border: 1px solid #e8d9a8;
  border-radius: 9px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.7;
  color: #6b5a1e;
  margin-bottom: 14px;
}
.gsteps {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--txt);
}
.gsteps code {
  background: #f1efe8;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 11.5px;
  word-break: break-all;
}
.ghi {
  color: var(--sub);
}
.gsteps a {
  color: var(--link);
}
</style>
