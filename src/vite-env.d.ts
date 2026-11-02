/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/**
 * 构建时注入的标识（定义在 vite.config.js 的 define 里）。
 * 用途：让「关于」页能回答「手机上这个到底是不是最新版」。
 */
declare const __APP_VERSION__: string;
/** CI 里是 GITHUB_SHA 前 7 位，本地构建是 "dev" */
declare const __BUILD_SHA__: string;
/** 构建时刻，UTC ISO 字符串 */
declare const __BUILD_TIME__: string;
/** 版本 + 提交 + 依赖内容的短哈希，同一次提交重复构建稳定 */
declare const __BUILD_FINGERPRINT__: string;

/**
 * 云端同步（Supabase）。两个都没配时整块功能静默停用，
 * 应用退化成纯本地 —— 本地开发、e2e、首次 clone 都是这个状态。
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** 唯一的账号邮箱。全站只有一个用户，所以写进构建，界面上不再让人输 */
  readonly VITE_CLOUD_EMAIL?: string;
}
