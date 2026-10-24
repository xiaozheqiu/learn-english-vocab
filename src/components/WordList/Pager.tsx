import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PagerProps {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}

/**
 * 分页器（§2.2）：‹ 12 / 267 › （5323）。
 *
 * 每页条数不在这里放第二遍 —— 它属于筛选条件，已经在筛选抽屉里；
 * 同一个设置出现在两处只会让人怀疑哪个生效。
 */
export function Pager({ page, pages, total, onPage }: PagerProps) {
  const go = (next: number) => {
    const target = Math.min(Math.max(1, Math.round(next) || 1), Math.max(1, pages));
    if (target !== page) onPage(target);
  };

  return (
    <nav
      className="mt-3 flex items-center justify-center gap-2 px-3 pb-2 text-[13px] text-ink-soft"
      aria-label="分页"
    >
      <Button
        variant="outline"
        size="icon"
        className="h-11 w-11"
        aria-label="上一页"
        disabled={page <= 1}
        onClick={() => go(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>

      <label className="sr-only" htmlFor="page-jump">
        跳到页码
      </label>
      <Input
        id="page-jump"
        type="number"
        inputMode="numeric"
        min={1}
        max={Math.max(1, pages)}
        value={page}
        onChange={(event) => go(Number(event.target.value))}
        className="h-11 w-14 px-1 text-center"
      />
      <span className="tnum text-ink-mute">/ {pages}</span>

      <Button
        variant="outline"
        size="icon"
        className="h-11 w-11"
        aria-label="下一页"
        disabled={page >= pages}
        onClick={() => go(page + 1)}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      <span className="tnum text-ink-mute">（{total}）</span>
    </nav>
  );
}
