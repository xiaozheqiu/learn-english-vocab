#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
词表释义审计与修复（一次性数据工具，不参与构建）

用法：
  1) 下载权威对照词典（77 万条，含词频/考试标签）：
       curl -o /tmp/ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
  2) 跑审计：
       python3 scripts/audit-vocab.py --ecdict /tmp/ecdict.csv
  3) 产出修复候选（不覆盖 data/，写到 /tmp 供人工过一遍）：
       python3 scripts/audit-vocab.py --ecdict /tmp/ecdict.csv --emit-fix

结论（详见报告）：
  - 现有 data/*.js 的释义是旧版金山/词霸系词典，与 ECDICT 同源，但
    构建时被截成「第一行的前 2 个义项」，44.6% 的多义词因此丢失了现代主义。
  - 11 个多词短语里有 6 个是按首词查的（have to → 有；next to → 近邻干扰）。
  - 这些是数据血缘问题，不是 UI 问题，改代码修不掉。
"""
import argparse, csv, json, re, subprocess, sys, os
from collections import Counter, defaultdict

csv.field_size_limit(10 ** 9)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = ["A1", "A2", "B1", "B2", "C1"]

POS_RE = re.compile(r'^(vt|vi|n|a|ad|adj|adv|prep|conj|pron|num|art|int|aux)\.\s*', re.I)
TYPO = [("帐", "账"), ("岐", "歧"), ("愚味", "愚昧"), ("张帖", "张贴"), ("眼睛框", "镜框")]

# 已知 6 条按首词误查的短语，映射到正确整词
PHRASE_FIX = {
    "have to": "不得不；必须",
    "next to": "紧挨着；仅次于",
    "no one": "没有人",
    "all right": "没问题；还好；好吧",
    "any more": "不再",
    "used to": "过去常常",
    "according to": "根据；按照",
    "per cent": "百分之…",
    "a, an": "一个（不定冠词）",
    "one number/": "一（数词）",
    "ice cream": "冰淇淋",
}


def load_project():
    """用 node 读 data/*.js（它们是 window.OX 赋值，不是模块）"""
    js = r'''
const fs=require("fs"),vm=require("vm");
let out=[];
for(const L of ["A1","A2","B1","B2","C1"]){
  const sb={window:{}};vm.createContext(sb);
  vm.runInContext(fs.readFileSync(`data/${L}.js`,"utf8"),sb);
  sb.window.OX[L].forEach((r,i)=>out.push({level:L,idx:i,word:r[0],pos:r[1],cn:r[2],scope:r[3],seq:r[4]}));
}
console.log(JSON.stringify(out));
'''
    res = subprocess.run(["node", "-e", js], capture_output=True, text=True, cwd=ROOT)
    if res.returncode != 0:
        sys.exit(f"读取 data/*.js 失败：{res.stderr[:400]}")
    return json.loads(res.stdout)


def load_ecdict(path):
    ec = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            w = row["word"].strip().lower()
            if w and w not in ec:
                ec[w] = row
    return ec


def split_senses(translation):
    """ECDICT translation → [(pos, 中文义)]；丢弃 [专科] 行"""
    t = (translation or "").replace("\\n", "\n")
    out = []
    for line in t.split("\n"):
        line = line.strip()
        if not line or line.startswith("["):
            continue
        m = re.match(r"^(vt|vi|n|a|ad|adj|adv|prep|conj|pron|num|art|int|aux)\.\s*(.+)$", line, re.I)
        pos, body = (m.group(1).lower().rstrip("."), m.group(2)) if m else ("", line)
        for s in re.split(r"[,，;；]", body):
            s = s.strip()
            if len(s) >= 2 and re.search(r"[\u4e00-\u9fff]", s):
                out.append((pos, s))
    return out


def norm_pos(p):
    m = {"vt": "v.", "vi": "v.", "v": "v.", "n": "n.", "a": "adj.", "adj": "adj.",
         "ad": "adv.", "adv": "adv.", "prep": "prep.", "conj": "conj.", "pron": "pron.",
         "num": "num.", "art": "det.", "int": "excl."}
    return m.get(p, p + "." if p and not p.endswith(".") else p)


def pos_ok(sense_pos, entry_pos):
    if not sense_pos:
        return True
    ep = {x.strip().rstrip(".") + "." for x in re.split(r"[,，/]", entry_pos) if x.strip()}
    sp = norm_pos(sense_pos)
    if sp in ep:
        return True
    if sp == "v." and any(e in ("v.", "vt.", "vi.") for e in ep):
        return True
    return False


def freq_of(ec, word):
    row = ec.get(word.strip().lower())
    if not row:
        return 0
    try:
        return int(row.get("frq") or 0)
    except ValueError:
        return 0


def tier_of(f):
    """口语频档：A=前3000，B=3000–12000，C=更少见/无数据"""
    if f == 0 or f > 12000:
        return "C"
    return "A" if f <= 3000 else "B"


def audit(proj, ec):
    rep = {}
    rep["total"] = len(proj)
    rep["unique"] = len({e["word"].strip().lower() for e in proj})

    # 跨级重复
    by_word = defaultdict(list)
    for e in proj:
        by_word[e["word"].strip().lower()].append(e)
    cross = {w: v for w, v in by_word.items() if len(v) > 1 and len({x["level"] for x in v}) > 1}
    rep["cross_level_dup"] = len(cross)

    # 同词不同级、释义完全相同（学习时会重复见到同一个词）
    same_cn = [w for w, v in cross.items() if len({x["cn"].strip() for x in v}) == 1]
    rep["cross_level_same_cn"] = len(same_cn)

    # 义项截断
    truncated = 0
    multi = 0
    for e in proj:
        row = ec.get(e["word"].strip().lower())
        if not row:
            continue
        ss = split_senses(row.get("translation"))
        if len(ss) <= 2:
            continue
        multi += 1
        own = [x.strip() for x in re.split(r"[／/，,；;]", POS_RE.sub("", e["cn"])) if len(x.strip()) >= 2]
        idxs = []
        for o in own:
            for i, (_, s) in enumerate(ss):
                if o in s or s in o:
                    idxs.append(i)
                    break
        if idxs and max(idxs) <= 1 and len(ss) - max(idxs) - 1 >= 2:
            truncated += 1
    rep["multi_sense"] = multi
    rep["truncated"] = truncated
    rep["truncated_pct"] = round(truncated / multi * 100, 1) if multi else 0

    # 短语按首词查错
    bad_phrases = []
    for e in proj:
        w = e["word"].strip()
        if " " not in w:
            continue
        whole = ec.get(w.lower())
        first = ec.get(w.split()[0].lower().strip(","))
        if not whole and first:
            bad_phrases.append((w, e["cn"], "整词不在词典，按首词查"))
        elif whole and first:
            wt = re.sub(r"\\n.*", "", whole.get("translation") or "")
            ft = re.sub(r"\\n.*", "", first.get("translation") or "")
            if wt and ft and e["cn"].strip() and e["cn"].strip() in ft and e["cn"].strip() not in wt:
                bad_phrases.append((w, e["cn"], "释义来自首词"))
    rep["phrase_total"] = sum(1 for e in proj if " " in e["word"].strip())
    rep["phrase_bad"] = len(bad_phrases)
    rep["phrase_bad_list"] = bad_phrases

    # 释义格式问题
    rep["has_vtvi"] = sum(1 for e in proj if re.search(r"vt\.|vi\.", e["cn"]))
    rep["has_slash"] = sum(1 for e in proj if "／" in e["cn"])
    rep["has_dots"] = sum(1 for e in proj if "..." in e["cn"])
    ti = [e for e in proj if any(b in e["cn"] for b, _ in TYPO)]
    rep["typos"] = len(ti)
    rep["typo_list"] = [(e["level"], e["word"], e["cn"]) for e in ti]
    rep["need_rewrite"] = sum(
        1 for e in proj if re.search(r"vt\.|vi\.", e["cn"]) or "／" in e["cn"]
    )

    # 分档
    rep["tier"] = dict(Counter(tier_of(freq_of(ec, e["word"])) for e in proj))
    rep["tier_by_level"] = {
        L: dict(Counter(tier_of(freq_of(ec, e["word"])) for e in proj if e["level"] == L))
        for L in LEVELS
    }
    rep["tierA_cross"] = dict(
        Counter(tier_of(freq_of(ec, e["word"])) for w, v in cross.items() for e in v)
    )

    # Oxford 核心表核对
    rep["in_oxford"] = sum(1 for e in proj if (ec.get(e["word"].strip().lower()) or {}).get("oxford") == "1")
    rep["not_in_oxford"] = rep["total"] - rep["in_oxford"]
    return rep


def emit_fix(proj, ec, out_path):
    """产出修复候选：短语整条替换 + 义项按词性展开到 3 条 + 错字修正"""
    fixed = []
    for e in proj:
        new_cn = e["cn"].strip()
        status = "keep"
        key = e["word"].strip().lower()

        if key in PHRASE_FIX:
            new_cn, status = PHRASE_FIX[key], "phrase"
        else:
            row = ec.get(key)
            if row:
                senses = split_senses(row.get("translation"))
                matched = [s for s in senses if pos_ok(s[0], e["pos"])] or senses
                uniq, seen = [], set()
                for _, s in matched[:3]:
                    for a, b in TYPO:
                        s = s.replace(a, b)
                    if s in seen:
                        continue
                    seen.add(s)
                    uniq.append(s)
                if uniq:
                    cand = "；".join(uniq)
                    if cand != new_cn:
                        new_cn, status = cand, f"expand({len(senses)}→{len(uniq)})"
        for a, b in TYPO:
            new_cn = new_cn.replace(a, b)
        fixed.append({**e, "cn_new": new_cn, "status": status})

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fixed, f, ensure_ascii=False, indent=1)
    return fixed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ecdict", required=True, help="ECDICT csv 路径")
    ap.add_argument("--emit-fix", action="store_true", help="产出修复候选 JSON")
    ap.add_argument("--out", default="/tmp/vocab-fix.json")
    args = ap.parse_args()

    proj = load_project()
    ec = load_ecdict(args.ecdict)
    rep = audit(proj, ec)

    print(f"词条总数        {rep['total']}   唯一词 {rep['unique']}")
    print(f"跨级重复        {rep['cross_level_dup']} 个词，其中 {rep['cross_level_same_cn']} 个释义完全相同")
    print(f"多义项词条      {rep['multi_sense']}")
    print(f"义项被截断      {rep['truncated']} ({rep['truncated_pct']}%)")
    print(f"短语条目        {rep['phrase_total']}，其中 {rep['phrase_bad']} 条释义来自首词/缺整词")
    for w, cn, why in rep["phrase_bad_list"]:
        print(f"    {w:16} 现={cn[:24]:26} {why}")
    print(f"旧式 vt./vi.    {rep['has_vtvi']}    带／多义 {rep['has_slash']}    含... {rep['has_dots']}")
    print(f"错别字          {rep['typos']}  {rep['typo_list'][:6]}")
    print(f"释义需重写      {rep['need_rewrite']} ({rep['need_rewrite']/rep['total']*100:.1f}%)")
    print(f"分档(A/B/C)     {rep['tier']}")
    for L in LEVELS:
        print(f"    {L} {rep['tier_by_level'][L]}")
    print(f"不在 Oxford 核心表 {rep['not_in_oxford']} ({rep['not_in_oxford']/rep['total']*100:.1f}%)")

    if args.emit_fix:
        fx = emit_fix(proj, ec, args.out)
        changed = sum(1 for x in fx if x["status"] != "keep")
        print(f"\n修复候选已写入 {args.out}：{changed} 条有改动")
        print("注意：自动展开只解决「主义缺失」，不能替代人工确定哪个是主义。")
        print("      A 档（口语前 3000）必须人工过一遍，约 2337 条。")


if __name__ == "__main__":
    main()
