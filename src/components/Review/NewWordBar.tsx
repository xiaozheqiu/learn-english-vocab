/**
 * 新词的两个动作（§5 F2 修订）
 *
 * 为什么只有两个按钮：
 * 第一次见一个词时，「忘记/模糊/记得/很熟」这四档全都不成立 ——
 * 你没有「回忆起」任何东西，只是刚看到它。四档里的「忘记」还会被记成
 * 一次 lapse，把新词推向 leech 判定（累计忘记 8 次就移出队列），
 * 而那其实只是第一次接触。
 *
 * 所以新词只给两个动作，对应两种真实状态：
 *   我早就会   → 标记已掌握，30 天后抽查一次，不占日常复习
 *   开始学     → 进 FSRS 正常排期，不计 lapse
 *
 * 这四个档位留给了真正复习 —— 那时「想起来多少」才是有效信号。
 */
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NewWordBarProps {
  /** 标记「我早就会」：走已掌握流程 */
  onKnow: () => void;
  /** 开始学：按「记得」进入 FSRS 首轮排期 */
  onLearn: () => void;
  disabled?: boolean;
}

export function NewWordBar({ onKnow, onLearn, disabled = false }: NewWordBarProps) {
  return (
    <div role="group" aria-label="第一次见这个词" className="grid grid-cols-2 gap-2">
      <Button
        size="touch"
        variant="outline"
        disabled={disabled}
        onClick={onKnow}
        aria-keyshortcuts="1"
        className={cn(
          "flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-btn border px-1 py-2",
          "transition-all duration-[var(--dur-fast)] active:scale-[0.97] hover:border-brand/40",
        )}
      >
        <span className="text-[13px] font-medium leading-[1.2]">我早就会</span>
        <span className="text-[11px] leading-[1.2] text-ink-mute">不再占复习时间</span>
      </Button>
      <Button
        size="touch"
        disabled={disabled}
        onClick={onLearn}
        aria-keyshortcuts="2"
        className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-btn px-1 py-2 transition-all duration-[var(--dur-fast)] active:scale-[0.97]"
      >
        <span className="text-[13px] font-medium leading-[1.2]">开始学</span>
        <span className="text-[11px] leading-[1.2] opacity-75">按记忆曲线安排</span>
      </Button>
    </div>
  );
}
