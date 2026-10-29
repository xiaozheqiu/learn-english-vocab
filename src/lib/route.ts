/** hash 路由（§3：GitHub Pages 无需 404 兜底，保持零依赖） */

export type Route = "list" | "guide";

const PATHS: Record<Route, string> = {
  list: "#/",
  guide: "#/guide",
};

export function routeHref(route: Route): string {
  return PATHS[route];
}

/**
 * 解析 hash。
 *
 * 复习 / 测试 / 顽固词 / 锁屏 / 首次设置这些路由已随功能一起移除，
 * 旧书签与历史 hash 统一回落到词表，不做二次跳转。
 */
export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  switch (raw) {
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
