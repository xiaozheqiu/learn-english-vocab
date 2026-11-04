#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把「一个词占多行」合并成「一个词占一行」，并把短语拆成独立类型。

## 为什么合并

原来 5323 行里有 350 个词出现多次（同一个词按不同词性、不同等级各占一行），
其中 4 组是同一等级 + 同一词性，在只渲染「单词 + 词性」的词表里长得完全一样，
看起来就是「同一个词重复了两遍」。词性不同确实该区分，但那是**一行之内**的
区别（`arm  n., v.`），不是两行。

合并后 4955 行 = 4955 个不同单词，一个词永远只有一行。

## 词性怎么合并

同一个词的各词性去重后按首次出现顺序串起来。词性若来自不同等级，在后面标上
它的等级（`v.(C1)`）—— 否则 `arm` 落在 A1、用户会以为 v. 也是 A1 水平。
没跨等级的词性不加标注，所以绝大多数行（4578 个单词性词条）字符串原样不变。

## 等级取哪个

取最低的一个（最早该学的那个）。C1 的 `arm v.` 并进 A1 的 `arm`，
C1 板块不再重复出现这个词；但词性串里的 `v.(C1)` 把「这个用法是 C1 难度」
这个信息保留下来了。

## 短语

含空格、且不含逗号的词条算短语（`have to` / `according to` / `ice cream`）。
`a, an` 含空格但含逗号 —— 它是冠词的书写形式（a 与 an 两个变体），不是短语。
连字符词（`T-shirt` / `well-being`）不含空格，仍算单词。

短语不写进数据文件的新字段：前端用同一条规则派生即可（见 src/lib/words.ts），
数据多一个字段就多一份要同步维护的真值。

用法：
  python3 scripts/merge-words.py --dry-run    # 只看会怎么合
  python3 scripts/merge-words.py --apply      # 写入 data/*.js
"""
import argparse
import json
import os
import subprocess
import sys
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = ["A1", "A2", "B1", "B2", "C1"]
LEVEL_ORDER = {L: i for i, L in enumerate(LEVELS)}

# 抓取时漏进词头的 slug 残留：牛津 one 的页面 slug 就是 "one number/"
WORD_FIX = {
    "one number/": "one",
}


def read_rows(path):
    code = f'''
const fs=require("fs"),vm=require("vm");
const sb={{window:{{}}}};vm.createContext(sb);
vm.runInContext(fs.readFileSync({json.dumps(path)},"utf8"),sb);
const L=Object.keys(sb.window.OX)[0];
console.log(JSON.stringify(sb.window.OX[L]));
'''
    res = subprocess.run(["node", "-e", code], capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"读取 {path} 失败：{res.stderr[:300]}")
    return json.loads(res.stdout)


def write_rows(path, rows, header):
    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    level = os.path.basename(path).split(".")[0]
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + "\nwindow.OX = window.OX || {};\n")
        f.write(f"window.OX.{level} = {body};\n")


def split_pos(pos):
    """词性串 → 有序去重列表。`n.,adj.` 与 `det./pron.` 两种写法都要拆开。"""
    out = []
    for raw in pos.replace("/", ",").split(","):
        piece = raw.strip()
        if piece and piece not in out:
            out.append(piece)
    return out


def is_phrase(word):
    """含空格且不含逗号 = 短语；`a, an` 是冠词的两个变体，不算。"""
    return " " in word and "," not in word


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    apply = args.apply and not args.dry_run

    # 1. 全部读进来，按单词归组（保持首次出现顺序，输出仍是字母序）
    groups = OrderedDict()
    fixed = []
    for level in LEVELS:
        path = os.path.join(ROOT, "data", f"{level}.js")
        with open(path, encoding="utf-8") as f:
            header = f.readline().rstrip("\n")
        for row in read_rows(path):
            word = str(row[0]).strip()
            if word in WORD_FIX:
                fixed.append((level, word, WORD_FIX[word]))
                word = WORD_FIX[word]
            groups.setdefault(word, []).append(
                {
                    "level": level,
                    "pos": str(row[1]).strip(),
                    "cn": str(row[2]).strip(),
                    "scope": row[3] if len(row) > 3 else 0,
                    "seq": row[4] if len(row) > 4 else 0,
                    "header": header,
                }
            )

    # 2. 每个词合成一行
    out = {L: [] for L in LEVELS}
    merged_multi = 0
    for word, entries in groups.items():
        home = min(entries, key=lambda e: LEVEL_ORDER[e["level"]])["level"]
        if len(entries) > 1:
            merged_multi += 1

        # 词性：按「词性名」去重，不是按加了标注的标签去重 ——
        # 否则 bank 的 n.(A1) 与 n.(B1) 会并成 "n., n.(B1)"，还是重复。
        # 同一个词性出现在多个等级时取它最低的那个等级：那就是该学它的时机。
        first_level = {}
        for entry in entries:
            for piece in split_pos(entry["pos"]):
                current = first_level.get(piece)
                if current is None or LEVEL_ORDER[entry["level"]] < LEVEL_ORDER[current]:
                    first_level[piece] = entry["level"]

        # 输出顺序：主词性（home 等级那条）在前，其余按首次出现顺序
        seen = []
        for entry in sorted(entries, key=lambda e: LEVEL_ORDER[e["level"]]):
            for piece in split_pos(entry["pos"]):
                tag = piece if first_level[piece] == home else f"{piece}({first_level[piece]})"
                if tag not in seen:
                    seen.append(tag)
        pos = ", ".join(seen)

        # 释义 / 范围取主词性那条（home 等级里最先出现的那行）
        primary = next((e for e in entries if e["level"] == home), entries[0])

        out[home].append([word, pos, primary["cn"], primary["scope"], primary["seq"]])

    total_before = sum(len(read_rows(os.path.join(ROOT, "data", f"{L}.js"))) for L in LEVELS)
    total_after = sum(len(v) for v in out.values())

    print(f"合并：{total_before} 行 → {total_after} 行（{len(groups)} 个单词）")
    print(f"  被合并的多行词：{merged_multi} 个")
    print(f"  词头修正：{fixed}")
    phrases = [w for w in groups if is_phrase(w)]
    print(f"  短语（含空格不含逗号）：{len(phrases)} 个 → {phrases}")
    for L in LEVELS:
        before = len(read_rows(os.path.join(ROOT, "data", f"{L}.js")))
        print(f"  {L}: {before} → {len(out[L])}")

    if not apply:
        print("\n（--dry-run，未写入。加 --apply 生效）")
        return

    for L in LEVELS:
        path = os.path.join(ROOT, "data", f"{L}.js")
        with open(path, encoding="utf-8") as f:
            header = f.readline().rstrip("\n")
        write_rows(path, out[L], header)
    print("\n已写入 data/*.js")


if __name__ == "__main__":
    main()
