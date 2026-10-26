import { Progress } from "@/components/ui/progress";
import type { ScopeProgressInfo } from "@/lib/listView";

/**
 * 板块掌握进度（§2.3）：`A1 已掌握 12 / 900` + 细进度条 + 百分比。
 *
 * 位置在筛选条下面、表头上面的吸顶区里。之前整页只有「（5323）」这种
 * 当前结果条数，看不出「我选中的这个板块，掌握到什么程度了」——
 * 换板块时数字还全是同一套结果计数，等于没有参照。
 *
 * 分母固定是该板块的总词数，不吃搜索词、也不吃「已掌握 / 未掌握」筛选：
 * 选「已掌握」时若跟着变成 900/900，这个数字就只剩装饰作用了。
 */
export function ScopeProgress({ progress }: { progress: ScopeProgressInfo }) {
  const label = progress.scope === "ALL" ? "全库" : progress.scope;
  const percent = Math.round(progress.ratio * 100);
  /**
   * 已掌握 1 / 900 时四舍五入成「0%」，看着像没生效。
   * 有进度但不足 1% 就写 <1%，不为了一行字去加小数位。
   */
  const percentLabel = percent === 0 && progress.mastered > 0 ? "<1%" : `${percent}%`;
  return (
    <div
      data-testid="scope-progress"
      data-scope={progress.scope}
      data-mastered={progress.mastered}
      data-total={progress.total}
      className="flex items-center gap-2 border-b border-line/70 bg-card px-3.5 py-1.5 text-[12px] text-ink-soft"
    >
      <span className="shrink-0 font-medium text-ink">{label}</span>
      <span className="shrink-0 whitespace-nowrap tnum">
        已掌握 <span className="font-medium text-brand-deep">{progress.mastered}</span>
        <span className="text-ink-mute"> / {progress.total}</span>
      </span>
      <Progress
        value={percent}
        label={`${label} 掌握进度 ${percent}%`}
        className="h-1 min-w-6 flex-1"
      />
      <span className="w-9 shrink-0 text-right text-ink-mute tnum">{percentLabel}</span>
    </div>
  );
}
