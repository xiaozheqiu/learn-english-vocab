import { memo, useState } from "react";
import { Check, Eye, Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { isMobile, transUrl } from "@/lib/trans";
import { daysSinceMarked } from "@/lib/listView";
import type { Word } from "@/lib/types";

export interface WordRowProps {
  word: Word;
  index: number;
  /** 是否已标记掌握（唯一的状态维度） */
  mastered: boolean;
  /** 标记已掌握的时间（epoch ms）；只用来在行尾标「多久之前」 */
  markedAt?: number;
  checked: boolean;
  /** 显示中文时这一行的释义；中文模式缺释义时为空串 */
  gloss: string;
  /** 只显示中文 */
  chineseMode: boolean;
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
 * 布局：勾选框 / 序号 / 单词（或中文释义）/ 掌握药丸，全宽单行。
 *
 * ## 两种显示
 *
 * 默认只出英文，点单词跳三方词典。切到中文模式后**这一行左半边只剩中文**，
 * 单词藏在后面：想看就点一下那一行（或按 Enter / 空格），当场揭晓。
 *
 * 为什么不是「中英并排」：并排时眼睛会先扫到英文，等于把答案印在题面上。
 * 只给中文才是真的在回忆，而「点一下揭晓」保留了「想不起来时别卡住」的出路。
 *
 * 揭晓状态放在行内 `useState`，不进 `view`：它是**这一屏**的临时动作，
 * 翻页或换筛选就该重来；持久化它等于让下一次打开时答案全是摊开的。
 */
export const WordRow = memo(
  function WordRow({
    word,
    index,
    mastered,
    markedAt,
    checked,
    gloss,
    chineseMode,
    onToggleSelect,
    onToggleMastery,
  }: WordRowProps) {
    const [revealed, setRevealed] = useState(false);
    /**
     * 揭晓状态只对「当前这一轮中文态」有效。
     *
     * 直接 `useState` 会活得比中文态还久：切回英文、再切到中文时，这一行的 key 与
     * index 都没变，`memo` 判定「无变化」不重渲染，`revealed` 原样留着 ——
     * 于是刚切进中文态就看到答案已经摊开了。那正好废掉这个功能存在的理由。
     *
     * 这里在渲染期按「中文态是否开启」重置（比 useEffect 早一帧，看不到闪一下的
     * 答案，也不会多跑一次提交）。用状态记住上一次的值，而不是依赖比较。
     */
    const [revealedIn, setRevealedIn] = useState(chineseMode);
    if (revealedIn !== chineseMode) {
      setRevealedIn(chineseMode);
      if (revealed) setRevealed(false);
    }
    /** 中文模式下是否处于「只有中文、答案未揭晓」 */
    const asking = chineseMode && !revealed;
    const markedDays = markedAt ? daysSinceMarked(markedAt) : null;

    return (
      <div
        role="row"
        tabIndex={0}
        aria-selected={checked}
        data-key={word.key}
        /*
         * 词性原样挂出来：词性筛选用的是归一化后的大类（见 lib/listView.ts），
         * 前端没法从渲染出来的文本反推「这一行算不算 v.」，测试与将来可能的
         * 行内标注都需要拿到源值，所以直接暴露原始字段。
         */
        data-pos={word.pos}
        /*
         * 显示的是哪一面。e2e 与「中文模式到底有没有生效」都查这个属性，
         * 不靠文案判断 —— 文案改了不该让测试变红。
         */
        data-display={chineseMode ? (revealed ? "revealed" : "cn") : "word"}
        onClick={(event) => {
          // 中文模式下整行就是「揭晓答案」的开关；揭晓后点行仍然是选中（批量用）
          if (asking) {
            setRevealed(true);
            return;
          }
          onToggleSelect(word.key, event.shiftKey);
        }}
        onKeyDown={(event) => {
          // 行内交互元素各自处理自己的键，这里只接行本身
          if (event.target !== event.currentTarget) return;
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            if (asking) setRevealed(true);
            else onToggleSelect(word.key, event.shiftKey);
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

        {/* 单词 / 中文：中文模式下先只给中文，英文用一个「揭晓」按钮兜底。
            用 inline 流而不是 flex：thought-provoking 这类长词在窄屏折行时，
            词性会跟在最后一个词后面，而不是被推到右侧孤零零一格。 */}
        <span className="min-w-0 flex-1 leading-[1.4]">
          {chineseMode ? (
            <>
              <span
                className={cn(
                  "word-serif text-[17px] font-semibold text-ink",
                  mastered && "text-ink-soft",
                )}
              >
                {gloss || "（暂无释义）"}
              </span>
              {asking ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRevealed(true);
                  }}
                  aria-label={`揭晓 ${gloss} 对应的英文`}
                  title="点一下看英文"
                  className="ml-2 inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 align-middle text-[11px] text-ink-mute hover:border-brand/50 hover:text-brand-ink"
                >
                  <Eye className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
                  {/*
                    窄屏只留眼睛图标：释义最长 14 字，加上「看英文」三个字就会把
                    长释义挤到第二行，一行高矮不齐反而更难扫。图标本身有 title 与
                    aria-label，意思不丢。
                  */}
                  <span className="hidden sm:inline">看英文</span>
                </button>
              ) : (
                <a
                  href={transUrl(word.word)}
                  target={isMobile ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className={cn(
                    "ml-2 text-[15px] font-semibold text-brand-ink underline-offset-4 hover:underline",
                    mastered && "text-ink-soft",
                  )}
                >
                  {word.word}
                </a>
              )}
              {word.pos && revealed && (
                <span className="ml-2 whitespace-nowrap text-[12px] text-ink-mute">{word.pos}</span>
              )}
            </>
          ) : (
            <>
              {/* 英文态就是「看词表」，释义不进这一行：查词跳三方词典，
                  行高也只跟单词长度有关，一屏的行数稳定。 */}
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
            </>
          )}
        </span>

        {/*
         * 「多久之前标的」：只在已掌握时出现，且不占额外一行 ——
         * 它是复核筛选那一档的配套说明（筛出 30 天前的词，总得看得见天数），
         * 未掌握的词没有这个信息，就不该留一块空地。
         */}
        {mastered && markedDays !== null && (
          <span className="hidden shrink-0 text-[11px] text-ink-mute tnum sm:inline">
            {markedDays === 0 ? "今天标的" : `${markedDays} 天前`}
          </span>
        )}

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
    prev.markedAt === next.markedAt &&
    prev.checked === next.checked &&
    prev.gloss === next.gloss &&
    prev.chineseMode === next.chineseMode &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.onToggleMastery === next.onToggleMastery,
);
