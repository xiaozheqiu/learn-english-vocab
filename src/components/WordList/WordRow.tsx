import { memo } from "react";
import { Check, Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { isMobile, transUrl } from "@/lib/trans";
import type { Word } from "@/lib/types";

export interface WordRowProps {
  word: Word;
  index: number;
  /** 是否已标记掌握（唯一的状态维度） */
  mastered: boolean;
  checked: boolean;
  /** 父组件传稳定引用；行内只补自己的 key */
  onToggleSelect: (key: string, shiftKey?: boolean) => void;
  onToggleMastery: (key: string, next: boolean) => void;
}

/**
 * 一行词表。
 *
 * 两个动作必须一眼分得开：
 * - 左侧勾选框 = 选中行，只服务于右下角的批量操作；
 * - 右侧药丸 = 是否已掌握，点一下切换，已掌握时只保留这一颗按下态按钮。
 *
 * 布局：勾选框 / 序号 / 单词 + 词性 / 掌握药丸，全宽单行。
 *
 * 释义不在行内展示：点单词会跳到三方词典，中文含义在那边看，
 * 词表只留「这个词认不认识」这一个判断，行高也就稳定成一行。
 *
 * `memo` 是必需的：一页 200 行时，勾选任意一行都会让父组件重渲染，
 * 不做 memo 就要重建 200 个行组件。
 */
export const WordRow = memo(
  function WordRow({
    word,
    index,
    mastered,
    checked,
    onToggleSelect,
    onToggleMastery,
  }: WordRowProps) {
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
          "rail relative flex cursor-pointer items-center gap-x-2.5 border-b border-line/70 py-2 pl-3.5 pr-3 last:border-b-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
          "hover:bg-brand-wash/40",
          // 选中 = 浅绿底；已掌握 = 文字变淡 + 左栏，不再抢同一块底色
          checked ? "bg-brand-wash/70" : mastered && "bg-paper/60",
          mastered ? "rail-mastered" : "",
        )}
      >
        {/* 44×44 热区：容器撑到 44 高，勾选框本体仍是 18×18 */}
        <span className="flex h-11 items-center">
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

        {/* 单词 + 词性：中文含义只在三方词典里看，行内不再重复一遍。
            用 inline 流而不是 flex：thought-provoking 这类长词在窄屏折行时，
            词性会跟在最后一个词后面，而不是被推到右侧孤零零一格。 */}
        <span className="min-w-0 flex-1 leading-[1.4]">
          <a
            href={transUrl(word.word)}
            target={isMobile ? undefined : "_blank"}
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "word-serif text-[17px] font-semibold text-ink underline-offset-4 hover:text-brand-ink hover:underline",
              mastered && "text-ink-soft",
            )}
          >
            {word.word}
          </a>
          {word.pos && (
            <span className="ml-2 whitespace-nowrap text-[12px] text-ink-mute">{word.pos}</span>
          )}
        </span>

        {/* 右侧：掌握药丸（唯一的状态控件） */}
        <span className="flex shrink-0 items-center">
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
    prev.mastered === next.mastered &&
    prev.checked === next.checked &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.onToggleMastery === next.onToggleMastery,
);
