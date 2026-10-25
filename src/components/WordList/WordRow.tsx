import { memo } from "react";
import { Check, Plus } from "lucide-react";
import { StatusLabel } from "./StatusRail";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { isMobile, transUrl } from "@/lib/trans";
import type { StatusInfo, Word } from "@/lib/types";

export interface WordRowProps {
  word: Word;
  index: number;
  status: StatusInfo;
  checked: boolean;
  /** 父组件传稳定引用；行内只补自己的 key */
  onToggleSelect: (key: string, shiftKey?: boolean) => void;
  onToggleMastery: (key: string, next: boolean) => void;
}

/**
 * 词表行。
 *
 * 两个动作必须一眼分得开（旧版把「已掌握」同时写成状态文字和按钮，看起来像两颗按钮）：
 * - 左侧勾选框 = 选中行，只服务于右下角的批量操作；
 * - 右侧药丸 = 是否已掌握，点一下切换，已掌握时只保留这一颗按下态按钮，
 *   不再额外印一行「已掌握」文字（左栏 4px 深绿竖条已经在表达同一件事）。
 *
 * 布局：勾选框 / 序号 / 单词 + 释义 / 排期标签 + 掌握药丸。
 * 移动端释义换到第二行，右侧动作贴右上；桌面端单行四列。
 */
/**
 * 一行词表。
 *
 * `memo` 是必需的：一页 500 行时，勾选任意一行都会让父组件重渲染，
 * 不做 memo 就要重建 500 个行组件（实测单次点击 156~241ms）。
 *
 * 默认的浅比较在这里不够用：`status` 是 statusOf 每次新造的对象，
 * 引用永远不同，导致 500 行仍然全部重渲染。所以按字段比较。
 */
function sameStatus(a: StatusInfo, b: StatusInfo): boolean {
  return a.kind === b.kind && a.label === b.label && a.rail === b.rail;
}

export const WordRow = memo(
  function WordRow({
    word,
    index,
    status,
    checked,
    onToggleSelect,
    onToggleMastery,
  }: WordRowProps) {
    const mastered = status.kind === "mastered";

    return (
      <div
        role="row"
        tabIndex={0}
        aria-selected={checked}
        data-key={word.key}
        onClick={(event) => onToggleSelect(word.key, event.shiftKey)}
        onKeyDown={(event) => {
          // 行内交互元素各自处理自己的键，这里只接行本身
          if (event.target !== event.currentTarget) return;
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            onToggleSelect(word.key, event.shiftKey);
          }
        }}
        className={cn(
          "rail relative flex cursor-pointer items-start gap-x-2.5 border-b border-line/70 py-3 pl-3.5 pr-3 last:border-b-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
          "hover:bg-brand-wash/40",
          // 选中 = 浅绿底；已掌握 = 文字变淡 + 左栏，不再抢同一块底色
          checked ? "bg-brand-wash/70" : mastered && "bg-paper/60",
          status.rail,
        )}
      >
        {/* 44×44 热区：容器撑到 44 高，勾选框本体仍是 18×18 */}
        <span className="flex h-11 items-start pt-[13px]">
          <Checkbox
            checked={checked}
            onCheckedChange={() => onToggleSelect(word.key)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`选择 ${word.word}（用于批量操作）`}
            title="选择此行，用于批量标记"
          />
        </span>

        <span
          data-row-index={index}
          className="flex h-6 w-6 shrink-0 items-center justify-end text-[12px] tnum text-ink-mute"
        >
          {index}
        </span>

        {/* 单词 + 词性 + 释义 */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 lg:flex-row lg:items-baseline lg:gap-3">
          <span className="flex min-w-0 items-baseline gap-2 lg:w-[9.5rem] lg:shrink-0">
            <a
              href={transUrl(word.word)}
              target={isMobile ? undefined : "_blank"}
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "word-serif text-[17px] font-semibold leading-[1.4] text-ink underline-offset-4 hover:text-brand-ink hover:underline",
                mastered && "text-ink-soft",
              )}
            >
              {word.word}
            </a>
            <span className="shrink-0 text-[12px] text-ink-mute">{word.pos}</span>
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 text-[13px] leading-6 text-ink-soft",
              mastered && "text-ink-mute",
            )}
          >
            {word.cn}
            {word.seq && <span className="ml-1.5 text-[12px] text-ink-mute">（{word.seq}）</span>}
          </span>
        </span>

        {/* 右侧：排期标签（只在有排期时出现）+ 掌握药丸。单行，不再上下堆两颗按钮 */}
        <span className="flex shrink-0 items-center gap-2 pt-[3px] lg:pt-0">
          {!mastered && <StatusLabel status={status} />}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleMastery(word.key, !mastered);
            }}
            aria-pressed={mastered}
            aria-label={mastered ? `取消掌握 ${word.word}` : `标记已掌握 ${word.word}`}
            title={mastered ? "点一下取消「已掌握」" : "点一下标记为「已掌握」"}
            className={cn(
              "relative flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] transition-colors after:absolute after:-inset-y-[9px] after:-inset-x-1 after:content-['']",
              mastered
                ? "border-brand-deep bg-brand-deep text-white"
                : "border-line bg-card text-ink-soft hover:border-brand/50 hover:text-brand-ink",
            )}
          >
            {mastered ? (
              <Check className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
            ) : (
              <Plus className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
            )}
            {mastered ? "已掌握" : "掌握"}
          </button>
        </span>
      </div>
    );
  },
  (prev, next) =>
    prev.word === next.word &&
    prev.index === next.index &&
    prev.checked === next.checked &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.onToggleMastery === next.onToggleMastery &&
    sameStatus(prev.status, next.status),
);
