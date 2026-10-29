import { useEffect, useState } from "react";
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

  /*
   * 页码输入框用本地草稿，失焦或回车才提交。
   *
   * 之前直接受控于 `page` 并在 onChange 里 go()：输入「3」的第一个字符是 3，
   * go(3) 把页码改成 3，组件重渲染后 value 又被约束回 3，
   * 但用户继续输入「12」时它已经被截断 —— 表现为「输入的数字不生效」。
   * 改成草稿后：输入过程不受外部值干扰，提交时机明确。
   */
  const [draft, setDraft] = useState(String(page));
  // 外部翻页（上一页/下一页/筛选变了导致页码回落）时同步草稿
  useEffect(() => setDraft(String(page)), [page]);

  const commit = () => {
    go(Number(draft));
    // 提交后回到真实页码：输入 999 会被夹到最后一页，草稿也要跟着收敛
    setDraft(String(page));
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
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
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
