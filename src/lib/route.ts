/** hash 路由（§3：GitHub Pages 无需 404 兜底，保持零依赖） */

export type Route = "lock" | "setup" | "list" | "review" | "quiz" | "leech" | "guide";

const PATHS: Record<Route, string> = {
  lock: "#/lock",
  setup: "#/setup",
  list: "#/",
  review: "#/review",
  quiz: "#/quiz",
  leech: "#/leech",
  guide: "#/guide",
};

export function routeHref(route: Route): string {
  return PATHS[route];
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  switch (raw) {
    case "lock":
      return "lock";
    case "setup":
      return "setup";
    case "review":
      return "review";
    case "quiz":
      return "quiz";
    // 「快筛」已合并进复习页：新词首次出现时可直接标「我早就会」，
    // 不再需要单独的批量页。旧书签统一落到复习，避免被当成未知路由回落到词表。
    case "triage":
      return "review";
    case "leech":
      return "leech";
    case "guide":
      return "guide";
    default:
      return "list";
  }
}

export function navigate(route: Route): void {
  const next = PATHS[route];
  if (window.location.hash === next) return;
  window.location.hash = next;
}
