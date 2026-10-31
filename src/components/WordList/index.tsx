import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListFilter } from "lucide-react";
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
  type InitialFilter,
  type ListCriteria,
  type ListView,
  type PosFilter,
} from "@/lib/listView";
import { useSelection } from "@/hooks/useSelection";
import { usePageActive } from "@/hooks/usePageActive";
import { useScrollKeeper } from "@/hooks/useScrollKeeper";
import type { VocabStore } from "@/hooks/useVocabStore";
import { LEVELS, type LevelFilter, type MasteryFilter, type PageSize } from "@/lib/types";

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
  /**
   * 跨等级浏览只发生在搜索上：搜一个词时不该被「当前停在 A1」挡住。
   * 首字母不在此列 —— 它是普通筛选条件，在当前等级内生效（见 lib/listView.ts）。
   */
  const searching = Boolean(view.query.trim());
  useEffect(() => {
    void ensureLevels(searching ? "ALL" : view.level);
  }, [ensureLevels, searching, view.level]);

  /**
   * 视图带档位 / 牛津条件时，索引必须补齐后才算数。
   *
   * 这是持久化视图的兜底：用户上次停在「认脸档」，刷新时首屏快路径给的
   * tier 全是默认 core，不等索引就会先闪一屏「0 条」。
   */
  const { ensureIndexes } = store;
  useEffect(() => {
    if (view.tier === "all" && view.oxford === "all") return;
    void ensureIndexes();
  }, [ensureIndexes, view.tier, view.oxford]);

  const filtered = useMemo(
    () => filterWords(store.words, view, store.mastered),
    [store.mastered, store.words, view],
  );

  /**
   * 抽屉里的预览条数：按**草稿**条件算，不吃已生效的条件。
   * 只读 words / mastered，所以搜索框每敲一个字不会连带重算一遍筛选结果。
   */
  const countFor = useCallback(
    (criteria: ListCriteria) => filterWords(store.words, criteria, store.mastered).length,
    [store.mastered, store.words],
  );

  /**
   * 板块掌握进度：分母是板块总词数，不吃搜索词与掌握筛选。
   * 搜索时列表本来就跨等级，进度也跟着报全库，否则数字和列表对不上。
   */
  const progressScope: LevelFilter = searching ? "ALL" : view.level;
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
   * 当前视图要的等级，数据是不是已经进了 state。
   *
   * 判据必须看 `store.words`，不能看 `isLoaded()`：后者在模块 import 完成时就
   * 变 true，而 setWords 要到下一轮渲染才生效 —— 中间那一帧 filtered 仍是空，
   * 页码会被当成越界夹回第 1 页，持久化的第 3 页当场丢失。
   *
   * 看 state 就没有这个时间差：state 里有这个等级的词，才可能存在「有结果但被
   * 判成空」的情况。首屏只加载默认等级（见 useVocabStore），所以停在 A2 的人
   * 刷新时会先显示加载态，等 A2 真到了再判定页码与空态。
   */
  const loadedLevels = useMemo(() => {
    const levels = new Set<string>();
    for (const word of store.words) levels.add(word.level);
    return levels;
  }, [store.words]);
  /**
   * 档位 / 牛津这两维读的是索引，索引没补齐时它们的结果不可信 ——
   * 那种情况一律当「还没加载」，宁可多转一秒圈，也不要先报一个假的「0 条」。
   */
  const viewNeedsIndexes = view.tier !== "all" || view.oxford !== "all";
  const scopeLoaded =
    (!viewNeedsIndexes || store.indexesReady) &&
    (searching || view.level === "ALL"
      ? LEVELS.every((level) => loadedLevels.has(level))
      : loadedLevels.has(view.level));
  useEffect(() => {
    if (!scopeLoaded) return;
    if (view.page > pages) setView((value) => ({ ...value, page: pages }));
  }, [scopeLoaded, pages, view.page]);

  const setPage = useCallback((page: number) => {
    setView((value) => ({ ...value, page: Math.max(1, page) }));
  }, []);

  const pageKeys = useMemo(() => rows.map((w) => w.key), [rows]);
  const filteredKeys = useMemo(() => filtered.map((w) => w.key), [filtered]);
  const selection = useSelection(pageKeys, filteredKeys);

  /**
   * 表格区自己滚动（头部与底部分页固定）。
   * 切到别的页面再回来时位置要还在；而翻页 / 换筛选后必须回到顶部 ——
   * 否则从第 3 页翻到第 4 页，人还停在第 3 页中间的位置。 */
  const scroll = useScrollKeeper<HTMLDivElement>(active);
  const scrollKey = `${view.level}|${view.mode}|${view.tier}|${view.oxford}|${view.pos}|${view.initial}|${view.query}|${current}`;
  const lastScrollKey = useRef(scrollKey);
  useEffect(() => {
    if (lastScrollKey.current === scrollKey) return;
    lastScrollKey.current = scrollKey;
    scroll.reset();
  }, [scroll, scrollKey]);

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

  /**
   * 加载态看的是「当前视图那个等级到了没」，不是「有没有任何词」。
   *
   * 首屏只加载默认等级，停在 A2 的人刷新时 words 里只有 A1 —— 此时结果为空
   * 是「还没加载」，不是「A2 里没有符合条件的词」。用 store.loadingWords 判断
   * 更不行：A1 一到手它就落了 false，于是会先闪一屏空态。
   */
  const loading = !scopeLoaded;
  const empty = scopeLoaded && filtered.length === 0;

  /**
   * 「确定」才生效：等级 / 掌握状态 / 每页条数一次性提交，页码回到第 1 页。
   * 抽屉里的点击只改草稿，所以在按下确定之前列表一行都没动。
   */
  const onApplyFilter = useCallback(
    (next: FilterDraft) => {
      /**
       * 档位 / 牛津这两档只读 rank / tier / oxford 三个字段，而首屏快路径
       * （只载默认等级、不载索引）会把它们留成默认值 —— 那时切到「认脸档」
       * 会得到 0 条，看着像「真的没有」，其实只是索引还没到。
       * 所以只要提交的条件用到这两维，先等索引补齐再落地视图。
       */
      const needsIndexes = next.tier !== "all" || next.oxford !== "all";
      if (needsIndexes) void store.ensureIndexes();

      setView((value) => ({
        ...value,
        level: next.level,
        mode: next.mode,
        tier: next.tier,
        oxford: next.oxford,
        pos: next.pos,
        initial: next.initial,
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
      oxford: "all",
      pos: "all",
      initial: "all",
      query: "",
      page: 1,
    }));
  }, []);

  return (
    /**
     * 三段式布局：顶栏内容（筛选 + 板块进度 + 表头）与底部分页都固定，
     * 只有中间那张词表在滚动。
     *
     * 之前整页靠 TabPane 滚，翻到第 40 行时搜索框和分页器都飞出屏幕，
     * 想换个词或翻页必须先把列表滚回去。现在外层 `h-full min-h-0 flex-col`，
     * 中间那段 `flex-1 min-h-0 overflow-y-auto` 自己滚 —— 头部与底部天然不动。
     */
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <FilterBar
          level={view.level}
          mode={view.mode}
          tier={view.tier}
          oxford={view.oxford}
          pos={view.pos}
          initial={view.initial}
          defaultLevel={store.prefs.defaultLevel}
          query={view.query}
          pageSize={pageSize}
          countFor={countFor}
          onQuery={(next) => setView((value) => ({ ...value, query: next, page: 1 }))}
          onApply={onApplyFilter}
        />
      </div>

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
          <div className="shrink-0">
            <ScopeProgress progress={progress} />
          </div>

          {!empty && (
            <div
              className="flex shrink-0 items-center gap-2.5 border-b border-line bg-paper/95 px-3.5 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-mute backdrop-blur"
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
              <span className="flex-1">单词</span>
              <span className="hidden lg:inline">掌握</span>
            </div>
          )}

          {/* 唯一的滚动区：只有这张表会动 */}
          <div ref={scroll.ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {empty ? (
              <EmptyState
                level={view.level}
                mode={view.mode}
                pos={view.pos}
                initial={view.initial}
                query={view.query}
                onReset={resetAll}
              />
            ) : (
              /* 底部留白：可拖动的批量按钮浮在右下角，最后一行要能滚到它上面 */
              <div
                ref={listRef}
                role="grid"
                aria-label="词表"
                data-testid="word-grid"
                aria-rowcount={filtered.length}
                className="bg-card pb-16"
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
            )}
          </div>

          {!empty && (
            <div className="shrink-0 border-t border-line bg-paper/95 backdrop-blur">
              <Pager page={current} pages={pages} total={filtered.length} onPage={setPage} />
            </div>
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
    </div>
  );
}

function EmptyState({
  level,
  mode,
  pos,
  initial,
  query,
  onReset,
}: {
  level: LevelFilter;
  mode: MasteryFilter;
  pos: PosFilter;
  initial: InitialFilter;
  query: string;
  onReset: () => void;
}) {
  // 只有搜索会跨等级，那时文案报「全库」；首字母与词性都在当前等级内生效，
  // 所以「A1 里没有 s 开头的词」是真的，如实报当前板块
  const scope = level === "ALL" || query.trim() ? "全库" : level;
  const reason = query
    ? `没有匹配「${query}」的词`
    : mode === "done"
      ? `${scope} 还没有标记已掌握的词`
      : `${scope} 里没有符合条件的词`;
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <ListFilter className="h-8 w-8 text-ink-mute" aria-hidden="true" />
      <p className="text-[14px] font-medium text-ink">{reason}</p>
      <p className="text-[13px] text-ink-soft">
        {pos !== "all" || initial !== "all"
          ? "词性或首字母这一档可能没有词，换个条件再看。"
          : "换个筛选条件，或回到全库继续找。"}
      </p>
      <Button variant="outline" size="touch" onClick={onReset}>
        清空筛选
      </Button>
    </div>
  );
}
