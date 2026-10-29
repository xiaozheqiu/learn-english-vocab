import { useEffect, useState, type ReactNode } from "react";
import { Flame } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { dayKey } from "@/lib/date";
import type { Stats } from "@/lib/session";
import { QUIZ_SIZES, QUIZ_TYPES, REVIEW_SIZES, SPRINT_TARGET, type Prefs } from "@/lib/types";
import { QUIZ_TYPE_LABELS } from "@/components/Quiz/QuizCard";
import { cn, percent } from "@/lib/utils";

/** 期望留存率区间（§5 F2：FSRS request_retention） */
const RETENTION_MIN = 0.8;
const RETENTION_MAX = 0.95;
const RETENTION_STEP = 0.01;

export interface LearnSectionProps {
  stats: Stats;
  prefs: Prefs;
  onPrefsChange: (patch: Partial<Prefs>) => void;
  /** 打开顽固词清单（累计忘记 ≥8 次的词） */
  onOpenLeech?: () => void;
  /** 本地日期键；不传则取当天，用来把「今天」那根柱标成 --brand */
  today?: string;
}

/**
 * 学习分区（§2.3 / §5 F5）：今日复习、新词上限、单次题量、期望留存率、
 * 连续天数、未来 7 天到期预测柱。
 */
export function LearnSection({
  stats,
  prefs,
  onPrefsChange,
  onOpenLeech,
  today,
}: LearnSectionProps) {
  const todayKey = today ?? dayKey();

  // 滑杆用本地草稿：拖动时只动 UI，松手/失焦/键盘抬起才落库，避免每 1% 写一次 IndexedDB
  const [retentionDraft, setRetentionDraft] = useState(prefs.retention);

  useEffect(() => setRetentionDraft(prefs.retention), [prefs.retention]);

  const commitRetention = () => {
    const next = Number(retentionDraft.toFixed(2));
    if (next !== prefs.retention) onPrefsChange({ retention: next });
  };

  const forecastMax = Math.max(1, ...stats.forecast.map((item) => item.count));
  const forecastTotal = stats.forecast.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="space-y-5">
      {/* 今日概览 */}
      <section aria-label="今日概览" className="grid grid-cols-2 gap-2">
        <StatTile label="今日复习" value={String(stats.todayReviewed)} unit="条" />
        <StatTile label="今日正确率" value={percent(stats.todayAccuracy)} />
        <StatTile
          label="连续天数"
          value={String(stats.streak)}
          unit="天"
          icon={<Flame className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <StatTile label="已学单词" value={String(stats.learned)} unit="个" />
      </section>

      {/*
        全库掌握度。
        只陈述事实：已掌握多少、总共多少、今天还能学几个。
        不换算「还要多少天」—— 学习节奏本就该由每天的状态决定，
        给一个倒计时等于替用户预设了一个他并没有承诺的截止日期。
      */}
      <section
        data-testid="coverage-card"
        data-mastered={stats.masteredInCooldown}
        data-total-words={SPRINT_TARGET}
        aria-labelledby="coverage-title"
        className="rounded-card border border-line bg-paper/60 px-3 py-2.5"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="coverage-title" className="text-[13px] font-medium text-ink">
            全库掌握度
          </h3>
          <span className="text-[12px] font-medium text-brand-ink tnum">
            {Math.round((stats.masteredInCooldown / SPRINT_TARGET) * 100)}%
          </span>
        </div>
        <Progress
          value={(stats.masteredInCooldown / SPRINT_TARGET) * 100}
          label="全库掌握度"
          className="mt-1.5"
        />
        <p className="mt-1.5 text-[12px] leading-5 text-ink-mute tnum">
          已掌握 {stats.masteredInCooldown} / {SPRINT_TARGET} 个 · 已学 {stats.learned} 个
        </p>
        {/*
          两档分开报数。
          只给「全库 5323」会让人以为还有 5000 个要背，实际上认脸档
          （998 条生僻/书面词）默认根本不进复习队列 —— 那个分母是虚的。
        */}
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line/70 pt-2">
          <div>
            <p className="text-[11px] text-ink-mute">日常档（要背）</p>
            <p className="text-[13px] font-medium text-ink tnum">
              {stats.coreLearned} / {stats.coreTotal}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-ink-mute">认脸档（可跳过）</p>
            <p className="text-[13px] font-medium text-ink-soft tnum">{stats.extendedTotal} 个</p>
          </div>
        </div>
      </section>

      {/*
        顽固词入口。
        单列一行而不是塞进底部导航：导航已有 4 项，第 5 项会挤到 60px 以下，
        而这是个低频入口（只有确实攒了顽固词时才需要点）。
        没有顽固词时整行不出现，避免给一个永远空着的入口。
      */}
      {stats.leechCount > 0 && (
        <button
          type="button"
          data-testid="leech-entry"
          onClick={onOpenLeech}
          className="flex w-full items-center justify-between rounded-card border border-line bg-card px-3 py-2.5 text-left transition-colors hover:border-due/40"
        >
          <span>
            <span className="block text-[13px] font-medium text-ink">
              顽固词 {stats.leechCount} 个
            </span>
            <span className="mt-0.5 block text-[11px] text-ink-mute">
              累计忘记 8 次以上，{stats.leechShelved} 个已移出复习队列
            </span>
          </span>
          <span aria-hidden="true" className="text-[12px] text-brand-ink">
            查看
          </span>
        </button>
      )}

      <p className="text-[12px] text-ink-mute tnum">
        全库平均留存率 R {percent(stats.averageRetrievability)}
      </p>

      {/* 7 天到期预测 */}
      <section aria-labelledby="forecast-title">
        <div className="flex items-baseline justify-between">
          <h3 id="forecast-title" className="text-[13px] font-medium text-ink">
            未来 7 天到期
          </h3>
          <span className="text-[12px] text-ink-mute tnum">共 {forecastTotal} 条</span>
        </div>

        <div
          className="mt-2 rounded-card border border-line bg-paper/60 px-2.5 pb-2 pt-3"
          role="group"
          aria-label={`未来 7 天到期预测，共 ${forecastTotal} 条，今天 ${stats.dueToday} 条`}
        >
          <div className="flex items-end gap-1.5">
            {stats.forecast.map((item) => {
              const isToday = item.day === todayKey;
              // 柱高按最大值归一；0 也留 2% 的底座，避免柱子消失后标签悬空
              const ratio = Math.round((item.count / forecastMax) * 100);
              const height = item.count === 0 ? 2 : Math.max(ratio, 6);
              return (
                <div key={item.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span
                    className={cn(
                      "text-[11px] tnum",
                      isToday ? "font-medium text-brand-ink" : "text-ink-mute",
                    )}
                  >
                    {item.count}
                  </span>
                  <div className="flex h-16 w-full items-end" aria-hidden="true">
                    <div
                      className={cn(
                        "w-full rounded-t-[3px]",
                        isToday ? "bg-brand" : "bg-brand-500",
                      )}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "max-w-full truncate text-[10px]",
                      isToday ? "font-medium text-brand-ink" : "text-ink-mute",
                    )}
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/*
        复习和测试的题量分开：复习要清账（大），测试练手感（小）。
        合成一个「单次题量」时，选大了零碎时间做不完一套测试，
        选小了每天的到期卡又做不完。
      */}
      <section>
        <h3 className="text-[13px] font-medium text-ink">单轮复习题量</h3>
        <div
          data-testid="review-size-group"
          className="mt-1.5 grid grid-cols-4 gap-1.5"
          role="group"
          aria-label="单轮复习题量"
        >
          {REVIEW_SIZES.map((size) => (
            <SizeButton
              key={size}
              size={size}
              active={prefs.reviewSize === size}
              onClick={() => onPrefsChange({ reviewSize: size })}
            />
          ))}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-ink-mute">
          一天要清完的到期卡上限。装不下的部分会顺延到明天，复习页顶部会显示还剩多少。
        </p>
      </section>

      <section>
        <h3 className="text-[13px] font-medium text-ink">单套测试题量</h3>
        <div
          data-testid="quiz-size-group"
          className="mt-1.5 grid grid-cols-4 gap-1.5"
          role="group"
          aria-label="单套测试题量"
        >
          {QUIZ_SIZES.map((size) => (
            <SizeButton
              key={size}
              size={size}
              active={prefs.quizSize === size}
              onClick={() => onPrefsChange({ quizSize: size })}
            />
          ))}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-ink-mute">
          一套题做完就看成绩。50 道约 6 分钟，适合零碎时间。
        </p>
      </section>

      {/*
        题型开关。
        之前 quizTypes 只有默认值，没有任何界面能改 —— 文案却写着「到浮窗学习分区
        勾选题型」，等于让用户去找一个不存在的开关。
      */}
      <section>
        <h3 className="text-[13px] font-medium text-ink">测试题型</h3>
        <div
          data-testid="quiz-type-group"
          className="mt-1.5 grid grid-cols-3 gap-1.5"
          role="group"
          aria-label="测试题型"
        >
          {QUIZ_TYPES.map((type) => {
            const active = prefs.quizTypes.includes(type);
            const last = prefs.quizTypes.length === 1 && active;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                // 至少留一种，否则测试页只能出空态
                disabled={last}
                onClick={() =>
                  onPrefsChange({
                    quizTypes: active
                      ? prefs.quizTypes.filter((item) => item !== type)
                      : QUIZ_TYPES.filter(
                          (item) => item === type || prefs.quizTypes.includes(item),
                        ),
                  })
                }
                className={cn(
                  "h-11 rounded-btn border px-1 text-[12px] transition-colors",
                  active
                    ? "border-brand bg-brand-wash font-medium text-brand-ink"
                    : "border-line bg-card text-ink-soft hover:border-brand/40",
                  last && "opacity-60",
                )}
              >
                {QUIZ_TYPE_LABELS[type]}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-ink-mute">
          只有拼写与中→英（输出型）一次答对才会算「记得」；英→中最多记「模糊」， 因为四选一有 25%
          是蒙对的。
        </p>
      </section>

      {/*
        复习范围：默认只复习 core 档。
        extended 档是词频 >5000 或词典无词频数据的词（genocide/asylum/notwithstanding），
        对听懂日常对话的边际收益接近零，却要占 6–8 秒/张的复习成本。
        它们仍在词表里可查、可手动标记，只是默认不占复习时间。
      */}
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-medium text-ink">复习范围</h3>
          <span className="text-[12px] text-ink-mute tnum">
            {prefs.includeExtended ? "全库 5323" : "日常档 4325"}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="group" aria-label="复习范围">
          {[
            { value: false, label: "只复习日常词", hint: "词频前 5000" },
            { value: true, label: "全库都复习", hint: "含生僻与书面词" },
          ].map((option) => (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={prefs.includeExtended === option.value}
              onClick={() => onPrefsChange({ includeExtended: option.value })}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-btn border px-1 text-[12px] transition-colors",
                prefs.includeExtended === option.value
                  ? "border-brand bg-brand-wash font-medium text-brand-ink"
                  : "border-line bg-card text-ink-soft hover:border-brand/40",
              )}
            >
              <span>{option.label}</span>
              <span className="text-[11px] opacity-70">{option.hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-ink-mute">
          「认脸档」的词（genocide、asylum、notwithstanding 这类）不占复习时间，
          但仍可在词表里查到、也可以手动标记。
        </p>
      </section>

      {/*
        新词难度上限（CEFR）。
        与下面的「复习范围」是两件事：这里管「多难的新词先进来」，
        复习范围管「生僻词进不进队列」。已有复习中的词不受这里限制。
      */}
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-medium text-ink">新词难度上限</h3>
          <span className="text-[12px] text-ink-mute tnum">
            {prefs.cefrCap ? prefs.cefrCap.toUpperCase() : "不限"}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5" role="group" aria-label="新词难度上限">
          {(["" as const, "a2", "b1", "b2"] as const).map((value) => (
            <button
              key={value || "none"}
              type="button"
              aria-pressed={prefs.cefrCap === value}
              onClick={() => onPrefsChange({ cefrCap: value })}
              className={cn(
                "h-11 rounded-btn border px-1 text-[12px] transition-colors",
                prefs.cefrCap === value
                  ? "border-brand bg-brand-wash font-medium text-brand-ink"
                  : "border-line bg-card text-ink-soft hover:border-brand/40",
              )}
            >
              {value ? value.toUpperCase() : "不限"}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-ink-mute">
          按牛津义项级 CEFR 排新词，先易后难。设成 B1 时只发 a1–b1 的新词，
          更适合「先能听说」的目标；已在复习中的词不受影响。
        </p>
      </section>

      {/* 期望留存率 */}
      <section>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="pref-retention" className="text-[13px] font-medium text-ink">
            期望留存率
          </label>
          <span className="text-[13px] font-medium text-brand-ink tnum">
            {Math.round(retentionDraft * 100)}%
          </span>
        </div>
        <Slider
          id="pref-retention"
          min={RETENTION_MIN}
          max={RETENTION_MAX}
          step={RETENTION_STEP}
          value={retentionDraft}
          aria-describedby="pref-retention-hint"
          onChange={(event) => setRetentionDraft(Number(event.target.value))}
          onPointerUp={commitRetention}
          onKeyUp={commitRetention}
          onBlur={commitRetention}
        />
        <p id="pref-retention-hint" className="text-[12px] text-ink-mute">
          FSRS 的锚点：调高后间隔变短、复习更密，调低则相反
        </p>
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-paper/60 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-ink-mute">
        {icon}
        {label}
      </div>
      <p className="mt-0.5 text-[18px] font-semibold leading-tight text-ink tnum">
        {value}
        {unit && <span className="ml-0.5 text-[12px] font-normal text-ink-soft">{unit}</span>}
      </p>
    </div>
  );
}

/** 题量候选按钮（两组共用，避免两处写重复样式） */
function SizeButton({
  size,
  active,
  onClick,
}: {
  size: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-11 rounded-btn border text-[13px] transition-colors tnum",
        active
          ? "border-brand bg-brand-wash font-medium text-brand-ink"
          : "border-line bg-card text-ink-soft hover:border-brand/40",
      )}
    >
      {size}
    </button>
  );
}
