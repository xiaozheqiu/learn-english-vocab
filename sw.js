// Oxford 5000 词汇表 service worker
// 版本号由 词汇/build.mjs 在构建时写入；改动后版本会自动变，旧缓存随即清掉。
const VERSION = "ox5000-d3a1aa9e20";
const CACHE = VERSION;

// 预缓存：外壳 + 首屏要用的 A1。其余等级等用到再缓存，避免一上来就下满 92KB。
const PRECACHE = [
    "",
    "index.html",
    "manifest.webmanifest",
    "data/A1.js",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/apple-touch-icon.png",
    "icons/favicon-32.png"
  ];

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      // 逐个添加：某一个失败不至于让整次安装挂掉
      await Promise.all(
        PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 百度翻译等外部链接不拦

  // 页面导航：先走网络拿最新外壳，离线时回落到缓存
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const c = await caches.open(CACHE);
          c.put("index.html", res.clone());
          return res;
        } catch (err) {
          const c = await caches.open(CACHE);
          return (
            (await c.match("index.html")) ||
            (await c.match("./")) ||
            (await c.match(req)) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // 其余同源资源：缓存优先（数据文件与图标都不会变，除非版本更新）
  e.respondWith(
    (async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.status === 200 && res.type === "basic") {
          c.put(req, res.clone());
        }
        return res;
      } catch (err) {
        return new Response("", { status: 504, statusText: "offline" });
      }
    })(),
  );
});
