import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isMobile, transUrl } from "@/lib/trans";
import type { Word } from "@/lib/types";

export interface ReviewCardProps {
  word: Word;
  /** 已翻开：出现释义（四档按钮由 RatingBar 单独渲染） */
  revealed: boolean;
  onReveal: () => void;
}

/**
 * 复习卡（§5 F2 · §1.2 · §1.3）
 *
 * 正面只有单词 + 词性，底色用 `--brand-deep`——设计语言里这个 token 的唯一职责
 * 就是深色块与复习卡正面。单词 34px/1.15 serif 600，移动端降到 30px。
 * 释义只在「显示释义」之后出现：先自己回忆，再对答案。
 *
 * 单词本身是外链（百度翻译），和词表里的单词一致：
 * 想立刻查例句 / 读音时不用退出应用再手输一遍。
 */
export function ReviewCard({ word, revealed, onReveal }: ReviewCardProps) {
  const back = useRef<HTMLDivElement>(null);

  // 翻面后把焦点移到释义块：键盘不会掉回 body，读屏直接读到释义
  useEffect(() => {
    if (revealed) back.current?.focus();
  }, [revealed]);

  return (
    <Card className="overflow-hidden">
      <div className="bg-brand-deep px-5 py-8 text-white sm:px-6 sm:py-10">
        <h2 className="text-[30px] leading-[1.15] sm:text-[34px]">
          <a
            href={transUrl(word.word)}
            target={isMobile ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="word-serif break-words font-semibold text-white underline-offset-4 hover:underline"
          >
            {word.word}
          </a>
        </h2>
        <p className="mt-1.5 text-[13px] leading-[1.2] text-white/75">{word.pos}</p>
      </div>

      {revealed ? (
        <div
          ref={back}
          tabIndex={-1}
          className="border-t border-line px-5 py-4 focus:outline-none sm:px-6"
        >
          <p className="text-[15px] leading-[1.65] text-ink">{word.cn}</p>
          <p className="mt-1 text-[12px] text-ink-mute tnum">
            {word.level}
            {word.seq ? ` · ${word.seq}` : ""}
          </p>
        </div>
      ) : (
        <div className="border-t border-line px-4 py-3">
          <Button
            size="touch"
            variant="outline"
            className="w-full"
            onClick={onReveal}
            aria-keyshortcuts="Space"
          >
            显示释义
          </Button>
        </div>
      )}
    </Card>
  );
}
