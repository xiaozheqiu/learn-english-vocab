#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复 data/*.js 里被「同一条牛津英文定义」连带撞车的中文释义。

## 为什么会有这个文件

抓取时 `<span class="def">` 里还可能嵌着内层 span，`fetch-oxford.py` 正则取到
的英文定义会被截断。最典型的一处：ankle / knee / elbow / wrist 的首义都是
`the joint`（原文分别是 "the joint connecting the foot with the leg" 之类），
而翻译阶段按「同一句英文 → 同一句中文」做去重，于是膝盖、手肘、手腕全成了踝。

一共 26 组、58 条。逐条改成人能背的释义，顺手修 `him`（释义写成了「她」）。

## 与 scripts/fix-phrases.py 的关系

那个脚本只修「按首词误查」的多词短语，这个只修「同英文定义连带撞车」的单词，
两边的词表不重叠 —— 唯一的交集是 `no one`：这里保留「没有人；无人」，
那边写「没有人」，任一版都不与 `nobody` 撞车，谁后跑都不会把结果改回撞车状态。

## 用法

  python3 scripts/fix-glosses.py --dry-run   # 只看会改什么
  python3 scripts/fix-glosses.py --apply     # 真正写入 data/*.js
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = ["A1", "A2", "B1", "B2", "C1"]

# 组别注释写明「为什么这样分」：同组内必须互不撞车，且每条都要能和同组其他词区分开。
# 顺序对齐 data/*.js 里的出现顺序，方便对照。
FIX = {
    # 1. 公寓：apartment 美式，flat 英式且兼形容词
    "apartment": "公寓；一套房间",
    "flat": "（英式）公寓；平的",
    # 2. 每个人：everyone 略正式
    "everybody": "每个人；大家",
    "everyone": "每个人；人人",
    # 3. 极好：outstanding 另有「未付款/未解决」义
    "fantastic": "极好的；（口语）棒极了",
    "outstanding": "杰出的；未解决的",
    # 4. 花园 / 院子：yard 是美式「院子」
    "garden": "花园；菜园",
    "yard": "院子；庭院（美式）",
    # 5. 问候：welcome 的核心是「欢迎」不是「你好」
    "hello": "你好；喂",
    "welcome": "欢迎；受欢迎的",
    # 6. 无人：nobody 另有「小人物」义
    "no one": "没有人；无人",
    "nobody": "没有人；小人物",
    # 7. 程度副词：quite 英式可表「完全」，somewhat 只到「有点儿」
    "quite": "相当；完全地",
    "somewhat": "有点儿；稍微",
    # 8. 能力：competence 指「胜任某职务的能力」
    "skill": "技能；技巧",
    "competence": "能力；胜任",
    # 9. 某人：somebody 另有「大人物」义
    "somebody": "某人；有人",
    "someone": "某人（略正式）；某人",
    # 10. 关节：这一组的英文定义全被截成 "the joint"，是本次最硬的错
    "ankle": "脚踝；踝",
    "knee": "膝盖；膝关节",
    "elbow": "肘部；手肘",
    "wrist": "手腕；腕关节",
    # 11. 糟糕：awful 更偏「极坏」，nasty 偏「恶劣伤人」
    "awful": "糟糕的；极坏的",
    "nasty": "恶劣的；令人不快的",
    # 12. 罪犯：offender 泛指违法/冒犯者，未必定罪
    "criminal": "罪犯；犯罪的",
    "offender": "违法者；冒犯者",
    # 13. 极好三兄弟：fabulous 源自「寓言般」，super 是「超级」
    "excellent": "优秀的；极好的",
    "fabulous": "极好的；神话般的",
    "super": "超级的；极好的",
    # 14. 卡车：英式 lorry / 美式 truck
    "lorry": "卡车（英式）；货车",
    "truck": "卡车（美式）；货车",
    # 15. 声音大：loud 指音量，noisy 指吵杂
    "loud": "响亮的；大声的",
    "noisy": "吵闹的；嘈杂的",
    # 16. 关系：relation 更常指「关联 / 亲属」
    "relationship": "关系；恋爱关系",
    "relation": "关联；亲属",
    # 17. 运输：transportation 是美式的「运输系统」
    "transport": "运输；交通工具",
    "transportation": "运输系统；运输业",
    # 18. 当…时：whilst 是英式书面变体
    "while": "当…时；然而",
    "whilst": "当…时（英式书面）",
    # 19. 布：fabric 另有「结构」义
    "cloth": "布；布料",
    "fabric": "织物；结构",
    # 20. 人们：humanity 是「人类 / 人性」
    "folk": "人们；民间的",
    "humanity": "人类；人性",
    # 21. 明显：apparent 有「表面上的」这一层，恰好与 obvious 相反
    "obvious": "明显的；显而易见的",
    "apparent": "表面上的；明显的",
    # 22. 完全：五个副词各有搭配偏好，释义必须能分开
    "perfectly": "完全地；完美地",
    "totally": "完全；彻底地",
    "fully": "充分地；完全地",
    "utterly": "极其；彻底地",
    "wholly": "完全；全部地",
    # 23. 指控：accused 是名词「被告」
    "accuse": "指控；控告",
    "accused": "被告；被指控的",
    # 24. 发言人：spokesman 特指男性
    "spokesman": "男发言人",
    "spokesperson": "发言人（不分性别）",
    # 25. 足够：sufficiently 是副词
    "sufficient": "足够的；充分的",
    "sufficiently": "充分地；足够地",
    # 26. 残暴：brutal 偏「残忍」，vicious 偏「恶毒 / 凶猛」
    "brutal": "残忍的；野蛮的",
    "vicious": "恶毒的；凶猛的",
    # 附：不属于上面任何一组，但同属「释义指向了别的词」的硬错
    "him": "他（宾格）；祂（指上帝）",
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

    seen = set()
    changed_total = 0
    for L in LEVELS:
        path = os.path.join(ROOT, "data", f"{L}.js")
        with open(path, encoding="utf-8") as f:
            header = f.readline().rstrip("\n")
        rows = read_rows(path)
        changed = []
        for r in rows:
            w = str(r[0]).strip()
            if w not in FIX:
                continue
            seen.add(w)
            if str(r[2]).strip() != FIX[w]:
                changed.append((w, r[2], FIX[w]))
                r[2] = FIX[w]
        if changed:
            changed_total += len(changed)
            print(f"{L}: {len(changed)} 条")
            for w, old, new in changed:
                print(f"   {w:14} {old[:24]:26} → {new}")
            if apply:
                write_rows(path, rows, header)
        else:
            print(f"{L}: 无变化")

    missing = sorted(set(FIX) - seen)
    if missing:
        sys.exit(f"\n词表里找不到这些词，检查拼写：{', '.join(missing)}")

    print(f"\n合计 {changed_total} 条{'（已写入）' if apply else '（dry-run，未写入）'}")


if __name__ == "__main__":
    main()
