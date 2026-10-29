/**
 * 设备相关的操作提示（§1.3 / §7 修订）。
 *
 * 之前每个组件都写「或按回车继续」「空格 显示释义 · 1–4 评分」这类文案，
 * 在手机上等于把用不上的键盘说明塞给用户，在桌面上又重复了好几遍。
 * 这里统一按指针类型判断：粗指针（触摸）= 触屏文案，细指针（鼠标/触控板）= 键盘文案。
 *
 * 用 `(hover: none) and (pointer: coarse)` 而不是 UA 判断，
 * 因为 iPad + 妙控键盘、Windows 触屏本这类设备只有指针类型说得准。
 */
import { useMediaQuery } from "@/hooks/useMediaQuery";

export function useIsTouchPrimary(): boolean {
  return useMediaQuery("(hover: none) and (pointer: coarse)");
}

/** 继续 / 提交类提示：触屏说「点」，桌面说「回车」 */
export function ContinueHint({ className }: { className?: string }) {
  const touch = useIsTouchPrimary();
  return <p className={className}>{touch ? "点下面的按钮继续" : "或按回车继续"}</p>;
}

/** 复习页的操作提示：桌面给键盘，触屏只说要点哪里 */
/**
 * 复习页操作提示。
 *
 * `isNew` 必须传：新词只有两个动作（我早就会 / 开始学），
 * 还印「1–4 评分」会让人去按 3、4，而那两个键在新词上刻意不响应。
 */
export function ReviewHint({ className, isNew = false }: { className?: string; isNew?: boolean }) {
  const touch = useIsTouchPrimary();
  if (isNew) {
    return (
      <p className={className}>
        {touch
          ? "点「显示释义」，再选「我早就会」或「开始学」"
          : "空格 显示释义 · 1 我早就会 · 2 开始学"}
      </p>
    );
  }
  return (
    <p className={className}>
      {touch ? "点「显示释义」，再点一档评分" : "空格 显示释义 · 1–4 评分 · ⌘Z 撤销"}
    </p>
  );
}

/** 选择题的操作提示 */
export function ChoiceHint({ className }: { className?: string }) {
  const touch = useIsTouchPrimary();
  return <p className={className}>{touch ? "点一个选项" : "键盘 1–4 或 A–D 选择"}</p>;
}

/** 拼写题的输入提示 */
export function SpellHint({ className }: { className?: string }) {
  const touch = useIsTouchPrimary();
  return <p className={className}>{touch ? "忽略大小写与标点" : "回车提交，忽略大小写与标点"}</p>;
}
