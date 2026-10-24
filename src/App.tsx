import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomNav } from "@/components/layout/BottomNav";
import { TabPane } from "@/components/layout/TabPane";
import { TopBar } from "@/components/layout/TopBar";
import { LockScreen } from "@/components/LockScreen";
import { SetupWizard } from "@/components/SetupWizard";
import { WordListPage } from "@/components/WordList";
import { ReviewPage } from "@/components/Review";
import { QuizPage } from "@/components/Quiz";
import { FloatingPanel } from "@/components/Panel/FloatingPanel";
import { GuidePage } from "@/components/GuidePage";
import { useLock } from "@/hooks/useLock";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useVocabStore } from "@/hooks/useVocabStore";
import { navigate, parseRoute, routeHref, type Route } from "@/lib/route";
import { computeStats } from "@/lib/session";
import { dayKey } from "@/lib/date";

const ROUTE_TITLES: Record<Route, string> = {
  lock: "锁屏",
  setup: "首次设置",
  list: "词表",
  review: "复习",
  quiz: "测试",
  guide: "词性对照",
};

export default function App() {
  return <AppShell />;
}

/** 每分钟对齐一次的毫秒时间戳：让「今天到期」这类跨零点的数字能自己翻页 */
function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  useEffect(() => {
    const timer = window.setInterval(
      () => setTick(Math.floor(Date.now() / 60_000) * 60_000),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return tick;
}

function AppShell() {
  const store = useVocabStore();
  const lock = useLock();
  const isDesktop = useIsDesktop();
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [panelOpen, setPanelOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const [onlyKeys, setOnlyKeys] = useState<string[] | null>(null);
  /**
   * 「只练错题」的请求序号。
   * 只练错题点两次同一批错词时 key 数组内容相同，测试页按内容比不出「这是一次新请求」；
   * 带上序号，每次点击都是一套新题。
   */
  const [quizTicket, setQuizTicket] = useState(0);
  const panelTrigger = useRef<HTMLElement | null>(null);

  /* ── 路由 ──────────────────────────────────────────────────── */
  useEffect(() => {
    /**
     * hash 变化时更新路由，并把地址栏收敛到实际渲染的路由。
     *
     * 收敛要在这里做，不能只靠「route 变化 → effect」：
     * 同一个路由的无效 hash（`#/nonsense` 与 `#/` 都解析成 list）
     * 不会让 route 变化，effect 也就不跑，地址栏会一直留着无效值。
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
   * 路由守卫：按优先级算出唯一目标路由，再和当前路由比较。
   * 三个条件必须互斥 —— 分别写「若 A 则去 X」「若 B 则去 Y」会让两条规则
   * 在 #/setup 与 #/ 之间来回跳，hash 变化不断触发重渲染（曾把主线程锁死）。
   */
  useEffect(() => {
    if (!lock.ready) return;
    const target: Route = !lock.setupDone
      ? "setup"
      : lock.lockEnabled && !lock.unlocked
        ? "lock"
        : route === "lock" || route === "setup"
          ? "list"
          : route;
    if (target !== route) navigate(target);
  }, [lock.lockEnabled, lock.ready, lock.setupDone, lock.unlocked, route]);

  /**
   * 地址栏对齐：未知 hash（`#/nonsense`）会被 parseRoute 回落成 list，
   * 但地址栏还留着旧值 —— 刷新一次又走一遍回落，分享出去的链接也不对。
   * 这里把 hash 与「实际渲染的路由」校正一致。
   */
  /**
   * 把地址栏收敛到「实际渲染的路由」。
   *
   * 必须在**首次渲染时同步跑一次**，不能只依赖 effect：
   * 直接打开 `#/nonsense` 时 `parseRoute` 回落成 list，而 effect 的依赖
   * （lock.ready / route）在后续渲染里都没变化，于是不会重跑 ——
   * 表现为地址栏一直停在 `#/nonsense`。
   *
   * 用 replaceState 而不是 location.replace：后者会整页重载，
   * 刷新场景下浏览器仍可能按旧 hash 初始化。
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

  // 首次挂载后就收敛一次：不等 lock.ready —— 它只会让「直接打开无效 hash」
  // 这种场景多挂一帧空档，而 route 在首帧就已经算好了
  useEffect(() => {
    canonicaliseHash();
  }, [canonicaliseHash]);

  /*
   * 统计。
   *
   * 依赖里只放真正会改变结果的东西（records / mastered / days / words / retention），
   * `now` 不进依赖 —— 否则每秒都重算一遍全库。为了「跨零点」时数字还能自己更新，
   * 用一个每分钟对齐的时间戳做 key，到点自动重算一次。
   */
  const minuteTick = useMinuteTick();
  const stats = useMemo(
    () =>
      computeStats({
        words: store.words,
        records: store.records,
        mastered: store.mastered,
        days: store.days,
        prefs: { retention: store.prefs.retention },
        now: new Date(minuteTick),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- minuteTick 只是「到点重算」的信号
    [store.days, store.mastered, store.prefs.retention, store.records, store.words, minuteTick],
  );

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

  /**
   * 底部导航 / 桌面 tab 只切页（navigate("quiz")）：切回来还要接着做刚才那套题。
   * 这里的 startQuiz 只给「去测试」这类明确要开始新一轮的入口用，
   * 每次都推进请求序号，测试页据此重抽。
   */
  const startQuiz = useCallback(() => {
    setOnlyKeys(null);
    setQuizTicket((n) => n + 1);
    navigate("quiz");
  }, []);

  /** 只练错题：把白名单和一次新的请求序号一起交给测试页 */
  const practiceWrong = useCallback((keys: string[]) => {
    setOnlyKeys(keys);
    setQuizTicket((n) => n + 1);
    navigate("quiz");
  }, []);

  /* ── 首次设置完成 ──────────────────────────────────────────── */
  const onSetupDone = useCallback(
    async (options: {
      pin: string | null;
      remember: boolean;
      level: Parameters<typeof store.setPrefs>[0]["defaultLevel"];
    }) => {
      await lock.completeSetup({ pin: options.pin, remember: options.remember });
      await store.setPrefs({ defaultLevel: options.level ?? "A1" });
      navigate("list");
    },
    [lock, store],
  );

  /* ── 早期返回：锁屏 / 向导 ─────────────────────────────────── */
  if (!lock.ready || !store.ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-paper" role="status">
        <span className="text-[13px] text-ink-mute">
          {!lock.ready ? "正在读取本机进度…" : "正在准备词表…"}
        </span>
      </div>
    );
  }

  if (!lock.setupDone) {
    return <SetupWizard onDone={onSetupDone} />;
  }

  if (lock.lockEnabled && !lock.unlocked) {
    return (
      <LockScreen
        onUnlock={lock.unlock}
        onReset={lock.resetPin}
        lockoutLeft={lock.lockoutLeft}
        failures={lock.attempts.failures}
      />
    );
  }

  /* ── 主壳 ──────────────────────────────────────────────────── */
  const activeRoute: Route = route === "lock" || route === "setup" ? "list" : route;
  const showNav = activeRoute !== "guide";

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
            dueCount={stats.dueToday}
            onOpenGuide={() => navigate("guide")}
            memoryMode={store.memoryMode}
          />
          <div className="flex items-center gap-1 border-b border-line py-1.5" role="tablist" aria-label="主导航">
            {(
              [
                ["list", "词表"],
                ["review", "复习"],
                ["quiz", "测试"],
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
            {stats.dueToday > 0 && (
              <span className="ml-2 rounded-full bg-due-wash px-2 py-0.5 text-[11px] font-medium text-due tnum">
                待复习 {stats.dueToday}
              </span>
            )}
          </div>
        </div>
      ) : (
        <TopBar
          title={ROUTE_TITLES[activeRoute]}
          onOpenPanel={openPanel}
          dueCount={stats.dueToday}
          memoryMode={store.memoryMode}
        />
      )}

      {/*
        三个主页面常驻：第一次进入后一直挂着，切 tab 只改 hidden。
        这样测试不会重抽一套、复习进度不归零、词表的筛选与页码也留着，
        各页的滚动位置由 TabPane 自己保存（每个面板是独立滚动容器）。
        词性对照也是一个 pane：它是独立路由，但同样不能把主页面顶掉，
        否则从顶栏点「词性对照表」再回来，正在做的题就没了。
      */}
      <main id="main" className="mx-auto min-h-0 w-full max-w-5xl flex-1">
        <TabPane active={activeRoute === "list"}>
          <WordListPage store={store} onGoReview={() => navigate("review")} onGoQuiz={startQuiz} />
        </TabPane>
        <TabPane active={activeRoute === "review"}>
          <ReviewPage store={store} onExit={() => navigate("list")} onGoQuiz={startQuiz} />
        </TabPane>
        <TabPane active={activeRoute === "quiz"}>
          <QuizPage
            store={store}
            onExit={() => navigate("list")}
            onlyKeys={onlyKeys}
            requestId={quizTicket}
            onPracticeWrong={practiceWrong}
            onGoReview={() => navigate("review")}
          />
        </TabPane>
        <TabPane active={activeRoute === "guide"}>
          <GuidePage onBack={() => navigate("list")} />
        </TabPane>
      </main>

      {showNav && (
        <BottomNav
          current={activeRoute}
          dueCount={stats.dueToday}
          onNavigate={navigate}
        />
      )}

      <FloatingPanel
        open={panelOpen}
        onOpenChange={onPanelOpenChange}
        store={store}
        stats={stats}
        lock={lock}
        onLockNow={lock.lockNow}
        canInstall={Boolean(installPrompt)}
        onInstall={install}
        onOpenGuide={() => {
          setPanelOpen(false);
          navigate("guide");
        }}
        onGoQuiz={() => {
          setPanelOpen(false);
          startQuiz();
        }}
        today={dayKey()}
      />

      {/* 深链兜底：导航后把 hash 对齐到实际渲染的页面 */}
      <span className="hidden">{routeHref(activeRoute)}</span>
    </div>
  );
}
