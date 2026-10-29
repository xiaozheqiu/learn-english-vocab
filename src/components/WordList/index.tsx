import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, ListFilter } from "lucide-react";
import { BulkSheet } from "./BulkSheet";
import { FilterBar, type FilterDraft } from "./FilterBar";
import { Pager } from "./Pager";
import { ScopeProgress } from "./ScopeProgress";
import { WordRow as MemoRow } from "./WordRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  filterWords,
  loadListView,
  saveListView,
  scopeProgress,
  type ListCriteria,
  type ListView,
  type CefrFilter,
  type OxfordFilter,
  type TierFilter,
} from "@/lib/listView";
import { useSelection } from "@/hooks/useSelection";
import { usePageActive } from "@/hooks/usePageActive";
import type { VocabStore } from "@/hooks/useVocabStore";
import type { LevelFilter, MasteryFilter, PageSize } from "@/lib/types";

export interface WordListPageProps {
  store: VocabStore;
}

/** 词表页（§5 F1 / §9 验收 2、3） */
export function WordListPage({ store }: WordListPageProps) {
  const active = usePageActive();
  /**
   * 筛选条件 + 页码整体是一个视图对象，并且持久化。
   *
   * 之前 level / mode / query / page 是四个独立的 useState：切 tab 靠常驻面板
   * 侥幸留着，一旦刷新、或被系统回收后重新打开，全部回到「默认等级 · 第 1 页」——
   * 从第 1 页翻到第 3 页再刷新，等于从头再筛一遍。现在以 localStorage 为初值，
   * 每次变化写回（隐私模式下写失败就退回纯内存行为，不影响使用）。
   */
  const [view, setView] = useState<ListView>(() => loadListView(store.prefs.defaultLevel));
  const [pageSize, setPageSize] = useState<PageSize>(store.prefs.pageSize);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => saveListView(view), [view]);
  useEffect(() => setPageSize(store.prefs.pageSize), [store.prefs.pageSize]);

  /**
   * 偏好里的「默认等级」被用户改过才跟着切，并且跳过首次执行：
   * 首次必须用恢复出来的视图，否则持久化的等级会被默认值当场覆盖。
   */
  const seenDefaultLevel = useRef(store.prefs.defaultLevel);
  useEffect(() => {
    if (seenDefaultLevel.current === store.prefs.defaultLevel) return;
    seenDefaultLevel.current = store.prefs.defaultLevel;
    setView((current) => ({ ...current, level: store.prefs.defaultLevel, page: 1 }));
  }, [store.prefs.defaultLevel]);

  // 按等级 / 搜索加载分包
  // 只依赖稳定的 ensureLevels：依赖整个 store 会在每次 words 变化后重跑，形成自激循环
  const { ensureLevels } = store;
  useEffect(() => {
    void ensureLevels(view.query.trim() ? "ALL" : view.level);
  }, [ensureLevels, view.level, view.query]);

  const filtered = useMemo(
    () => filterWords(store.words, view, store.mastered),
    [store.mastered, store.words, view],
  );

  /**
   * 抽屉里的预览条数：按**草稿**条件算，不吃已生效的条件。
   * 只读 words / mastered / query，所以搜索框每敲一个字不会连带重算一遍筛选结果。
   */
  const countFor = useCallback(
    (
      level: LevelFilter,
      mode: MasteryFilter,
      tier: TierFilter,
      cefr: CefrFilter,
      oxford: OxfordFilter,
    ) => {
      const criteria: ListCriteria = { level, mode, tier, cefr, oxford, query: view.query };
      return filterWords(store.words, criteria, store.mastered).length;
    },
    [store.mastered, store.words, view.query],
  );

  /**
   * 板块掌握进度：分母是板块总词数，不吃搜索词与掌握筛选。
   * 搜索时列表本来就跨等级，进度也跟着报全库，否则数字和列表对不上。
   */
  const progressScope: LevelFilter = view.query.trim() ? "ALL" : view.level;
  const progress = useMemo(
    () => scopeProgress(store.words, progressScope, store.mastered),
    [progressScope, store.mastered, store.words],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(view.page, pages);
  const rows = useMemo(
    () => filtered.slice((current - 1) * pageSize, current * pageSize),
    [current, filtered, pageSize],
  );

  /*
   * 页码越界（筛选变了 / 每页条数变小）时收回来。
   *
   * 必须等词表加载完再收敛：首帧 filtered 还是空数组，pages 算出来是 1，
   * 这里会把持久化恢复出来的 page:3 当场改成 1 —— 表现为「刷新后回到第 1 页」。
   * 加载完成前 pages 没有意义，跳过即可。
   */
  const listLoaded = !store.loadingWords || store.words.length > 0;
  useEffect(() => {
    if (!listLoaded) return;
    if (view.page > pages) setView((value) => ({ ...value, page: pages }));
  }, [listLoaded, pages, view.page]);

  const setPage = useCallback((page: number) => {
    setView((value) => ({ ...value, page: Math.max(1, page) }));
  }, []);

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

  /**
   * 掌握切换的稳定回调。行组件拿到的是同一个函数 + 自己的 key，
   * 这样 memo 生效；否则每次渲染全部行组件失效。
   */
  const onToggleMastery = useCallback(
    (key: string, next: boolean) => void store.toggleMastery([key], next),
    [store.toggleMastery],
  );

  const loading = store.loadingWords && store.words.length === 0;
  const empty = !store.loadingWords && filtered.length === 0;

  /**
   * 「确定」才生效：等级 / 掌握状态 / 每页条数一次性提交，页码回到第 1 页。
   * 抽屉里的点击只改草稿，所以在按下确定之前列表一行都没动。
   */
  const onApplyFilter = useCallback(
    (next: FilterDraft) => {
      setView((value) => ({
        ...value,
        level: next.level,
        mode: next.mode,
        tier: next.tier,
        cefr: next.cefr,
        oxford: next.oxford,
        page: 1,
      }));
      if (next.pageSize !== pageSize) {
        setPageSize(next.pageSize);
        void store.setPrefs({ pageSize: next.pageSize });
      }
    },
    [pageSize, store],
  );

  const resetAll = useCallback(() => {
    setView((value) => ({
      ...value,
      level: "ALL",
      mode: "all",
      tier: "all",
      cefr: "all",
      oxford: "all",
      query: "",
      page: 1,
    }));
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <FilterBar
        level={view.level}
        mode={view.mode}
        tier={view.tier}
        cefr={view.cefr}
        oxford={view.oxford}
        defaultLevel={store.prefs.defaultLevel}
        query={view.query}
        pageSize={pageSize}
        countFor={countFor}
        onQuery={(next) => setView((value) => ({ ...value, query: next, page: 1 }))}
        onApply={onApplyFilter}
      />

      {store.loadError && (
        <p
          className="m-3 rounded-card border border-danger/25 bg-danger-wash px-3 py-2 text-[13px] text-danger"
          role="alert"
        >
          {store.loadError}
        </p>
      )}

      {loading ? (
        <div className="px-4 py-16 text-center text-[13px] text-ink-mute" role="status">
          正在加载 {view.level === "ALL" ? "全部等级" : view.level} 词表…
        </div>
      ) : (
        <>
          {/* 板块进度常驻（空态也显示）：筛选结果为空时更需要知道「这个板块本来有多少」 */}
          <ScopeProgress progress={progress} />

          {empty ? (
            <EmptyState level={view.level} mode={view.mode} query={view.query} onReset={resetAll} />
          ) : (
            <>
              <div
                className="flex items-center gap-2.5 border-b border-line bg-paper/95 px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-mute backdrop-blur"
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
                <span className="hidden lg:inline">掌握</span>
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
                    mastered={store.mastered.has(word.key)}
                    checked={selection.keys.has(word.key)}
                    onToggleSelect={selection.toggle}
                    // 交给行自己带 key 回调，父组件不再为每行新建闭包
                    onToggleMastery={onToggleMastery}
                  />
                ))}
              </div>

              <Pager page={current} pages={pages} total={filtered.length} onPage={setPage} />
            </>
          )}
        </>
      )}

      {!empty && !loading && (
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

      {/* 空态下只给一条出口：此刻唯一想做的是「换个条件」 */}
      {empty && (
        <div className="flex justify-center pb-6">
          <Button variant="outline" size="touch" onClick={resetAll}>
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            清空筛选
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
