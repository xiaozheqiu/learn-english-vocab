/**
 * 顽固词页（§5 F7）
 *
 * 累计忘记 ≥8 次的词被移出主复习队列，集中在这里。
 *
 * 设计取舍：
 * - 按忘记次数从多到少排，最该处理的排最前。
 * - 每条都能「重新学」，点了就清 lapse、立刻回主队列 —— 这是唯一的出口，
 *   不做「永久删除」：词表里本来就能标记已掌握，两个入口重叠会让语义混乱。
 * - 显示「还剩几天回归」而不是一个日期：用户关心的不是 30 天后的某一天，
 *   而是「它什么时候会突然出现在复习里」。
 */
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PageProps } from "@/components/contracts";
import { listLeeches, leechSeverity } from "@/lib/leech";
import { isMobile, transUrl } from "@/lib/trans";
import { cn } from "@/lib/utils";

const SEVERITY_LABEL = {
  medium: { text: "中度", variant: "due" as const },
  high: { text: "顽固", variant: "danger" as const },
  severe: { text: "极顽固", variant: "danger" as const },
};

export function LeechPage({ store, onExit }: PageProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<readonly string[]>([]);

  const items = useMemo(
    () => listLeeches(store.words, store.records),
    [store.words, store.records],
  );

  const relearn = async (key: string) => {
    setBusy(key);
    try {
      await store.relearnLeech(key);
      setDone((current) => [...current, key]);
    } finally {
      setBusy(null);
    }
  };

  if (store.loadingWords) {
    return (
      <div className="mx-auto w-full max-w-[560px] px-4 py-10 text-center text-[13px] text-ink-mute">
        正在准备词表…
      </div>
    );
  }

  return (
    <div data-testid="leech-page" className="mx-auto w-full max-w-[560px] px-4 pb-10 pt-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-semibold leading-[1.3] text-ink">顽固词</h1>
          <p className="mt-1 text-[12px] leading-5 text-ink-mute">
            累计忘记 8 次以上的词，已移出主复习队列。想再试一次就点「重新学」。
          </p>
        </div>
        <Button size="sm" variant="ghost" className="h-11 shrink-0 px-2.5" onClick={onExit}>
          退出
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="mt-8 rounded-card border border-line bg-card px-4 py-8 text-center">
          <p className="text-[14px] text-ink">还没有顽固词</p>
          <p className="mt-1 text-[12px] text-ink-mute">
            这说明当前节奏合适。等真有词反复记不住时，它们会自动出现在这里。
          </p>
          <Button size="sm" className="mt-4" onClick={onExit}>
            回词表
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between text-[12px] text-ink-mute tnum">
            <span>共 {items.length} 个</span>
            <span>忘记最多 {items[0]?.lapses ?? 0} 次</span>
          </div>

          <ul className="mt-2 space-y-2">
            {items.map((item) => {
              const severity = leechSeverity(item.lapses);
              const label = SEVERITY_LABEL[severity];
              const justDone = done.includes(item.word.key);
              return (
                <li
                  key={item.word.key}
                  data-key={item.word.key}
                  className={cn(
                    "rounded-card border border-line bg-card px-3 py-2.5",
                    justDone && "opacity-50",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <a
                        href={transUrl(item.word.word)}
                        target={isMobile ? undefined : "_blank"}
                        rel="noopener noreferrer"
                        className="word-serif block truncate text-[17px] font-semibold text-ink underline-offset-4 hover:underline"
                      >
                        {item.word.word}
                      </a>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-soft">
                        {item.word.pos} {item.word.cn}
                      </span>
                    </span>
                    <Badge variant={label.variant}>{label.text}</Badge>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-ink-mute tnum">
                      忘记 {item.lapses} 次 ·{" "}
                      {item.shelved ? `${item.daysUntilReturn} 天后自动回归` : "下一轮复习会出现"}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 gap-1"
                      disabled={busy === item.word.key || justDone}
                      onClick={() => void relearn(item.word.key)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      {justDone ? "已重置" : "重新学"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-[12px] leading-5 text-ink-mute">
            「重新学」只清空忘记次数、让它立刻回到队列，不会清掉它的记忆强度 ——
            这个词对你有多难这条信息会保留下来。
          </p>
        </>
      )}
    </div>
  );
}
