import { useCallback, useEffect, useRef, useState } from "react";
import { TabPane } from "@/components/layout/TabPane";
import { TopBar } from "@/components/layout/TopBar";
import { WordListPage } from "@/components/WordList";
import { FloatingPanel } from "@/components/Panel/FloatingPanel";
import { GuidePage } from "@/components/GuidePage";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { usePwaUpdate } from "@/hooks/usePwaUpdate";
import { useVocabStore } from "@/hooks/useVocabStore";
import { navigate, parseRoute, routeHref, type Route } from "@/lib/route";

const ROUTE_TITLES: Record<Route, string> = {
  list: "词表",
  guide: "词性对照",
};

export default function App() {
  return <AppShell />;
}

function AppShell() {
  const store = useVocabStore();
  const isDesktop = useIsDesktop();
  const pwaUpdate = usePwaUpdate();
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [panelOpen, setPanelOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);

  /* ── 路由 ──────────────────────────────────────────────────── */
  useEffect(() => {
    /**
     * hash 变化时更新路由，并把地址栏收敛到实际渲染的路由。
     *
     * 收敛要在这里做，不能只靠「route 变化 → effect」：
     * 同一个路由的无效 hash（`#/review` 与 `#/` 都解析成 list）
     * 不会让 route 变化，effect 也就不跑，地址栏会一直留着失效值。
     */
    const onHash = () => {
      const parsed = parseRoute(window.location.hash);
      setRoute(parsed);
      const canonical = routeHref(parsed);
      if (window.location.hash && window.location.hash !== canonical) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${canonical}`,
        );
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /**
   * 地址栏收敛。
   *
   * 必须在**首次渲染时同步跑一次**，不能只依赖 effect：
   * 直接打开 `#/nonsense` 时 `parseRoute` 回落成 list，而 effect 的依赖
   * （route）在后续渲染里没变化，于是不会重跑 —— 表现为地址栏一直停在旧值。
   * 用 replaceState 而不是 location.replace：后者会整页重载。
   */
  const canonicaliseHash = useCallback(() => {
    const raw = window.location.hash;
    const canonical = routeHref(route);
    if (!raw || raw === canonical) return;
    if (parseRoute(raw) !== route) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${canonical}`,
    );
  }, [route]);

  useEffect(() => {
    canonicaliseHash();
  }, [canonicaliseHash]);

  /* ── PWA 安装 ──────────────────────────────────────────────── */
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      const typed = event as Event & { prompt?: () => Promise<void> };
      if (typed.prompt) setInstallPrompt({ prompt: () => typed.prompt!() });
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }, [installPrompt]);

  const openPanel = useCallback(() => {
    panelTrigger.current = document.activeElement as HTMLElement | null;
    setPanelOpen(true);
  }, []);

  const onPanelOpenChange = useCallback((open: boolean) => {
    setPanelOpen(open);
    if (!open) window.setTimeout(() => panelTrigger.current?.focus(), 0);
  }, []);

  /* ── 早期返回：正在读本机进度 ──────────────────────────────── */
  if (!store.ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-paper" role="status">
        <span className="text-[13px] text-ink-mute">正在读取本机进度…</span>
      </div>
    );
  }

  /* ── 主壳 ──────────────────────────────────────────────────── */
  const activeRoute = route;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-btn focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-float"
      >
        跳到主要内容
      </a>

      {isDesktop ? (
        <div className="mx-auto w-full max-w-5xl shrink-0 px-6">
          <TopBar
            title="Oxford 5000"
            onOpenPanel={openPanel}
            onOpenGuide={() => navigate("guide")}
            memoryMode={store.memoryMode}
          />
          <div
            className="flex items-center gap-1 border-b border-line py-1.5"
            role="tablist"
            aria-label="主导航"
          >
            {(
              [
                ["list", "词表"],
                ["guide", "词性对照"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={activeRoute === value}
                onClick={() => navigate(value)}
                className={
                  activeRoute === value
                    ? "rounded-btn bg-brand-wash px-3 py-1.5 text-[13px] font-medium text-brand-ink"
                    : "rounded-btn px-3 py-1.5 text-[13px] text-ink-soft hover:bg-brand-wash/60 hover:text-ink"
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <TopBar
          title={ROUTE_TITLES[activeRoute]}
          onOpenPanel={openPanel}
          memoryMode={store.memoryMode}
        />
      )}

      {/*
        两个页面常驻：第一次进入后一直挂着，切 tab 只改 hidden。
        这样词表的筛选、页码与滚动位置都留着；词性对照也是独立路由，
        同样不能把词表顶掉，否则从顶栏点进去再回来，搜索词和页码就没了。
      */}
      <main id="main" className="mx-auto min-h-0 w-full max-w-5xl flex-1">
        <TabPane active={activeRoute === "list"}>
          <WordListPage store={store} />
        </TabPane>
        <TabPane active={activeRoute === "guide"}>
          <GuidePage onBack={() => navigate("list")} />
        </TabPane>
      </main>

      <FloatingPanel
        open={panelOpen}
        onOpenChange={onPanelOpenChange}
        store={store}
        onOpenGuide={() => {
          setPanelOpen(false);
          navigate("guide");
        }}
        canInstall={Boolean(installPrompt)}
        onInstall={install}
      />

      {/* 深链兜底：导航后把 hash 对齐到实际渲染的页面 */}
      <span className="hidden">{routeHref(activeRoute)}</span>

      <UpdatePrompt update={pwaUpdate} />
    </div>
  );
}
