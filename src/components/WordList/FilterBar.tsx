import { useEffect, useRef, useState } from "react";
import { ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogTitle, Sheet, SheetContent, SheetDescription } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
  LEVELS,
  PAGE_SIZES,
  bucketLabel,
  type LevelFilter,
  type MasteryFilter,
  type PageSize,
} from "@/lib/types";
import type {
  ConfusableFilter,
  DisplayFilter,
  InitialFilter,
  ListCriteria,
  OrderFilter,
  OxfordFilter,
  PosFilter,
  ReviewFilter,
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
  review: ReviewFilter;
  confusable: ConfusableFilter;
  display: DisplayFilter;
  order: OrderFilter;
  pageSize: PageSize;
}

const ORDERS: { value: OrderFilter; label: string }[] = [
  { value: "default", label: "字母序" },
  { value: "freq", label: "词频" },
  { value: "random", label: "随机" },
];

export interface FilterBarProps {
  /** 已生效的等级（列表正在用的，不是抽屉里临时选的） */
  level: LevelFilter;
  mode: MasteryFilter;
  tier: TierFilter;
  oxford: OxfordFilter;
  pos: PosFilter;
  initial: InitialFilter;
  /** 已生效的复核档：只留标记已满 7 / 30 天的词 */
  review: ReviewFilter;
  /** 已生效的易混词筛选 */
  confusable: ConfusableFilter;
  /** 已生效的显示语言：word = 只出英文，cn = 只出中文 */
  display: DisplayFilter;
  /** 已生效的排序方式；只在随机时于筛选按钮上标一个字，免得忘了自己在乱序里 */
  order: OrderFilter;
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
  review,
  confusable,
  display,
  order,
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
    review,
    confusable,
    display,
    order,
    pageSize,
  });
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const isDesktop = useIsDesktop();

  // 每次打开都从「当前生效的条件」起稿，关上时丢弃草稿的语义才成立
  const onOpenChange = (next: boolean) => {
    if (next)
      setDraft({
        level,
        mode,
        tier,
        oxford,
        pos,
        initial,
        review,
        confusable,
        display,
        order,
        pageSize,
      });
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

  const levelLabel = level === "ALL" ? "全部等级" : bucketLabel(level);
  const modeLabel = MODES.find((item) => item.value === mode)?.label ?? "全部";
  // 「有筛选」只算用户主动加的：把默认等级也算进去的话，一进 App 按钮就自带高亮
  const filtered =
    level !== defaultLevel ||
    mode !== "all" ||
    tier !== "all" ||
    oxford !== "all" ||
    pos !== "all" ||
    initial !== "all" ||
    review !== "all" ||
    confusable !== "all";
  // 草稿和已生效不同：抽屉里提示一句，免得以为已经生效了
  const pending =
    draft.level !== level ||
    draft.mode !== mode ||
    draft.tier !== tier ||
    draft.oxford !== oxford ||
    draft.pos !== pos ||
    draft.initial !== initial ||
    draft.review !== review ||
    draft.confusable !== confusable ||
    draft.display !== display ||
    draft.order !== order ||
    draft.pageSize !== pageSize;
  const draftTotal = countFor({
    level: draft.level,
    mode: draft.mode,
    tier: draft.tier,
    oxford: draft.oxford,
    pos: draft.pos,
    initial: draft.initial,
    review: draft.review,
    confusable: draft.confusable,
    query,
  });

  /*
   * 按钮上按「信息密度」取舍：等级必印，掌握状态只在非全选时印，
   * 词性 / 字母各占一小格。全塞进去会被 max-w 截断成一串省略号，
   * 所以容器给到 10rem，靠 truncate 兜住极端组合（等级 + 词性 + 字母）。
   *
   * 非默认排序（随机 / 词频）也挤一格：列表本身看不出「这是换了顺序还是数据
   * 本来就长这样」，不标出来的话，下次打开会以为词表坏了。
   */
  const extraLabels = [
    pos !== "all" ? (POS_OPTIONS.find((item) => item.value === pos)?.label ?? pos) : "",
    initial !== "all" ? `${initial.toUpperCase()} 开头` : "",
  ].filter(Boolean);

  /**
   * 按钮上要不要标东西，看的是「显示状态是否偏离默认」，而不只是「有没有筛选」。
   *
   * 非默认排序会在这条上单独成立：只开随机或词频、不加任何筛选条件时，
   * `filtered` 是 false，但列表已经不是字母序了。若还按 filtered 决定文案，
   * 按钮会继续印「筛选」，用户看不出自己正处在什么顺序里 —— 第一版就是这么漏的。
   */
  const orderLabel = order === "random" ? "随机" : order === "freq" ? "词频" : "";
  /*
   * 中文态和随机一样，是「偏离默认的显示形态」而不是筛选条件，所以单独在按钮上
   * 标一个字 —— 否则切到中文后，一屏中文释义看着像词表坏了，或者像搜索出了问题。
   */
  const chinese = display === "cn";
  const reviewLabel = review === "all" ? "" : review === "d7" ? "7 天前" : "30 天前";
  const confusableLabel = confusable === "only" ? "易混" : "";
  const marked = filtered || Boolean(orderLabel) || chinese;
  const triggerText = filtered
    ? [
        levelLabel,
        mode !== "all" ? modeLabel : "",
        ...extraLabels,
        reviewLabel,
        confusableLabel,
        orderLabel,
        chinese ? "中文" : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : [orderLabel, chinese ? "中文" : ""].filter(Boolean).join(" · ") || "筛选";

  return (
    <section aria-label="词表筛选" className="border-b border-line bg-card/80">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Button
          ref={trigger}
          data-testid="filter-trigger"
          variant="outline"
          size="sm"
          className={cn("h-9 shrink-0 gap-1.5", marked && "border-brand/50 text-brand-ink")}
          onClick={() => onOpenChange(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="max-w-[10rem] truncate">{triggerText}</span>
          {marked && (
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

            {/*
              显示：只出英文 / 只出中文。
              它不是筛选（结果集不变），所以放在最前面、单独一段，
              和下面那些「筛掉一些词」的条件在视觉上分开。
            */}
            <section className="mt-4" aria-labelledby="filter-display-title">
              <h3 id="filter-display-title" className="text-[13px] font-medium text-ink">
                显示
              </h3>
              <div
                data-testid="filter-display"
                role="group"
                aria-labelledby="filter-display-title"
                className="mt-1.5 grid grid-cols-2 gap-1.5"
              >
                {(
                  [
                    { value: "word" as DisplayFilter, label: "只出英文" },
                    { value: "cn" as DisplayFilter, label: "只出中文" },
                  ] as const
                ).map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.display === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.display === item.value}
                    onClick={() => setDraft((current) => ({ ...current, display: item.value }))}
                    className={cn(
                      "w-full",
                      draft.display === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-mute">
                中文态下每行只给释义，点那一行（或按回车）当场揭晓英文 ——
                先想再看，和「中英并排」是两回事。
              </p>
            </section>

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
                  { value: "PHRASE" as LevelFilter, label: "短语" },
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
              词表里 4955 个词有 4861 个在官方表内，剩下 94 个可以单独筛出来看。
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
              没有 X 开头的词（4955 条已核），所以按钮里不给 X。
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

            {/*
              复核：只对「已标掌握」的词有意义，所以紧跟掌握状态之后。
              数据来自 mastery.at（标记时间）—— 那份时间戳本来就存着，
              此前只有云端合并读过，界面从没告诉过用户「这个词是多久前标的」。
            */}
            <section className="mt-4" aria-labelledby="filter-review-title">
              <h3 id="filter-review-title" className="text-[13px] font-medium text-ink">
                距上次标记
              </h3>
              <div
                data-testid="filter-review"
                role="group"
                aria-labelledby="filter-review-title"
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {(
                  [
                    { value: "all" as ReviewFilter, label: "不限" },
                    { value: "d7" as ReviewFilter, label: "7 天以上" },
                    { value: "d30" as ReviewFilter, label: "30 天以上" },
                  ] as const
                ).map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.review === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.review === item.value}
                    onClick={() => setDraft((current) => ({ ...current, review: item.value }))}
                    className={cn(
                      "w-full",
                      draft.review === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-mute">
                只看标的够久的词：「昨天背过、今天想不起来」的那批，通常就在这一档里。
              </p>
            </section>

            {/*
              易混词：这些词共用同一句中文，不是数据错误，是真同义词。
              单独背哪个都记不牢 —— 认不出是哪一个。筛出来是为了成组对比。
            */}
            <section className="mt-4" aria-labelledby="filter-confusable-title">
              <h3 id="filter-confusable-title" className="text-[13px] font-medium text-ink">
                易混词
              </h3>
              <div
                data-testid="filter-confusable"
                role="group"
                aria-labelledby="filter-confusable-title"
                className="mt-1.5 grid grid-cols-2 gap-1.5"
              >
                {(
                  [
                    { value: "all" as ConfusableFilter, label: "全部" },
                    { value: "only" as ConfusableFilter, label: "只出易混" },
                  ] as const
                ).map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.confusable === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.confusable === item.value}
                    onClick={() => setDraft((current) => ({ ...current, confusable: item.value }))}
                    className={cn(
                      "w-full",
                      draft.confusable === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-mute">
                共 192 组 399 条词和别的词共用同一句中文（如 answer / reply / respond）。
                把同一句中文的词排在一起对比，比一个个孤立地背更容易分清。
              </p>
            </section>

            {/*
              排序：只改顺序，不改结果集，所以放在最后一组 —— 用户先想清楚
              「要哪些词」，最后才决定「按什么顺序看」。
              随机这一档不是一次性动作而是持续状态：选着它就一直乱序，
              直到自己切回字母序。
            */}
            <section className="mt-4" aria-labelledby="filter-order-title">
              <h3 id="filter-order-title" className="text-[13px] font-medium text-ink">
                排序
              </h3>
              <div
                data-testid="filter-order"
                role="group"
                aria-labelledby="filter-order-title"
                className="mt-1.5 grid grid-cols-3 gap-1.5"
              >
                {ORDERS.map((item) => (
                  <Button
                    key={item.value}
                    size="touch"
                    variant={draft.order === item.value ? "subtle" : "outline"}
                    aria-pressed={draft.order === item.value}
                    onClick={() => setDraft((current) => ({ ...current, order: item.value }))}
                    className={cn(
                      "w-full",
                      draft.order === item.value && "border-brand/40 font-medium",
                    )}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-ink-mute">
                词频按口语常用度从高到低排（the / be / and 在最前），配「未掌握」用才不会头几屏全是
                already-known
                的词。随机打散字母序，避免靠「上一行是什么」把词顺下来；每确定一次换一种排法。
              </p>
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
                    review: "all",
                    confusable: "all",
                    // 显示语言与排序一起归位：这里清的是「所有偏离默认的显示设置」，
                    // 留着中文或随机会让「清空筛选」之后列表依然不是默认形态，看不出清过
                    display: "word",
                    order: "default",
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
