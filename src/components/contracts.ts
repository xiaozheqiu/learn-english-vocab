/**
 * 跨组件的公共 props 契约（§6）。
 * 各组件只通过这个文件声明的形状拿到状态，避免互相耦合到 internals。
 */
import type { VocabStore } from "@/hooks/useVocabStore";
import type { PwaUpdate } from "@/hooks/usePwaUpdate";

export interface FloatingPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: VocabStore;
  canInstall: boolean;
  onInstall: () => void;
  /** 关于页的词性对照表入口 */
  onOpenGuide: () => void;
  /** 设置页的版本检查入口 */
  update: PwaUpdate;
  /** 密码登录；返回错误文案，成功返回 null。未配置 Supabase 时组件不渲染这块 */
  onLogin: (password: string) => Promise<string | null>;
  onSignOut: () => void;
}

export type { VocabStore };
