import { BookOpen, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export default function Pager({
  page,
  pages,
  size,
  total,
  sizes,
  onPage,
  onSize,
  onOpenGuide,
  installPrompt,
}) {
  const go = (next) => {
    const target = Math.min(
      Math.max(1, Math.round(Number(next) || 1)),
      pages || 1,
    );
    if (target === page) return;
    onPage(target);
  };
  return (
    <nav
      className="mt-4 flex justify-center rounded-xl border border-primary/20 bg-primary/[0.045] py-2 shadow-sm"
      aria-label="词表分页"
    >
      <div className="flex w-full flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
        <Button
          variant="outline"
          size="icon"
          aria-label="上一页"
          title="上一页"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="下一页"
          title="下一页"
          disabled={page >= pages}
          onClick={() => go(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <label className="sr-only" htmlFor="page-jump">
          当前页
        </label>
        <Input
          id="page-jump"
          type="number"
          min="1"
          max={pages || 1}
          value={page}
          onChange={(event) => {
            if (event.target.value) go(event.target.value);
          }}
          className="h-8 w-14 px-2 text-center text-xs"
        />
        <span>/ {pages || 1}</span>
        <Select
          aria-label="每页数量"
          value={size}
          onChange={(event) => onSize(Number(event.target.value))}
          className="h-8 w-[58px] px-2 text-center text-xs"
        >
          {sizes.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <span className="tabular-nums">({total})</span>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          aria-label="词性对照"
          title="词性对照"
          onClick={onOpenGuide}
        >
          <BookOpen className="h-4 w-4" />
        </Button>
        {installPrompt && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="安装应用"
            title="安装应用"
            onClick={installPrompt}
          >
            <Download className="h-4 w-4" />
          </Button>
        )}
      </div>
    </nav>
  );
}
