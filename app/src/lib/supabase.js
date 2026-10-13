// Supabase 客户端。没配置环境变量时返回 null，App 会自动降级为「仅本机」模式。
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseReady = Boolean(url && anonKey);

export const supabase = supabaseReady
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // 单用户场景：同一个浏览器只保留一个会话
        storageKey: "ox5000-auth",
      },
    })
  : null;
