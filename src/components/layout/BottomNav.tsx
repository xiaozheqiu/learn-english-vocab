import { BookMarked, List, Sparkles } from "lucide-react";
import type { Route } from "@/lib/route";
import { cn } from "@/lib/utils";

const ITEMS: { route: Route; label: string; Icon: typeof List }[] = [
  { route: "list", label: "词表", Icon: List },
  { route: "review", label: "复习", Icon: BookMarked },
  { route: "quiz", label: "练习", Icon: Sparkles },
];

export interface BottomNavProps {
  current: Route;
  onNavigate: (route: Route) => void;
  dueCount: number;
}

/** 底部导航（§2.1）：3 项，图标 + 12px 标签，当前项绿色 + 顶部 2px 指示 */
export function BottomNav({ current, onNavigate, dueCount }: BottomNavProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur safe-bottom lg:hidden"
      aria-label="主导航"
    >
      <ul className="mx-auto flex max-w-md">
        {ITEMS.map(({ route, label, Icon }) => {
          const active = current === route;
          return (
            <li key={route} className="flex-1">
              <button
                type="button"
                onClick={() => onNavigate(route)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[12px] transition-colors",
                  active ? "font-medium text-brand-ink" : "text-ink-soft",
                )}
              >
                {active && (
                  <span
                    className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-brand"
                    aria-hidden="true"
                  />
                )}
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
                  {route === "review" && dueCount > 0 && (
                    <span
                      className="absolute -right-2 -top-1 min-w-[16px] rounded-full bg-due px-1 text-center text-[10px] font-medium leading-4 text-white tnum"
                      aria-hidden="true"
                    >
                      {dueCount > 99 ? "99+" : dueCount}
                    </span>
                  )}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
