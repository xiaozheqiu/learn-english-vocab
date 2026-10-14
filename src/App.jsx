import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { ALL, LEVELS, SIZES, loadAll, loadLevel, needOf } from "@/lib/data";
import { loadLocal, saveLocal } from "@/lib/sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import Pager from "@/components/Pager";
import PartOfSpeechGuide from "@/components/PartOfSpeechGuide";
import WordTable from "@/components/WordTable";

const VKEY = "ox5000-view-v1";

function readView() {
  try {
    const value = JSON.parse(sessionStorage.getItem(VKEY) || "{}");
    return { level: ALL.includes(value.level || value.lv) ? value.level || value.lv : "A1", mode: ["all", "todo", "done"].includes(value.mode) ? value.mode : "all", query: typeof value.query === "string" ? value.query : typeof value.kw === "string" ? value.kw : "", page: value.page > 0 ? Math.floor(value.page) : 1, size: SIZES.includes(value.size) ? value.size : 20 };
  } catch { return { level: "A1", mode: "all", query: "", page: 1, size: 20 }; }
}

function readGuide() {
  return typeof window !== "undefined" && window.location.hash === "#parts-of-speech";
}

export default function App() {
  const initial = useMemo(readView, []);
  const [level, setLevel] = useState(initial.level);
  const [mode, setMode] = useState(initial.mode);
  const [query, setQuery] = useState(initial.query);
  const [page, setPage] = useState(initial.page);
  const [size, setSize] = useState(initial.size);
  const [store, setStore] = useState({});
  const [done, setDone] = useState(() => loadLocal());
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("正在加载词表…");
  const [loadPercent, setLoadPercent] = useState(0);
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(() => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true));
  const [showGuide, setShowGuide] = useState(readGuide);

  const ensure = useCallback(async (target) => {
    const missing = needOf(target).filter((item) => !store[item]);
    if (!missing.length) { setLoading(false); return; }
    setLoading(true); setError(""); setLoadingMessage("正在加载词表…"); setLoadPercent(0);
    try {
      const entries = await Promise.all(missing.map(async (item) => [item, await loadLevel(item)]));
      setStore((current) => ({ ...current, ...Object.fromEntries(entries) }));
      setLoadPercent(100);
    } catch (loadError) { setError(`加载失败：${loadError?.message || loadError}`); } finally { setLoading(false); }
  }, [store]);

  useEffect(() => { ensure(query.trim() ? "ALL" : level); }, []);
  useEffect(() => { try { sessionStorage.setItem(VKEY, JSON.stringify({ level, mode, query, page, size, lv: level, kw: query })); } catch {} }, [level, mode, query, page, size]);
  useEffect(() => saveLocal(done), [done]);
  useEffect(() => {
    const onBeforeInstallPrompt = (event) => { event.preventDefault(); setInstallPrompt(event); };
    const onAppInstalled = () => { setInstallPrompt(null); setIsStandalone(true); };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt); window.removeEventListener("appinstalled", onAppInstalled); };
  }, []);
  useEffect(() => {
    const onHashChange = () => setShowGuide(readGuide());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const levelRows = useMemo(() => needOf(level).flatMap((item) => store[item] || []), [level, store]);
  const filtered = useMemo(() => {
    const source = query.trim() ? LEVELS.flatMap((item) => store[item] || []) : levelRows;
    const keyword = query.trim().toLowerCase();
    const matching = keyword ? source.filter((item) => item.w.toLowerCase().includes(keyword) || (item.cn || "").toLowerCase().includes(keyword)) : source;
    if (mode === "todo") return matching.filter((item) => !done.has(item._k));
    if (mode === "done") return matching.filter((item) => done.has(item._k));
    return matching;
  }, [done, levelRows, mode, query, store]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const visiblePage = Math.min(page, pages);
  const rows = filtered.slice((visiblePage - 1) * size, visiblePage * size);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const pickLevel = async (nextLevel) => { setLevel(nextLevel); setPage(1); await ensure(nextLevel); };
  const onSearch = async (event) => {
    const nextQuery = event.target.value; setQuery(nextQuery); setPage(1);
    if (nextQuery.trim() && LEVELS.some((item) => !store[item])) {
      setLoadingMessage("正在加载全部等级的词表以便搜索…"); setLoading(true);
      try { const all = await loadAll(); setStore((current) => ({ ...current, ...all })); } catch (loadError) { setError(`加载全部等级失败：${loadError?.message || loadError}`); } finally { setLoading(false); }
    }
  };
  const toggle = (key) => setDone((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const pickMode = (nextMode) => { setMode(nextMode); setPage(1); };
  const installApp = async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    setInstallPrompt(null);
    await prompt.prompt();
    await prompt.userChoice;
  };
  const openGuide = () => { window.location.hash = "parts-of-speech"; };
  const closeGuide = () => { window.location.hash = ""; };

  return <div className="min-h-screen bg-background text-foreground">
    <div className="fixed inset-x-0 top-0 z-50 h-0.5 bg-primary transition-all duration-300" style={{ width: loading ? `${Math.max(loadPercent, 8)}%` : "0%", opacity: loading ? 1 : 0 }} />
    <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      {showGuide ? <PartOfSpeechGuide onBack={closeGuide} /> : <>
      <section className="rounded-xl border border-primary/20 bg-primary/[0.045] p-3 shadow-soft sm:p-4" aria-label="词表筛选工具">
        <div className="flex flex-row items-center gap-2">
          <div className="hidden min-w-0 items-center gap-1 rounded-lg bg-muted p-1 md:flex">{ALL.map((item) => <Button key={item} type="button" variant={level === item ? "default" : "ghost"} size="sm" className="h-8 min-w-[48px] px-3" onClick={() => pickLevel(item)}>{item === "ALL" ? "全部" : item}</Button>)}</div>
          <label className="sr-only" htmlFor="level-select">词汇等级</label>
          <Select id="level-select" value={level} onChange={(event) => pickLevel(event.target.value)} className="w-[94px] shrink-0 md:hidden"><option value="A1">A1</option><option value="A2">A2</option><option value="B1">B1</option><option value="B2">B2</option><option value="C1">C1</option><option value="ALL">全部</option></Select>
          <div className="hidden items-center gap-1 rounded-lg bg-muted p-1 md:flex">{[["all", "全部"], ["todo", "未掌握"], ["done", "已掌握"]].map(([value, label]) => <Button key={value} type="button" variant={mode === value ? "default" : "ghost"} size="sm" className="h-8 px-3" onClick={() => pickMode(value)}>{label}</Button>)}</div>
          <label className="sr-only" htmlFor="mode-select">掌握状态</label>
          <Select id="mode-select" value={mode} onChange={(event) => pickMode(event.target.value)} className="w-[94px] shrink-0 md:hidden"><option value="all">全部</option><option value="todo">未掌握</option><option value="done">已掌握</option></Select>
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><label className="sr-only" htmlFor="word-search">搜索单词或释义</label><Input id="word-search" type="search" value={query} onChange={onSearch} placeholder="搜索单词或释义" className="pl-9" /></div>
        </div>
      </section>
      <section id="list" className="mt-4 scroll-mt-4">{error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-12 text-center text-sm text-destructive">{error}</div> : loading ? <div className="rounded-xl border border-border bg-card px-5 py-16 text-center text-sm text-muted-foreground">{loadingMessage}</div> : !filtered.length ? <div className="rounded-xl border border-dashed border-border bg-card px-5 py-16 text-center text-sm text-muted-foreground">没有匹配的词</div> : <WordTable rows={rows} done={done} start={(visiblePage - 1) * size} onToggle={toggle} />}</section>
      {!loading && !error && filtered.length > 0 && <Pager page={visiblePage} pages={pages} size={size} total={filtered.length} sizes={SIZES} onPage={setPage} onSize={(nextSize) => { setSize(nextSize); setPage(1); }} onOpenGuide={openGuide} />}
      </>}
      {installPrompt && !isStandalone && <div className="mt-3 flex justify-center"><Button type="button" variant="outline" size="sm" className="bg-card" onClick={installApp}><Download className="h-4 w-4" />安装应用</Button></div>}
    </main>
  </div>;
}
