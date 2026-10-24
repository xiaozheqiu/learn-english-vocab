import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RATING_LABELS, type Grade } from "@/lib/srs";
import { percent } from "@/lib/utils";

/** 一次复习会话的统计（复习卡只出「忘记/模糊/记得/很熟」四档） */
export interface ReviewSummary {
  /** 本次提交的评分次数 */
  reviewed: number;
  /** 各档命中次数 */
  byGrade: Record<Grade, number>;
  /** 本次用时（毫秒）；0 = 不计时 */
  durationMs: number;
}

export interface ReviewDoneProps {
  summary: ReviewSummary;
  /** 本轮装不下、留到明天的到期卡数 */
  carryOver?: number;
  onAgain: () => void;
  onGoQuiz: () => void;
  onExit: () => void;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const TONE = {
  1: "danger",
  2: "default",
  3: "brand",
  4: "solid",
} as const satisfies Record<Grade, "danger" | "default" | "brand" | "solid">;

/**
 * 结束页（§5 F2）：本次统计 + 三个出口。
 * 统计用 `<dl>` 而不是纯视觉排版，读屏能念出「复习 12 张」这样的成对信息。
 */
export function ReviewDone({ summary, carryOver = 0, onAgain, onGoQuiz, onExit }: ReviewDoneProps) {
  const { reviewed, byGrade, durationMs } = summary;
  const correct = byGrade[3] + byGrade[4];
  const accuracy = reviewed > 0 ? correct / reviewed : 0;

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-6">
      <Card className="p-5 sm:p-6">
        <h2 className="text-[20px] font-semibold leading-[1.3] text-ink">这一轮结束</h2>
        <p className="mt-1 text-[13px] text-ink-soft">
          {reviewed > 0
            ? "每一张的间隔都已经按你的回忆重新排过了。"
            : "这一轮还没有评分，队列留着，随时可以回来。"}
        </p>

        {reviewed > 0 ? (
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-card border border-line bg-paper px-3 py-2.5">
              <dt className="text-[12px] text-ink-mute">本次复习</dt>
              <dd className="mt-0.5 text-[22px] font-semibold leading-[1.2] tnum text-ink">
                {reviewed}
                <span className="ml-1 text-[12px] font-normal text-ink-mute">张</span>
              </dd>
            </div>
            <div className="rounded-card border border-line bg-paper px-3 py-2.5">
              <dt className="text-[12px] text-ink-mute">正确率</dt>
              <dd className="mt-0.5 text-[22px] font-semibold leading-[1.2] tnum text-ink">
                {percent(accuracy)}
              </dd>
            </div>
            {durationMs > 0 && (
              <div className="rounded-card border border-line bg-paper px-3 py-2.5">
                <dt className="text-[12px] text-ink-mute">用时</dt>
                <dd className="mt-0.5 text-[22px] font-semibold leading-[1.2] tnum text-ink">
                  {formatDuration(durationMs)}
                </dd>
              </div>
            )}
          </dl>
        ) : null}

        {reviewed > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5" aria-label="各档分布">
            {([1, 2, 3, 4] as const).map((grade) =>
              byGrade[grade] > 0 ? (
                <Badge key={grade} variant={TONE[grade]} className="py-1">
                  {RATING_LABELS[grade - 1] ?? ""}
                  <span className="tnum">{byGrade[grade]}</span>
                </Badge>
              ) : null,
            )}
          </div>
        )}

        {carryOver > 0 && (
          <p className="mt-3 rounded-btn border border-due/30 bg-due-wash px-2.5 py-1.5 text-[12px] leading-5 text-due tnum">
            今天还有 {carryOver} 张到期卡没做，明天会一起排上。
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <Button size="touch" className="sm:flex-1" onClick={onAgain}>
            {carryOver > 0 ? "继续做剩下的" : "再来一轮"}
          </Button>
          <Button size="touch" variant="outline" className="sm:flex-1" onClick={onGoQuiz}>
            去测试
          </Button>
          <Button size="touch" variant="ghost" onClick={onExit}>
            回词表
          </Button>
        </div>
      </Card>
    </div>
  );
}
