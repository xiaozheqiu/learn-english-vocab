/**
 * 顽固词清单（§6 lib/leech.ts）
 *
 * 被 leech 规则挡在主队列外的词，集中在这里供你主动处理。
 * 纯函数：输入快照，输出清单，不碰 React 也不碰存储。
 *
 * 为什么需要单独一页：
 * 主队列的职责是「每天清账」，一类反复记不住的词混在里面会把整轮拖长；
 * 但它们又不能真的消失 —— 用户需要能看到「哪些词我一直在忘」，
 * 并在状态好的时候集中攻克一次。
 */
import { isLeech, isShelvedAsLeech, leechDueAt } from "./srs";
import type { SrsCardRecord, Word } from "./types";

export interface LeechItem {
  word: Word;
  record: SrsCardRecord;
  /** 累计忘记次数 */
  lapses: number;
  /** 距离回归主队列还有几天；0 = 已到期，下一轮复习就会出现 */
  daysUntilReturn: number;
  /** 是否仍在冷却期内（被挡在主队列外） */
  shelved: boolean;
}

const DAY_MS = 86_400_000;

/**
 * 取顽固词清单，按「忘记次数 > 即将回归」排序。
 *
 * 排序理由：忘记 12 次的词比忘记 8 次的更值得优先处理；
 * 同次数下，快要回归主队列的先处理，避免它刚回去又被忘记。
 */
export function listLeeches(
  words: readonly Word[],
  records: ReadonlyMap<string, SrsCardRecord>,
  now: Date = new Date(),
): LeechItem[] {
  const items: LeechItem[] = [];
  for (const word of words) {
    const record = records.get(word.key);
    if (!record || !isLeech(record)) continue;
    const dueAt = leechDueAt(record);
    const daysLeft = Math.max(0, Math.ceil((dueAt - now.getTime()) / DAY_MS));
    items.push({
      word,
      record,
      lapses: record.lapses,
      daysUntilReturn: daysLeft,
      shelved: isShelvedAsLeech(record, now),
    });
  }
  items.sort((a, b) => {
    if (a.lapses !== b.lapses) return b.lapses - a.lapses;
    return a.daysUntilReturn - b.daysUntilReturn;
  });
  return items;
}

/** 顽固词按「忘记次数」分档，用于页面上的分组标签 */
export function leechSeverity(lapses: number): "medium" | "high" | "severe" {
  if (lapses >= 14) return "severe";
  if (lapses >= 11) return "high";
  return "medium";
}
