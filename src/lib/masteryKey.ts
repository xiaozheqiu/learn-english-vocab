/**
 * 旧主键 → 新主键换算。
 *
 * ## 为什么要迁移
 *
 * 老版本的主键是 `等级|单词|词性[|序号]`，同一个词会占 2~4 行（`arm` 在 A1 是
 * `A1|arm|n.`、在 C1 是 `C1|arm|v.`）。合并成一个词一行之后主键变成
 * `板块|单词`，**5321 个旧 key 没有一个能直接命中新 key** —— 不迁移的话，
 * 所有老用户在升级那一刻会看到「进度全没了」。
 *
 * ## 映射规则
 *
 * 旧 key 里的单词不变，只是砍掉词性并补齐板块：
 *
 *   A1|arm|n.          → A1|arm      （取最低等级那一行选的板块，即 A1）
 *   C1|arm|v.          → A1|arm      （同一个词的最高等级行并进 A1）
 *   A1|have to|modal v. → PHRASE|have to  （短语一律落短语栏）
 *   A1|one number/|…   → A1|one      （抓取残留的词头）
 *
 * 所以迁移不需要「词 → 板块」的完整对照表：把 key 拆出 `等级` 与 `单词`，
 * 再按短语规则决定板块即可。**一个词有多行时，任意一行都能算出同一个新 key**，
 * 于是「A1 的 arm 标了、C1 的 arm 没标」这种老状态会合并成「arm 已掌握」——
 * 这符合合并的语义：认识这个词，就是认识它的各个词性。
 *
 * 词头修正（`one number/` → `one`）必须显式列出，因为那是抓取事故，
 * 不能靠规则推出来。
 */
import { PHRASE_LEVEL } from "./types";

/** 抓取时漏进词头的 slug 残留；与 scripts/merge-words.py 的 WORD_FIX 同一份 */
const WORD_FIX: Record<string, string> = {
  "one number/": "one",
};

/** 含空格且不含逗号 = 短语；`a, an` 是冠词两个书写变体，不算 */
function isPhrase(word: string): boolean {
  return word.includes(" ") && !word.includes(",");
}

/**
 * 旧 key → 新 key。
 *
 * 不是旧格式的 key（已经是新格式、或完全看不懂）原样返回：本函数只负责
 * 「把旧的翻译成新的」，不该顺手吞掉自己不认识的东西 —— 那会让一个
 * 格式猜测失误变成静默的数据丢失。
 *
 * ## 板块必须按单词收敛，不能照抄旧 key 的等级
 *
 * 老数据里 `arm` 是 `A1|arm|n.` + `C1|arm|v.` 两行，合并后它只有一行、
 * 落在 A1。如果照抄各自旧 key 的等级，这两行会算成 `A1|arm` 与 `C1|arm`
 * 两个不同的词 —— 迁移等于把「一个词」拆成「两个词」，而 `C1|arm` 在词表里
 * 根本不存在。所以板块必须由单词本身唯一决定。
 *
 * 这个唯一值就是 `preferredBucket()` 的返回值（与 merge-words.py 的
 * 「取最低等级」一致）。`migrateKey` 拿不到词表，所以这里用同样的规则：
 * 短语 → PHRASE，其余保持原等级 —— 但这只在「调用方保证一行的等级就是
 * 该词的最低等级」时成立。跨等级的多行由 `migrateKeys` 先聚组再收敛。
 */
export function migrateKey(oldKey: string): string {
  const parts = oldKey.split("|");
  // 旧格式至少 3 段：等级|单词|词性[|序号]。段数不对就当它已经是新格式
  if (parts.length < 3) return oldKey;

  const level = parts[0]!;
  const rawWord = parts[1] ?? "";
  const word = WORD_FIX[rawWord] ?? rawWord;
  if (!word) return oldKey;

  return `${isPhrase(word) ? PHRASE_LEVEL : level}|${word}`;
}

/** 旧 key 拆出来的 (板块, 单词)；不是旧格式则 null */
function splitOldKey(oldKey: string): { level: string; word: string } | null {
  const parts = oldKey.split("|");
  if (parts.length < 3) return null;
  const raw = parts[1] ?? "";
  const word = WORD_FIX[raw] ?? raw;
  if (!word) return null;
  return { level: parts[0]!, word };
}

/**
 * 批量换算并去重。
 *
 * 多个旧 key 会塌到同一个新 key（`A1|arm|n.` 与 `C1|arm|v.` → `A1|arm`），
 * 这是预期的：合并之后一个词只有一行、一个勾。
 *
 * 收敛必须在这里做而不是逐条 migrateKey：同一个词的各行散在不同等级，
 * 只有把它们聚到一起才能确定它最终落在哪个板块（取最低等级）。
 */
export function migrateKeys(oldKeys: Iterable<string>): string[] {
  const keys = [...oldKeys];
  const buckets = buildBucketMap(keys);
  const out = new Set<string>();
  for (const key of keys) {
    const word = key.split("|")[1] ?? "";
    const bucket = buckets.get(word);
    out.add(bucket === undefined ? migrateKey(key) : `${bucket}|${word}`);
  }
  return [...out];
}

/**
 * 旧 key 列表 → `单词 → 该词最终板块`。
 *
 * 只有在**拿不到真实词表**时才靠这一份推算。它有两个已知的盲区：
 *
 *   1. 用户只在一台设备上标过 C1 的 `arm v.`，另一台设备标过 A1 的 `arm n.`，
 *      各自都不足以推出「arm 落在 A1」；
 *   2. 云端只存了半边数据时同样推不出来。
 *
 * 所以正常路径用的是 `buildBucketMapFromWords()`（照着真实词表建），
 * 这里只作为词表还没加载出来时的兜底。
 */
export function buildBucketMap(oldKeys: Iterable<string>): Map<string, string> {
  const order = ["A1", "A2", "B1", "B2", "C1"];
  const rank = (level: string) => {
    const i = order.indexOf(level);
    return i < 0 ? order.length : i;
  };

  const best = new Map<string, string>();
  for (const key of oldKeys) {
    const parsed = splitOldKey(key);
    if (!parsed) continue;
    const { level, word } = parsed;
    const bucket = isPhrase(word) ? PHRASE_LEVEL : level;
    const prev = best.get(word);
    if (prev === undefined || rank(bucket) < rank(prev)) best.set(word, bucket);
  }
  return best;
}

/**
 * 权威口径：`单词 → 板块`，直接照着当前词表建。
 *
 * 词表里一个词只有一行，那一行的 level 就是唯一答案 —— 不存在「猜」。
 * 迁移与云端归一化都应该走这条：拿不准的板板块会让用户得到一个词表里
 * 不存在的 key（标了也看不见、取消也取消不掉）。
 */
export function buildBucketMapFromWords(
  words: readonly { word: string; level: string }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const word of words) map.set(word.word, word.level);
  return map;
}

/** 按权威对照把一条旧 key 落到新 key；对照里没有这个词时返回 null */
export function remapWithBuckets(
  oldKey: string,
  buckets: ReadonlyMap<string, string>,
): string | null {
  const parsed = splitOldKey(oldKey);
  if (!parsed) return null;
  const bucket = buckets.get(parsed.word);
  if (bucket === undefined) return null;
  return `${bucket}|${parsed.word}`;
}
