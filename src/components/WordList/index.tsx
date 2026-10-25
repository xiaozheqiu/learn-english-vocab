import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, ListFilter, Sparkles } from "lucide-react";
import { BulkSheet } from "./BulkSheet";
import { FilterBar } from "./FilterBar";
import { Pager } from "./Pager";
import { WordRow as MemoRow } from "./WordRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { statusOf } from "@/lib/srs";
import { useSelection } from "@/hooks/useSelection";
import { usePageActive } from "@/hooks/usePageActive";
import type { VocabStore } from "@/hooks/useVocabStore";
import type { LevelFilter, MasteryFilter, PageSize, Word } from "@/lib/types";

export interface WordListPageProps {
  store: VocabStore;
  onGoReview: () => void;
  onGoQuiz: () => void;
}

/** 词表页（§5 F1 / §9 验收 2、3） */
export function WordListPage({ store, onGoReview, onGoQuiz }: WordListPageProps) {
  const active = usePageActive();
  const [level, setLevel] = useState<LevelFilter>(store.prefs.defaultLevel);
  const [mode, setMode] = useState<MasteryFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(store.prefs.pageSize);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPageSize(store.prefs.pageSize), [store.prefs.pageSize]);
  useEffect(() => setLevel(store.prefs.defaultLevel), [store.prefs.defaultLevel]);

  // 按等级 / 搜索加载分包
  // 只依赖稳定的 ensureLevels：依赖整个 store 会在每次 words 变化后重跑，形成自激循环
  const { ensureLevels } = store;
  useEffect(() => {
    void ensureLevels(query.trim() ? "ALL" : level);
  }, [ensureLevels, level, query]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    let source = store.words;
    /*
     * 搜索跨全部等级，不服从等级筛选。
     * 之前这里是「先按等级过滤再搜索」，结果搜 abandon（B2 词）在默认 A1 下永远是
     * 「没有匹配」—— 明明已经 loadAll 了全库，用户却以为词表里没这个词。
     */
    if (!keyword && level !== "ALL") source = source.filter((w) => w.level === level);
    if (keyword) {
      source = source.filter(
        (w) => w.word.toLowerCase().includes(keyword) || w.cn.toLowerCase().includes(keyword),
      );
    }
    if (mode === "todo") return source.filter((w) => !store.mastered.has(w.key));
    if (mode === "done") return source.filter((w) => store.mastered.has(w.key));
    return source;
  }, [level, mode, query, store.mastered, store.words]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const rows = useMemo(
    () => filtered.slice((current - 1) * pageSize, current * pageSize),
    [current, filtered, pageSize],
  );

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const pageKeys = useMemo(() => rows.map((w) => w.key), [rows]);
  const filteredKeys = useMemo(() => filtered.map((w) => w.key), [filtered]);
  const selection = useSelection(pageKeys, filteredKeys);

  const applyMastery = async (value: boolean) => {
    const keys = selection.scopedKeys();
    if (keys.length === 0) return;
    await store.toggleMastery(keys, value);
    selection.clear();
  };

  // Shift+↑↓ 扩选（§5 F1）。词表被切走后这条快捷键必须停用
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.shiftKey || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
      const focused = document.activeElement as HTMLElement | null;
      const key = focused?.dataset.key;
      if (!focused || !key) return;
      const index = pageKeys.indexOf(key);
      if (index < 0) return;
      const nextKey = pageKeys[event.key === "ArrowDown" ? index + 1 : index - 1];
      if (!nextKey) return;
      event.preventDefault();
      selection.toggle(nextKey, true);
      listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(nextKey)}"]`)?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, pageKeys, selection]);

  /*
   * 行状态按「渲染这一帧的时间戳」算，不再每行 new Date()。
   * 一页 500 行时那是 500 个 Date 对象；更重要的是同一屏里两行的「今天到期」
   * 判定不应该跨秒漂移。时间戳跟着 records/mastered 一起算，勾选后立刻刷新。
   */
  const nowMs = useMemo(() => Date.now(), [store.records, store.mastered]);
  const nowForStatus = useMemo(() => new Date(nowMs), [nowMs]);
  const statusFor = (word: Word) =>
    statusOf(store.records.get(word.key) ?? null, store.mastered.has(word.key), nowForStatus);

  /**
   * 掌握切换的稳定回调。行组件拿到的是同一个函数 + 自己的 key，
   * 这样 memo 生效；否则每次渲染 500 个行组件全部失效。
   */
  const onToggleMastery = useCallback(
    (key: string, next: boolean) => void store.toggleMastery([key], next),
    [store.toggleMastery],
  );

  const empty = !store.loadingWords && filtered.length === 0;

  return (
    <div className="flex min-h-full flex-col">
      <FilterBar
        level={level}
        mode={mode}
        defaultLevel={store.prefs.defaultLevel}
        query={query}
        pageSize={pageSize}
        total={filtered.length}
        onLevel={(next) => {
          setLevel(next);
          setPage(1);
        }}
        onMode={(next) => {
          setMode(next);
          setPage(1);
        }}
        onQuery={(next) => {
          setQuery(next);
          setPage(1);
        }}
        onPageSize={(next) => {
          setPageSize(next);
          setPage(1);
          void store.setPrefs({ pageSize: next });
        }}
      />

      {store.loadError && (
        <p
          className="m-3 rounded-card border border-danger/25 bg-danger-wash px-3 py-2 text-[13px] text-danger"
          role="alert"
        >
          {store.loadError}
        </p>
      )}

      {store.loadingWords && store.words.length === 0 ? (
        <div className="px-4 py-16 text-center text-[13px] text-ink-mute" role="status">
          正在加载 {level === "ALL" ? "全部等级" : level} 词表…
        </div>
      ) : empty ? (
        <EmptyState
          level={level}
          mode={mode}
          query={query}
          onReset={() => {
            setQuery("");
            setMode("all");
            setLevel("ALL");
          }}
        />
      ) : (
        <>
          <div
            className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-paper/95 px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-mute backdrop-blur"
            role="row"
          >
            <span className="flex w-[18px] justify-center">
              <Checkbox
                checked={selection.pageState}
                onCheckedChange={(value) => selection.selectPage(value === true)}
                aria-label={
                  selection.pageState === true
                    ? `取消全选本页 ${pageKeys.length} 条`
                    : `全选本页 ${pageKeys.length} 条`
                }
              />
            </span>
            <span className="w-6 text-right">#</span>
            <span className="flex-1">
              单词 <span className="normal-case tracking-normal">/ 释义</span>
            </span>
            <span className="hidden lg:inline">排期</span>
          </div>

          <div
            ref={listRef}
            role="grid"
            aria-label="词表"
            data-testid="word-grid"
            aria-rowcount={filtered.length}
            className="flex-1 bg-card"
          >
            {rows.map((word, index) => (
              <MemoRow
                key={word.key}
                word={word}
                index={(current - 1) * pageSize + index + 1}
                status={statusFor(word)}
                checked={selection.keys.has(word.key)}
                onToggleSelect={selection.toggle}
                // 交给行自己带 key 回调，父组件不再为每行新建闭包
                onToggleMastery={onToggleMastery}
              />
            ))}
          </div>

          <Pager page={current} pages={pages} total={filtered.length} onPage={setPage} />
          {/* 给右下角浮动按钮和底部导航留出安全距离 */}
        </>
      )}

      {!empty && (
        <BulkSheet
          selectedCount={selection.keys.size}
          pageCount={pageKeys.length}
          filteredCount={filteredKeys.length}
          offFilterCount={selection.offFilterCount}
          scope={selection.scope}
          onScopeChange={selection.setScope}
          onSelectPage={() => selection.selectPage(true)}
          onClearPage={() => selection.selectPage(false)}
          onSelectFiltered={() => selection.selectFiltered(true)}
          onInvert={selection.invert}
          onClear={selection.clear}
          onMarkMastered={() => void applyMastery(true)}
          onUnmarkMastered={() => void applyMastery(false)}
        />
      )}

      {empty && (
        <div className="flex justify-center gap-2 pb-6">
          <Button variant="outline" size="touch" onClick={onGoQuiz}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            去测试
          </Button>
          <Button size="touch" onClick={onGoReview}>
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            开始复习
          </Button>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  level,
  mode,
  query,
  onReset,
}: {
  level: LevelFilter;
  mode: MasteryFilter;
  query: string;
  onReset: () => void;
}) {
  const scope = level === "ALL" ? "全库" : level;
  const reason = query
    ? `没有匹配「${query}」的词`
    : mode === "done"
      ? `${scope} 还没有标记已掌握的词`
      : `${scope} 里没有符合条件的词`;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <ListFilter className="h-8 w-8 text-ink-mute" aria-hidden="true" />
      <p className="text-[14px] font-medium text-ink">{reason}</p>
      <p className="text-[13px] text-ink-soft">换个筛选条件，或回到全库继续找。</p>
      <Button variant="outline" size="touch" onClick={onReset}>
        清空筛选
      </Button>
    </div>
  );
}
