import { Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const IS_MOBILE = typeof navigator !== "undefined" && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
const TRANS_DESKTOP = "https://fanyi.baidu.com/mtpe-individual/transText?query=";
const TRANS_MOBILE = "https://fanyi.baidu.com/m/trans?from=en&to=zh&query=";
const transUrl = (word) => (IS_MOBILE ? TRANS_MOBILE : TRANS_DESKTOP) + encodeURIComponent(word) + (IS_MOBILE ? "" : "&lang=en2zh");

function MasteryCheckbox({ checked, onChange }) {
  return <label className="relative inline-flex h-6 w-6 cursor-pointer items-center justify-center">
    <input type="checkbox" checked={checked} onChange={onChange} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" aria-label={checked ? "取消标记已掌握" : "标记为已掌握"} />
    <span className="pointer-events-none flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-transparent shadow-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground"><Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" /></span>
  </label>;
}

function WordLink({ word, done }) {
  return <a href={transUrl(word)} target={IS_MOBILE ? undefined : "_blank"} rel={IS_MOBILE ? undefined : "noopener noreferrer"} className={cn("group inline-flex items-center gap-1 font-semibold text-slate-900 underline-offset-4 hover:text-primary hover:underline", done && "text-slate-500 hover:text-slate-600")}>{word}<ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" /></a>;
}

export default function WordTable({ rows, done, start, onToggle }) {
  return <>
    <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-soft md:block">
      <table className="w-full border-collapse text-left">
        <thead className="bg-accent/65 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-foreground"><tr><th className="w-16 px-5 py-3">#</th><th className="px-4 py-3">单词</th><th className="px-4 py-3">中文释义</th><th className="w-20 px-4 py-3 text-center">状态</th></tr></thead>
        <tbody className="divide-y divide-border/70">{rows.map((word, index) => { const isDone = done.has(word._k); return <tr key={word._k} className={cn("transition-colors hover:bg-accent/35", isDone && "bg-emerald-50/70")}>
          <td className="px-5 py-3.5 align-middle text-xs tabular-nums text-muted-foreground">{start + index + 1}</td>
          <td className="px-4 py-3.5 align-middle"><div className="flex items-baseline gap-2"><WordLink word={word.w} done={isDone} /><span className="text-xs text-muted-foreground">{word.p}</span></div></td>
          <td className={cn("px-4 py-3.5 align-middle text-sm text-slate-700", isDone && "text-slate-400")}>{word.cn}{word.sn && <span className="ml-2 text-xs text-muted-foreground">（{word.sn}）</span>}</td>
          <td className="px-4 py-3.5 text-center align-middle"><MasteryCheckbox checked={isDone} onChange={() => onToggle(word._k)} /></td>
        </tr>; })}</tbody>
      </table>
    </div>
    <div className="space-y-2 md:hidden">{rows.map((word, index) => { const isDone = done.has(word._k); return <article key={word._k} className={cn("relative rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm", isDone && "border-emerald-200 bg-emerald-50/70")}>
      <div className="flex items-start gap-3 pr-9"><span className="mt-0.5 w-7 shrink-0 text-xs tabular-nums text-muted-foreground">{start + index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><WordLink word={word.w} done={isDone} /><span className="text-xs text-muted-foreground">{word.p}</span></div><p className={cn("mt-1.5 text-sm leading-6 text-slate-700", isDone && "text-slate-400")}>{word.cn}{word.sn && <span className="ml-1.5 text-xs text-muted-foreground">（{word.sn}）</span>}</p></div></div>
      <div className="absolute right-3 top-3.5"><MasteryCheckbox checked={isDone} onChange={() => onToggle(word._k)} /></div>
    </article>; })}</div>
  </>;
}
