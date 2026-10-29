#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复「牛津抓取页与项目词条词性对不上」导致的错译。

两类问题：
  A. 词性映射缺失（纯技术问题，不影响语义）
     项目写 `number`，牛津写 `num`；项目写 `definite article`，牛津写 `article`。
     这类只要把同义词表补全即可，不需要改数据。
  B. 真的抓错了页（语义错误，必须修）
     - do  → 抓到了缩写页 `do`（ditto「同上」），应取动词页
     - eight → 首义是「八人赛艇队」，应取数词页
     - consist/derive/devote/rely 等 → 牛津只有短语动词页，首义应取 consist of 等

输出 /tmp/oxford_mismatch.json，供人工核对后写回。
"""
import gzip, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OXFORD = os.path.join(ROOT, "data", "oxford", "senses.json.gz")

# 牛津词性 → 项目词性（同义映射）
POS_SYNONYM = {
    "num": {"number", "num"},
    "number": {"number", "num"},
    "ordinal number": {"number", "num"},
    "article": {"article", "det", "indefinite article", "definite article"},
    "determiner": {"det", "determiner"},
    "phrasal verb": {"v", "phrasal v"},
    "combining form": {"n", "prefix", "suffix"},
    "abbreviation": {"abbr", "n"},
}

# 已确认抓错页的词：word → 应该使用哪一个 slug 的页面
# 这些在牛津是独立词条页，首义与主词条完全不同
WRONG_PAGE = {
    "do": "do_1",          # do (v.) 而不是缩写页 do (ditto)
    "eight": "eight_1",    # 数词页
    "night": "night_1",    # 名词页而不是 goodnight 缩写
}


def main():
    ox = json.loads(gzip.open(OXFORD, "rt", encoding="utf-8").read())
    js = r'''
const fs=require("fs"),vm=require("vm");
let out=[];
for(const L of ["A1","A2","B1","B2","C1"]){
  const sb={window:{}};vm.createContext(sb);
  vm.runInContext(fs.readFileSync(`data/${L}.js`,"utf8"),sb);
  sb.window.OX[L].forEach(r=>out.push({level:L,word:r[0],pos:r[1],cn:r[2]}));
}
console.log(JSON.stringify(out));'''
    res = subprocess.run(["node", "-e", js], capture_output=True, text=True, cwd=ROOT)
    proj = json.loads(res.stdout)

    report = {"semantic": [], "mapping_only": []}
    for e in proj:
        senses = ox.get(e["word"], {}).get("senses", [])
        if not senses:
            continue
        ox_pos = set()
        for s in senses:
            k = s["pos"].strip().rstrip(",").lower()
            ox_pos |= POS_SYNONYM.get(k, {k})
        want = set()
        for part in e["pos"].replace("/", " , ").split(","):
            p = part.strip().rstrip(".").lower()
            if not p:
                continue
            p = {"a": "adj", "ad": "adv", "vt": "v", "vi": "v", "exclam": "excl"}.get(p, p)
            want.add(p)
        if want & ox_pos:
            continue
        # 没有交集：区分「映射缺失」与「真错页」
        first = senses[0]
        raw_first = first["pos"].strip().rstrip(",").lower()
        if raw_first in POS_SYNONYM and (POS_SYNONYM[raw_first] & want):
            report["mapping_only"].append(e["word"])
        else:
            report["semantic"].append({
                "word": e["word"],
                "declared": e["pos"],
                "oxford_first_pos": first["pos"],
                "oxford_first_en": first["en"][:90],
                "current_cn": e["cn"],
                "all_oxford_pos": sorted({s["pos"] for s in senses}),
                "suggest_slug": WRONG_PAGE.get(e["word"], ""),
            })

    print(f"纯映射缺失（无需改数据）: {len(report['mapping_only'])}")
    print(f"真的抓错页（需修）: {len(report['semantic'])}")
    for item in report["semantic"]:
        print(f"\n  {item['word']}  声明={item['declared']}")
        print(f"    牛津首义:[{item['oxford_first_pos']}] {item['oxford_first_en']}")
        print(f"    现译: {item['current_cn'][:50]}")
        print(f"    牛津全部词性: {item['all_oxford_pos']}")
    json.dump(report, open("/tmp/oxford_mismatch.json", "w"), ensure_ascii=False, indent=1)
    print(f"\n已写入 /tmp/oxford_mismatch.json")


if __name__ == "__main__":
    main()
