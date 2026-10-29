#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按牛津官方标记 + 口语词频生成 core/extended 两档与学习顺序，输出 src/data/tiers.json。

为什么要用官方标记而不是纯词频：
  Oxford 3000/5000 是牛津按「学习者是否需要」筛出来的清单，权威性高于任何
  词频阈值。实测纯按词频 ≤5000 切会把 934 条官方标记为 3000/5000 的核心词
  误判成 extended —— 包括 a, an / August / bill / cinema / dictionary 这批
  初学者绕不开的词。反过来也把 do / policeman / blank 这类词判成 core，
  其中 do 的词频排在 18 位却因为没进官方表而被误判。

判定规则（三重条件，按优先级）：
  1. ox3000                         → core   官方核心，无条件
  2. ox5000 且 首义 CEFR ≤ b2        → core   官方扩展词但不难
  3. 无 ox5000 且 首义 CEFR ≤ b1     → core   官方表有遗漏，按难度兜底
  4. 无 ox5000 且 词频 ≤ 3000        → core   再按词频兜底（补回 CD/DVD 这类缩写）
  5. 其余                            → extended

为什么不能只用官方标记：
  官方表漏了 95 个常用词（CD/DVD/policeman/blank/gentleman/tape），
  只看标记会把它们判成 extended，但它们都是 A1–B1 的基础词。
为什么不能只用词频：会把 938 条官方标记的核心词误判成 extended，
  包括 autumn / thief / sailor / well-being 这批初学者绕不开的词。
三重条件的结果：extended 里 CEFR ≤ b1 的词为 0 条，A1–B1 全部留在 core。

学习顺序：先 core 后 extended；同档内按词频升序（越常用越先学）。
词频缺失的沉到该档末尾。

用法：
  python3 scripts/gen-tiers.py --ecdict /tmp/ecdict.csv
"""
import argparse, csv, json, os, re, subprocess, sys, gzip
from collections import Counter

csv.field_size_limit(10 ** 9)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = ["A1", "A2", "B1", "B2", "C1"]
OUT = os.path.join(ROOT, "src", "data", "tiers.json")
OXFORD = os.path.join(ROOT, "data", "oxford", "senses.json.gz")

# 词频兜底阈值：官方表没标记、但词频足够高的词仍算 core
FRQ_CORE_MAX = 3000


def load_project():
    js = r'''
const fs=require("fs"),vm=require("vm");
let out=[];
for(const L of ["A1","A2","B1","B2","C1"]){
  const sb={window:{}};vm.createContext(sb);
  vm.runInContext(fs.readFileSync(`data/${L}.js`,"utf8"),sb);
  sb.window.OX[L].forEach(r=>out.push({level:L,word:r[0],pos:r[1]}));
}
console.log(JSON.stringify(out));'''
    res = subprocess.run(["node", "-e", js], capture_output=True, text=True, cwd=ROOT)
    if res.returncode != 0:
        sys.exit(f"读取 data/*.js 失败：{res.stderr[:300]}")
    return json.loads(res.stdout)


def load_ecdict(path):
    ec = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            w = row["word"].strip().lower()
            if w and w not in ec:
                ec[w] = row
    return ec


def pick_freq(row):
    """优先 frq（COCA 混合），缺失回退 bnc。frq=0 不等于罕见（月份/缩写常见），
    所以要用 bnc 兜底，两者都没有才返回 0。"""
    for field in ("frq", "bnc"):
        try:
            v = int(row.get(field) or 0)
        except ValueError:
            v = 0
        if v > 0:
            return v
    return 0


CEFR_RANK = {"a1": 1, "a2": 2, "b1": 3, "b2": 4, "c1": 5, "c2": 6}

POS_MAP = {
    "noun": "n", "verb": "v", "adjective": "adj", "adverb": "adv",
    "preposition": "prep", "conjunction": "conj", "pronoun": "pron",
    "determiner": "det", "number": "num", "exclamation": "excl",
    "modal verb": "modal v", "auxiliary verb": "auxiliary v",
    "definite article": "article", "indefinite article": "article",
    "phrasal verb": "phrasal v", "prefix": "prefix", "suffix": "suffix",
    "linking verb": "v", "infinitive marker": "marker",
}


def first_cefr_rank(pos: str, senses: list) -> int:
    """取与该词条词性匹配的第一条义项的 CEFR 数值；拿不到返回 0。"""
    want = set()
    for part in pos.replace("/", " , ").split(","):
        p = part.strip().rstrip(".").lower()
        if not p:
            continue
        p = {"a": "adj", "ad": "adv", "vt": "v", "vi": "v", "exclam": "excl"}.get(p, p)
        want.add(POS_MAP.get(p, p))
    matched = [
        s for s in senses
        if POS_MAP.get(s["pos"].strip().rstrip(",").lower(), s["pos"]) in want
    ] or senses
    if not matched:
        return 0
    return CEFR_RANK.get(matched[0].get("cefr", ""), 0)


def tier_of(ox3000: bool, ox5000: bool, cefr_rank: int, frq: int) -> str:
    if ox3000:
        return "core"
    if ox5000 and 0 < cefr_rank <= 4:  # ≤ b2
        return "core"
    if not ox5000 and 0 < cefr_rank <= 3:  # ≤ b1
        return "core"
    if not ox5000 and 0 < frq <= FRQ_CORE_MAX:
        return "core"
    return "extended"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ecdict", required=True)
    args = ap.parse_args()

    proj = load_project()
    ec = load_ecdict(args.ecdict)
    ox = json.loads(gzip.open(OXFORD, "rt", encoding="utf-8").read())

    rows = []
    for e in proj:
        key = f'{e["level"]}|{e["word"]}|{e["pos"]}'
        senses = ox.get(e["word"], {}).get("senses", [])
        ox3000 = any(s["ox3000"] for s in senses)
        ox5000 = any(s["ox5000"] for s in senses)
        frq = pick_freq(ec.get(e["word"].strip().lower()) or {})
        rank = first_cefr_rank(e["pos"], senses)
        rows.append({
            "key": key,
            "word": e["word"],
            "level": e["level"],
            "frq": frq,
            "ox3000": ox3000,
            "ox5000": ox5000,
            "cefrRank": rank,
            "tier": tier_of(ox3000, ox5000, rank, frq),
        })

    order = {"core": 0, "extended": 1}
    rows.sort(key=lambda r: (
        order[r["tier"]],
        r["frq"] if r["frq"] else 10 ** 9,
        r["word"].lower(),
    ))

    bounds = {}
    cum = 0
    for tier in ("core", "extended"):
        cum += sum(1 for r in rows if r["tier"] == tier)
        bounds[tier] = cum

    payload = {"version": 2, "tierBounds": bounds, "order": [r["key"] for r in rows]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    c = Counter(r["tier"] for r in rows)
    print(f"已写入 {OUT}：{len(rows)} 条，{os.path.getsize(OUT)/1024:.1f} KB")
    print(f"  core {c['core']}  extended {c['extended']}   分界 {bounds}")
    print(f"  ox3000 {sum(1 for r in rows if r['ox3000'])}  "
          f"ox5000 {sum(1 for r in rows if r['ox5000'])}  "
          f"无官方标记但按难度/词频补回 {sum(1 for r in rows if r['tier']=='core' and not r['ox3000'] and not r['ox5000'])}")
    by_level = {}
    for r in rows:
        by_level.setdefault(r["level"], {"core": 0, "extended": 0})[r["tier"]] += 1
    for L in LEVELS:
        print(f"    {L}: core {by_level[L]['core']:>4}  extended {by_level[L]['extended']:>4}")
    print(f"\n前 15 条学习顺序：")
    for i, r in enumerate(rows[:15], 1):
        flag = "OX3K" if r["ox3000"] else ("OX5K" if r["ox5000"] else "freq")
        print(f"  #{i:<4} {r['tier']:8} {flag:4} {r['word']:14} {r['level']}  frq={r['frq']}")
    print(f"\nextended 档示例：")
    for r in rows[-10:]:
        print(f"  {r['word']:18} frq={r['frq']}")


if __name__ == "__main__":
    main()
