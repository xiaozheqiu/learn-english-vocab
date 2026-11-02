import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface CloudLoginProps {
  /** 密码登录；返回错误文案，成功返回 null。成功后由上层刷新 store 状态 */
  onSubmit: (password: string) => Promise<string | null>;
}

/**
 * 密码框（云端同步用）。
 *
 * 全站只有一个用户，账号固定，所以邮箱不该出现在界面上 —— 让唯一的用户
 * 每次登录都打一遍自己的邮箱，是把「多用户注册体系」的复杂度摊到一个
 * 只有一个账号的应用上。账号由 `VITE_CLOUD_EMAIL` 注入，见 cloudClient.ts。
 *
 * 只在「已配置 Supabase 且未登录」时出现，收起状态只是一个按钮 ——
 * 绝大多数打开根本不会用到它，不该占常驻空间。
 *
 * 错误文案原样透出 Supabase 的返回（"Invalid login credentials" 这类），
 * 不包装成中文泛化提示：这句话能直接告诉用户是密码错了。
 */
export function CloudLogin({ onSubmit }: CloudLoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const message = await onSubmit(password).catch((e) => String(e));
    setBusy(false);
    if (message) setError(message);
    else setPassword("");
  };

  return (
    <form className="mt-1.5 space-y-1.5" onSubmit={submit} data-testid="cloud-login-form">
      <Input
        type="password"
        autoComplete="current-password"
        placeholder="密码"
        aria-label="密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        data-testid="cloud-password"
        required
      />
      <Button
        type="submit"
        variant="outline"
        size="touch"
        className="w-full"
        disabled={busy}
        data-testid="cloud-login-submit"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogIn className="h-4 w-4" aria-hidden="true" />
        )}
        {busy ? "正在登录…" : "登录"}
      </Button>
      {error && (
        <p className="text-[12px] leading-5 text-due" role="alert" data-testid="cloud-login-error">
          {error}
        </p>
      )}
    </form>
  );
}
