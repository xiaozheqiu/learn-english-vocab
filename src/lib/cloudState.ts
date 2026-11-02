/**
 * 云端同步状态。
 *
 * 单独一个文件，是为了让 AboutSection / useVocabStore 能只引用类型而不碰上
 * supabase-js —— 类型在编译后会被抹掉，不会把任何运行时依赖拖进首屏。
 */
export type CloudState = "disabled" | "signedOut" | "syncing" | "synced" | "error";
