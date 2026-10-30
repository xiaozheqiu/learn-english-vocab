import { useEffect, useRef, useState } from "react";
import { ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogTitle, Sheet, SheetContent, SheetDescription } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
  LEVELS,
  PAGE_SIZES,
  type LevelFilter,
  type MasteryFilter,
  type PageSize,
} from "@/lib/types";
import type {
  InitialFilter,
  ListCriteria,
  OxfordFilter,
  PosFilter,
  TierFilter,
} from "@/lib/listView";
import { INITIALS } from "@/lib/listView";
import { cn } from "@/lib/utils";

/** 抽屉里「确定」要一次提交的一整套条件 */
export interface FilterDraft {
  level: LevelFilter;
  mode: MasteryFilter;
  tier: TierFilter;
  oxford: OxfordFilter;
  pos: PosFilter;
  initial: InitialFilter;
  pageSize: PageSize;
}

export interface FilterBarProps {
  /** 已生效的等级（列表正在用的，不是抽屉里临时选的） */
  level: LevelFilter;
  mode: MasteryFilter;
  tier: TierFilter;
  oxford: OxfordFilter;
  pos: PosFilter;
  initial: InitialFilter;
  /** 偏好里的默认等级：和它一致时按钮显示「筛选」而不是一条默认条件 */
  defaultLevel: LevelFilter;
  query: string;
  pageSize: PageSize;
  /**
   * 按「草稿条件」预览条数，确定之前列表不动。
   * 传整条判据而不是一串位置参数：维度已经有 6 个，再按位置传必有人把
   * pos 和 initial 传反，而且加维度时所有调用处都要跟着改。
   */
  countFor: (criteria: ListCriteria) => number;
  onQuery: (query: string) => void;
  /** 只有点「确定」才会走到这里 */
  onApply: (next: FilterDraft) => void;
}

const MODES: { value: MasteryFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "todo", label: "未掌握" },
  { value: "done", label: "已掌握" },
];

/**
 * 抽屉里的词性按钮：缩写 + 中文，按钮上只放缩写（网格装得下 10 个），
 * 中文靠 aria-label 与下方一行说明补齐。
 */
const POS_OPTIONS: { value: PosFilter; label: string; full: string }[] = [
  { value: "all", label: "全部", full: "全部词性" },
  { value: "n", label: "n.", full: "名词" },
  { value: "v", label: "v.", full: "动词" },
  { value: "adj", label: "adj.", full: "形容词" },
  { value: "adv", label: "adv.", full: "副词" },
  { value: "pron", label: "pron.", full: "代词" },
  { value: "prep", label: "prep.", full: "介词" },
  { value: "det", label: "det.", full: "限定词（含冠词）" },
  { value: "number", label: "num.", full: "数词" },
  { value: "conj", label: "conj.", full: "连词" },
  { value: "exclam", label: "excl.", full: "感叹词" },
];

/**
 * 筛选条（§2.1 修订 / §2.3 确定后生效）。
 *
 * 旧版在移动端把等级与掌握状态展开成两行 select，撑开列表把下面的内容顶下去，
 * 点一下筛选整页都抖。现在条件全部收进底部抽屉：条上只留「筛选」按钮 + 搜索框，
 * 高度恒定；抽屉滑上来盖住列表而不是挤它。按钮上直接印当前条件，收起也能看出在筛什么。
 *
 * 抽屉里是**草稿**：点等级、点掌握状态、改每页条数都只改抽屉自己的预览，
 * 列表一行动都不动。只有点「确定」才把草稿提交上去；点关闭 / 按 Esc / 点遮罩
 * 一律丢弃草稿，列表保持原样。之前点一下立刻改数据，用户选到一半就已经被筛掉了，
 * 连「先看看有哪些选项」都做不到。
 */
export function FilterBar({
  level,
  mode,
  tier,
  oxford,
  pos,
  initial,
  defaultLevel,
  query,
  pageSize,
  countFor,
  onQuery,
  onApply,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterDraft>({
    level,
    mode,
    tier,
    oxford,
    pos,
    initial,
    pageSize,
  });
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const isDesktop = useIsDesktop();

  // 每次打开都从「当前生效的条件」起稿，关上时丢弃草稿的语义才成立
  const onOpenChange = (next: boolean) => {
    if (next) setDraft({ level, mode, tier, oxford, pos, initial, pageSize });
    setOpen(next);
    if (!next) window.setTimeout(() => trigger.current?.focus(), 0);
  };

  // 「/」聚焦搜索：搜索框常驻在条上，这条快捷键不依赖抽屉开合
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const levelLabel = level === "ALL" ? "全部等级" : level;
  const modeLabel = MODES.find((item) => item.value === mode)?.label ?? "全部";
  // 「有筛选」只算用户主动加的：把默认等级也算进去的话，一进 App 按钮就自带高亮
  const filtered =
    level !== defaultLevel ||
    mode !== "all" ||
    tier !== "all" ||
    oxford !== "all" ||
    pos !== "all" ||
    initial !== "all";
  // 草稿和已生效不同：抽屉里提示一句，免得以为已经生效了
  const pending =
    draft.level !== level ||
    draft.mode !== mode ||
    draft.tier !== tier ||
    draft.oxford !== oxford ||
    draft.pos !== pos ||
    draft.initial !== initial ||
    draft.pageSize !== pageSize;
  const draftTotal = countFor({
    level: draft.level,
    mode: draft.mode,
    tier: draft.tier,
    oxford: draft.oxford,
    pos: draft.pos,
    initial: draft.initial,
    query,
  });

  /*
   * 按钮上按「信息密度」取舍：等级必印，掌握状态只在非全选时印，
   * 词性 / 字母各占一小格。全塞进去会被 max-w 截断成一串省略号，
   * 所以容器给到 10rem，靠 truncate 兜住极端组合（等级 + 词性 + 字母）。
   */
  const extraLabels = [
    pos !== "all" ? (POS_OPTIONS.find((item) => item.value === pos)?.label ?? pos) : "",
    initial !== "all" ? `${initial.toUpperCase()} 开头` : "",
  ].filter(Boolean);
  const triggerText = filtered
    ? [levelLabel, mode !== "all" ? modeLabel : "", ...extraLabels].filter(Boolean).join(" · ")
    : "筛选";

  return (
    <section aria-label="词表筛选" className="border-b border-line bg-card/80">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Button
          ref={trigger}
          data-testid="filter-trigger"
          variant="outline"
          size="sm"
          className={cn("h-9 shrink-0 gap-1.5", filtered && "border-brand/50 text-brand-ink")}
          onClick={() => onOpenChange(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="max-w-[10rem] truncate">{triggerText}</span>
          {filtered && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          )}
        </Button>

        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute"
            aria-hidden="true"
          />
          <label className="sr-only" htmlFor="word-search">
            搜索单词
          </label>
          <Input
            id="word-search"
            ref={input}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索单词"
            className="h-9 pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="清空搜索"
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-mute hover:bg-brand-wash hover:text-ink"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-testid="filter-sheet"
          side={isDesktop ? "center" : "bottom"}
          className={cn(isDesktop && "max-w-sm")}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-1">
            <DialogTitle className="text-[16px] font-semibold text-ink">筛选</DialogTitle>
            <SheetDescription
              data-testid="filter-preview"
              data-count={draftTotal}
              data-pending={pending ? "1" : "0"}
              className="text-[12px] text-ink-mute tnum"
            >
              {pending ? `按当前选择会剩 ${draftTotal} 条 · 点确定生效` : `当前 ${draftTotal} 条`}
            </SheetDescription>

            <section className="mt-4" aria-labelledby="filter-level-title">
              <h3 id="filter-level-title" className="text-[13px] font-medium text-ink">
                等级
              </h3>
              <div
                data-testid="filter-level"
                role="group"
                aria-labelledby="filter-level-title"
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {[
                  ...LEVELS.map((item) => ({ value: item as LevelFilter, label: item })),
                  { value: "ALL" as LevelFilter, label: "全部" },
                ].map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.level === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.level === item.value}
                    onClick={() => setDraft((current) => ({ ...current, level: item.value }))}
                    className={cn(
                      "w-full",
                      draft.level === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>

            {/*
              档位：按「值不值得背」筛，和上面的等级是两个维度。
              等级回答「大纲几级」，档位回答「口语里用不用得上」——
              C1 里既有 genocide（认脸档）也有 abuse（日常档），混在一起没法跳过。
            */}
            <section className="mt-4" aria-labelledby="filter-tier-title">
              <h3 id="filter-tier-title" className="text-[13px] font-medium text-ink">
                学习档位
              </h3>
              <div
                data-testid="filter-tier"
                role="group"
                aria-labelledby="filter-tier-title"
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {(
                  [
                    { value: "all" as TierFilter, label: "全部" },
                    { value: "core" as TierFilter, label: "日常档" },
                    { value: "extended" as TierFilter, label: "认脸档" },
                  ] as const
                ).map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.tier === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.tier === item.value}
                    onClick={() => setDraft((current) => ({ ...current, tier: item.value }))}
                    className={cn(
                      "w-full",
                      draft.tier === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-mute">
                日常档按词频前 5000 划；认脸档是生僻与书面词，可单独筛出来看。
              </p>
            </section>

            {/*
              牛津官方词表：这是判断「这个词到底该不该学」最权威的一把尺子。
              Oxford 3000/5000 是牛津按学习者需求筛的清单，比任何词频阈值都可靠。
              词表里 4955 个词有 4888 个在官方表内，剩下 95 个可以单独筛出来看。
            */}
            <section className="mt-4" aria-labelledby="filter-oxford-title">
              <h3 id="filter-oxford-title" className="text-[13px] font-medium text-ink">
                牛津官方词表
              </h3>
              <div
                data-testid="filter-oxford"
                role="group"
                aria-labelledby="filter-oxford-title"
                className="mt-1.5 grid grid-cols-4 gap-1.5"
              >
                {(
                  [
                    { value: "all" as OxfordFilter, label: "全部" },
                    { value: "ox3000" as OxfordFilter, label: "3000" },
                    { value: "ox5000" as OxfordFilter, label: "5000" },
                    { value: "none" as OxfordFilter, label: "表外" },
                  ] as const
                ).map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.oxford === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.oxford === item.value}
                    onClick={() => setDraft((current) => ({ ...current, oxford: item.value }))}
                    className={cn(
                      "w-full",
                      draft.oxford === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-mute">
                Oxford 3000 是核心词，5000 是其扩展；「表外」是不在官方清单里的词。
              </p>
            </section>

            {/*
              词性：源数据里有 81 种写法（`n.,adj.`、`det./pron./adv.`、`modal v.` …），
              直接铺开会变成 81 个格子。这里只露出 10 个真正会用的类别，
              混合词性按「命中任一」算 —— book 在名词和动词下都能筛到。
              细类映射见 lib/listView.ts 的 POS_ALIASES。
            */}
            <section className="mt-4" aria-labelledby="filter-pos-title">
              <h3 id="filter-pos-title" className="text-[13px] font-medium text-ink">
                词性
              </h3>
              <div
                data-testid="filter-pos"
                role="group"
                aria-labelledby="filter-pos-title"
                className="mt-1.5 grid grid-cols-4 gap-1.5"
              >
                {POS_OPTIONS.map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.pos === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.pos === item.value}
                    aria-label={item.full}
                    title={item.full}
                    onClick={() => setDraft((current) => ({ ...current, pos: item.value }))}
                    className={cn(
                      "w-full px-0",
                      draft.pos === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-mute">
                一个词兼多个词性时，每个类别下都会出现；det. 含冠词，modal v. / auxiliary v.
                归入动词。
              </p>
            </section>

            {/*
              首字母：普通筛选条件，和词性、档位一样在**当前等级内**生效。
              停在 A1 选 S → 只出 A1 里 s 开头的词；想跨等级看就把等级改成「全部」。
              不要把它做成「选字母就跳全库」：那等于替用户改掉了他明确设过的
              等级条件，停在 A1 的人会被莫名拉走。
              没有 X 开头的词（5323 条已核），所以按钮里不给 X。
            */}
            <section className="mt-4" aria-labelledby="filter-initial-title">
              <h3 id="filter-initial-title" className="text-[13px] font-medium text-ink">
                首字母
              </h3>
              <div
                data-testid="filter-initial"
                role="group"
                aria-labelledby="filter-initial-title"
                className="mt-1.5 flex flex-wrap gap-1.5"
              >
                <Button
                  size="touch"
                  variant={draft.initial === "all" ? "subtle" : "outline"}
                  aria-pressed={draft.initial === "all"}
                  aria-label="全部字母"
                  onClick={() => setDraft((current) => ({ ...current, initial: "all" }))}
                  className={cn(
                    "min-w-[3.25rem] flex-1 px-0",
                    draft.initial === "all" && "border-brand/40 font-medium",
                  )}
                >
                  全部
                </Button>
                {INITIALS.map((letter) => (
                  <Button
                    key={letter}
                    size="touch"
                    variant={draft.initial === letter ? "subtle" : "outline"}
                    aria-pressed={draft.initial === letter}
                    aria-label={`${letter.toUpperCase()} 开头`}
                    onClick={() => setDraft((current) => ({ ...current, initial: letter }))}
                    className={cn(
                      "min-w-[2.5rem] flex-1 px-0 uppercase tnum",
                      draft.initial === letter && "border-brand/40 font-medium",
                    )}
                  >
                    {letter}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-mute">
                在当前等级内筛选；想看全部等级的词，把上面的等级选成「全部」。
              </p>
            </section>

            <section className="mt-4" aria-labelledby="filter-mode-title">
              <h3 id="filter-mode-title" className="text-[13px] font-medium text-ink">
                掌握状态
              </h3>
              <div
                data-testid="filter-mode"
                role="group"
                aria-labelledby="filter-mode-title"
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {MODES.map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.mode === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.mode === item.value}
                    onClick={() => setDraft((current) => ({ ...current, mode: item.value }))}
                    className={cn(
                      "w-full",
                      draft.mode === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>

            <section className="mt-4" aria-labelledby="filter-size-title">
              <h3 id="filter-size-title" className="text-[13px] font-medium text-ink">
                每页条数
              </h3>
              <div
                data-testid="filter-size"
                role="group"
                aria-labelledby="filter-size-title"
                className="mt-1.5 grid grid-cols-5 gap-1.5"
              >
                {PAGE_SIZES.map((size) => (
                  <Button
                    key={size}
                    size="touch"
                    variant={draft.pageSize === size ? "subtle" : "outline"}
                    aria-pressed={draft.pageSize === size}
                    onClick={() => setDraft((current) => ({ ...current, pageSize: size }))}
                    className={cn(
                      "w-full px-0 tnum",
                      draft.pageSize === size && "border-brand/40 font-medium",
                    )}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </section>
          </div>

          {/*
            操作条固定在抽屉底部，不跟着条件列表滚。
            条件从 5 组涨到 7 组之后，抽屉内容比 85vh 高出一截：
            底部那两个按钮原本在滚动区最下面，手机上要先滑过整个字母表
            才够得着「确定」——「点确定才生效」这个前提被埋掉了。
          */}
          <div className="shrink-0 border-t border-line bg-card px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
            <div className="flex gap-2">
              <Button
                data-testid="filter-reset"
                size="touch"
                variant="outline"
                className="flex-1"
                // 只清草稿：和「确定」一起构成完整动作，清空也不即时生效
                onClick={() =>
                  setDraft((current) => ({
                    level: "ALL",
                    mode: "all",
                    tier: "all",
                    oxford: "all",
                    pos: "all",
                    initial: "all",
                    pageSize: current.pageSize,
                  }))
                }
              >
                清空筛选
              </Button>
              <Button
                data-testid="filter-done"
                size="touch"
                className="flex-1"
                onClick={() => {
                  onApply(draft);
                  setOpen(false);
                }}
              >
                确定
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
