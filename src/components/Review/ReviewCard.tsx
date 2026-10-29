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
  /**
   * 把 `cn` 按「；」拆成义项，并与义项级 CEFR 一一配对。
   * 两者都来自同一条数据（scripts/gen-cefr.py 按同样的切成段），
   * 长度对不上时以文本为准、缺的分级留空，不抛错也不显示错位标签。
   */
  const senses = word.cn
    .split(/\s*[；;]\s*/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({ text, cefr: word.senseCefr[index] ?? "" }));
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
          /*
           * 释义展开用 reveal：从上方 -4px 淡入。
           * 这个动效有功能含义 —— 它把「新出现的释义」和「原本就在的词头」
           * 在视觉上分层，扫一眼就知道哪块是刚翻出来的。
           */
          className="animate-[var(--animate-reveal)] border-t border-line px-5 py-4 focus:outline-none sm:px-6"
        >
          {/*
            逐义项列出来，每个义项后面挂它自己的 CEFR。
            不这么做就只能显示整词一个等级：above 的「在上方」是 a1、
            「自视过高」是 c2，压成一个标签等于把难度信息抹平了。
          */}
          {/*
            多个义项时加序号。
            不加序号时「这 / 那（指已提及者）」在窄屏上挤成两行，
            读起来像同一个词重复了两次；编号让它明确是「第 1 义 / 第 2 义」。
          */}
          <ul className="space-y-2">
            {senses.map(({ text, cefr }, index) => (
              <li key={`${text}-${index}`} className="flex items-baseline gap-2">
                {senses.length > 1 && (
                  <span
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-[11px] leading-[20px] text-ink-mute tnum"
                  >
                    {index + 1}
                  </span>
                )}
                <span className="text-[15px] leading-[1.65] text-ink">{text}</span>
                {cefr && (
                  <span
                    className="ml-auto shrink-0 rounded-full border border-line px-1.5 text-[10px] uppercase leading-[16px] text-ink-mute tnum"
                    aria-label={`难度 ${cefr.toUpperCase()}`}
                  >
                    {cefr}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-mute tnum">
            <span>
              {word.level}
              {word.seq ? ` · ${word.seq}` : ""}
            </span>
            {word.ox3000 && <span className="text-brand-ink">Oxford 3000</span>}
            {word.ox5000 && <span className="text-brand-ink">Oxford 5000</span>}
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
