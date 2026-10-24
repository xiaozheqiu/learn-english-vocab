import type { Grade, GradePreview } from "@/lib/srs";
import { cn } from "@/lib/utils";

export interface RatingBarProps {
  /** 来自 previewGrades：顺序、文案、间隔全部是纯函数算出来的 */
  previews: readonly GradePreview[];
  onGrade: (grade: Grade) => void;
  disabled?: boolean;
}

/**
 * 四档评分（§5 F2）：每档直接印下次间隔，所见即所得——按钮上的「8 天」
 * 就是提交后实际排到的那一天，不用猜（验收 4）。
 *
 * 颜色只用 token 的语义：忘记=答错红、模糊=中性、记得=brand、很熟=brand-deep。
 * 琥珀 `--due` 全站只表示「到期」，这里不借用（§1.2 语义规则）。
 */
const TONE: Record<Grade, string> = {
  1: "border-danger/30 bg-danger-wash text-danger hover:border-danger/60",
  2: "border-line bg-card text-ink-soft hover:border-ink-mute/50 hover:text-ink",
  3: "border-brand bg-brand text-white hover:border-brand-ink hover:bg-brand-ink",
  4: "border-brand-deep bg-brand-deep text-white hover:bg-brand-deep/90",
};

export function RatingBar({ previews, onGrade, disabled = false }: RatingBarProps) {
  return (
    <div role="group" aria-label="给这次回忆打分" className="grid grid-cols-4 gap-2">
      {previews.map((preview) => (
        <button
          key={preview.grade}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(preview.grade)}
          // 读屏拿到完整语义：评分名 + 下次间隔
          aria-label={`${preview.label}，${preview.text}后复习`}
          aria-keyshortcuts={String(preview.grade)}
          className={cn(
            "flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-btn border px-1 py-2 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
            "disabled:pointer-events-none disabled:opacity-40",
            TONE[preview.grade],
          )}
        >
          <span className="text-[13px] font-medium leading-[1.2]">{preview.label}</span>
          <span className="text-[12px] leading-[1.2] tnum">{preview.text}</span>
        </button>
      ))}
    </div>
  );
}
