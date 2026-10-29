#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从牛津义项数据生成 src/data/oxford.json（牛津官方 Oxford 3000 / 5000 标记）。

输入：data/oxford/senses.json.gz（已入库的权威快照，不需要联网）
输出：src/data/oxford.json

为什么这个文件必须入库：
  src/data/*.json 里的 A1..C1 是构建时从 data/*.js 转出来的派生物，可以忽略；
  但 oxford.json 的源数据是牛津抓取结果，重新生成需要联网 25 分钟。
  它是「构建输入」而不是「构建产物」，不入库就等于换台机器就丢标记。

字段口径（v2 起只留这两个）：
  ox3000     牛津官方 Oxford 3000 标记
  ox5000     牛津官方 Oxford 5000 标记

历史上的 cefr / senses 两个字段（词条级与义项级 CEFR）已随「难度」筛选一起移除：
  那个维度与词表自带的 A1–C1 等级在 5323 条里 5280 条完全一致，等于同一个轴做了两遍。

用法：
  python3 scripts/gen-oxford.py
"""
import gzip, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OXFORD = os.path.join(ROOT, "data", "oxford", "senses.json.gz")
OUT = os.path.join(ROOT, "src", "data", "oxford.json")
LEVELS = ["A1", "A2", "B1", "B2", "C1"]


def npos(p):
    """牛津词性 → 统一缩写，用于和项目词条声明的词性比对"""
    p = p.strip().rstrip(",").lower()
    if not p:
        return "number"  # 裸义项多为数词（如 eight 的 "8"）
    return {
        "noun": "n.", "verb": "v.", "adjective": "adj.", "adverb": "adv.",
        "preposition": "prep.", "conjunction": "conj.", "pronoun": "pron.",
        "determiner": "det.", "number": "number", "ordinal number": "number",
        "exclamation": "exclam.", "modal verb": "modal v.",
        "auxiliary verb": "auxiliary v.", "definite article": "definite article",
        "indefinite article": "indefinite article", "article": "article",
        "phrasal verb": "v.", "linking verb": "v.", "abbreviation": "n.",
        "combining form": "n.", "prefix": "prefix", "suffix": "suffix",
        "infinitive marker": "prep.", "symbol": "n.",
    }.get(p, p)


def allowed(project_pos):
    """项目词条声明的词性 → 允许匹配的牛津词性集合"""
    groups = {
        "n": {"n."}, "v": {"v."}, "vt": {"v."}, "vi": {"v."},
        "adj": {"adj."}, "a": {"adj."}, "adv": {"adv."}, "ad": {"adv."},
        "prep": {"prep."}, "conj": {"conj."}, "pron": {"pron."},
        "det": {"det."}, "number": {"number"}, "exclam": {"exclam."},
        "modal v": {"modal v."}, "auxiliary v": {"auxiliary v."},
        "definite article": {"definite article", "article"},
        "indefinite article": {"indefinite article", "article"},
        "article": {"article", "definite article", "indefinite article"},
    }
    out = set()
    for part in project_pos.replace("/", " , ").split(","):
        p = part.strip().rstrip(".").lower()
        if p:
            out |= groups.get(p, {p + "."})
    return out


def load_project():
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
    if res.returncode != 0:
        sys.exit(f"读取 data/*.js 失败：{res.stderr[:300]}")
    return json.loads(res.stdout)


def main():
    if not os.path.exists(OXFORD):
        sys.exit(f"缺少 {OXFORD}：这是已入库的抓取快照，请检查仓库完整性")

    ox = json.loads(gzip.open(OXFORD, "rt", encoding="utf-8").read())
    proj = load_project()

    index = {}
    for e in proj:
        senses = ox.get(e["word"], {}).get("senses", [])
        allow = allowed(e["pos"])
        picked = [s for s in senses if npos(s["pos"]) in allow] or senses
        # 与 data/*.js 里释义的分段数对齐：最多 2 段（见写数据时的 tidy 规则）
        segments = len([p for p in e["cn"].split("；") if p.strip()])
        picked = picked[: max(segments, 1)]
        key = f'{e["level"]}|{e["word"]}|{e["pos"]}'
        flags = {}
        if any(s.get("ox3000") for s in senses):
            flags["ox3000"] = True
        if any(s.get("ox5000") for s in senses):
            flags["ox5000"] = True
        index[key] = flags

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

    print(f"已写入 {OUT}：{len(index)} 条，{os.path.getsize(OUT)/1024:.1f} KB")
    print(f"  ox3000 {sum(1 for v in index.values() if v.get('ox3000'))}  "
          f"ox5000 {sum(1 for v in index.values() if v.get('ox5000'))}")


if __name__ == "__main__":
    main()
