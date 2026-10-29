#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Oxford Learner's Dictionaries 抓取权威义项，产出 data/oxford/senses.json.gz

为什么需要这个脚本在这里：
  data/*.js 的旧释义来自金山/词霸系词典，构建时又被截成「第一行前 2 个义项」，
  44.2% 的多义词因此丢了现代常用义（stock → 树干，browser → 吃嫩叶的动物）。
  唯一可信的修法是用牛津原文重做，而这个重做过程必须可复现。

抓取规则（实测得出，缺一条就会漏数据）：
  1. URL 一律小写：I → i，April → april，TV → tv
  2. 空格转连字符：ice cream → ice-cream
  3. 同形异义词分页：lead → lead_1/lead_2；但也存在无下划线的 affect1
     → 主页面上直接列出同形词链接，解析 href 一次拿全，比盲试快 10 倍
  4. 短语动词用连字符且独立成页：consist-of / rely-on / ought-to / o-clock
  5. 每个 <li class="sense"> 归到它前面最近的 <span class="pos">，这样每条义项
     都带正确词性 —— 不按词性切分会导致名词义和动词义混在一起

用法：
  python3 scripts/fetch-oxford.py            # 全量抓取，约 25 分钟
  python3 scripts/fetch-oxford.py --resume   # 断点续跑
  python3 scripts/fetch-oxford.py --report   # 只打印已抓数据的统计
"""
import argparse, gzip, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "oxford", "senses.json.gz")
CACHE = os.path.join(ROOT, "data", "oxford", ".cache.json")
LEVELS = ["A1", "A2", "B1", "B2", "C1"]

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
BASE = "https://www.oxfordlearnersdictionaries.com/definition/english/"
POS_RE = re.compile(r'<span class="pos"[^>]*>(.*?)</span>', re.S)

# 牛津里被拆成独立页的短语动词 / 特殊词条
PHRASE_PAGES = {
    "consist": "consist-of", "deprive": "deprive-of", "derive": "derive-from",
    "devote": "devote-to", "rely": "rely-on", "ought": "ought-to",
    "o'clock": "o-clock", "proceedings": "proceeding",
    "a, an": "a", "one number/": "one", "accused": "accuse",
}


def load_project_words():
    """读 data/*.js 里的所有词条（它们不是模块，用 node 求值最稳）"""
    import subprocess
    js = r'''
const fs=require("fs"),vm=require("vm");
let out=[];
for(const L of ["A1","A2","B1","B2","C1"]){
  const sb={window:{}};vm.createContext(sb);
  vm.runInContext(fs.readFileSync(`data/${L}.js`,"utf8"),sb);
  sb.window.OX[L].forEach(r=>out.push(String(r[0]).trim()));
}
console.log(JSON.stringify(out));'''
    res = subprocess.run(["node", "-e", js], capture_output=True, text=True, cwd=ROOT)
    if res.returncode != 0:
        sys.exit(f"读取 data/*.js 失败：{res.stderr[:300]}")
    return sorted(set(json.loads(res.stdout)))


def get(slug):
    req = urllib.request.Request(BASE + urllib.parse.quote(slug),
                                 headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1.5)
        except Exception:
            time.sleep(1.5)
    return None


def parse_by_pos(h):
    """把每条 sense 归到它前面最近的 pos 区块，保证义项级词性正确"""
    marks = [(m.start(), html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip())
             for m in POS_RE.finditer(h)]
    senses = []
    for m in re.finditer(r'<li class="sense"', h):
        start = m.start()
        head = h[start:start + 500]
        cur = ""
        for pos, name in marks:
            if pos < start:
                cur = name
            else:
                break
        cefr = re.search(r'cefr="([a-c][12])"', head)
        d = re.search(r'<span class="def"[^>]*>(.*?)</span>', h[start:start + 3000], re.S)
        if not d:
            continue
        text = html.unescape(re.sub(r"<[^>]+>", "", d.group(1))).strip()
        if not text:
            continue
        senses.append({"def": text, "pos": cur, "cefr": cefr.group(1) if cefr else "",
                       "ox3000": 'ox3000="y"' in head, "ox5000": 'ox5000="y"' in head})
    phon = [html.unescape(re.sub(r"<[^>]+>", "", p)).strip()
            for p in re.findall(r'<span class="phon"[^>]*>(.*?)</span>', h)]
    return senses, phon[:2]


def homograph_slugs(h, base):
    """主页面上列出的同形词页，一次请求拿全"""
    links = re.findall(r'/definition/english/([a-z0-9_\-]+)"', h)
    pat = re.compile(rf"^{re.escape(base)}(_\d+)?$")
    return [x for x in dict.fromkeys(links) if pat.match(x)]


def scrape(word):
    w = word.strip().lower().replace(" ", "-")
    if "," in word:
        w = word.strip().lower().replace(",", "").strip().replace(" ", "-")
    if "number/" in word:
        w = word.lower().replace("number/", "").strip()

    h = get(w)
    slugs = []
    if w in PHRASE_PAGES:
        slugs.append(PHRASE_PAGES[w])
    if h:
        slugs += homograph_slugs(h, w) or [w]
    else:
        slugs += [w] + [f"{w}_{i}" for i in range(1, 7)] + [f"{w}{i}" for i in range(1, 4)]
    if word == "a, an":
        slugs = ["a", "an"]

    merged, phon = [], []
    for sl in dict.fromkeys(slugs):
        hh = h if (h and sl == w) else get(sl)
        if not hh:
            continue
        s, ph = parse_by_pos(hh)
        merged += s
        if not phon:
            phon = ph

    seen, senses = set(), []
    for s in merged:
        key = (s["def"], s["pos"])
        if key in seen:
            continue
        seen.add(key)
        senses.append(s)
    return {"phon": phon, "senses": senses}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--workers", type=int, default=14)
    args = ap.parse_args()

    out = {}
    # report 和 resume 都需要读已有缓存；只有全量重抓时才跳过
    if (args.resume or args.report) and os.path.exists(CACHE):
        out = json.load(open(CACHE))

    if args.report:
        n = sum(len(v["senses"]) for v in out.values())
        print(f"已抓 {len(out)} 词，{n} 义项")
        missing = [w for w, v in out.items() if not v["senses"]]
        print(f"无释义 {len(missing)}: {missing[:20]}")
        return

    words = load_project_words()
    todo = [w for w in words if w not in out]
    print(f"总 {len(words)}  已有 {len(out)}  待抓 {len(todo)}", flush=True)

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for w, rec in ex.map(lambda x: (x, scrape(x)), todo):
            out[w] = rec
            done += 1
            if done % 400 == 0:
                json.dump(out, open(CACHE, "w"), ensure_ascii=False)
                print(f"  {done}/{len(todo)}", flush=True)

    json.dump(out, open(CACHE, "w"), ensure_ascii=False)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    raw = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode()
    open(OUT, "wb").write(gzip.compress(raw, 9))

    ok = sum(1 for v in out.values() if v["senses"])
    total_senses = sum(len(v["senses"]) for v in out.values())
    print(f"\n完成：{ok}/{len(out)} 词有释义，共 {total_senses} 义项")
    print(f"已写入 {OUT}（{os.path.getsize(OUT)/1024/1024:.2f} MB）")


if __name__ == "__main__":
    main()
