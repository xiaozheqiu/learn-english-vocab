/** hash 路由（§3：GitHub Pages 无需 404 兜底，保持零依赖） */

export type Route = "lock" | "setup" | "list" | "review" | "quiz" | "guide";

const PATHS: Record<Route, string> = {
  lock: "#/lock",
  setup: "#/setup",
  list: "#/",
  review: "#/review",
  quiz: "#/quiz",
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
