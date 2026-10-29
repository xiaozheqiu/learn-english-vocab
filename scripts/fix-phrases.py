#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复 data/*.js 里按首词误查的多词短语释义（唯一可以全自动的一类）。

只改 11 条短语里的错译，不动其他任何字段，不重排顺序。
用法：
  python3 scripts/fix-phrases.py --dry-run     # 只看会改什么
  python3 scripts/fix-phrases.py --apply       # 真正写入 data/*.js
"""
import argparse, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = ["A1", "A2", "B1", "B2", "C1"]

# 整词正确释义（按 Oxford/剑桥的短语口径，不用首词释义）
FIX = {
    "have to": "不得不；必须",
    "next to": "紧挨着；在…旁边；仅次于",
    "no one": "没有人",
    "ice cream": "冰淇淋",
    "all right": "没问题；还好；好吧",
    "any more": "不再",
    "according to": "根据；按照；据…所说",
    "per cent": "百分之…",
    "used to": "过去常常；曾经",
    "a, an": "一个（不定冠词）",
    "one number/": "一（数词）",
}


def read_rows(path):
    """把 data/X.js 读成 JS 数组（用 node 求值，保证与运行时同一份）"""
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
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + "\nwindow.OX = window.OX || {};\n")
        level = os.path.basename(path).split(".")[0]
        f.write(f"window.OX.{level} = {body};\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    apply = args.apply and not args.dry_run

    changed_total = 0
    for L in LEVELS:
        path = os.path.join(ROOT, "data", f"{L}.js")
        with open(path, encoding="utf-8") as f:
            header = f.readline().rstrip("\n")
        rows = read_rows(path)
        changed = []
        for r in rows:
            w = str(r[0]).strip().lower()
            if w in FIX and str(r[2]).strip() != FIX[w]:
                changed.append((r[0], r[2], FIX[w]))
                r[2] = FIX[w]
        if changed:
            changed_total += len(changed)
            print(f"{L}: {len(changed)} 条")
            for w, old, new in changed:
                print(f"   {w:14} {old[:26]:28} → {new}")
            if apply:
                write_rows(path, rows, header)
        else:
            print(f"{L}: 无变化")
    print(f"\n合计 {changed_total} 条{'（已写入）' if apply else '（dry-run，未写入）'}")


if __name__ == "__main__":
    main()
