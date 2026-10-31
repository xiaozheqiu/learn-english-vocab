import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

/**
 * 这里原先有一段「升级后清掉旧版 PWA 缓存」：扫 `caches.keys()`，删掉 `ox5000-` 前缀的。
 *
 * 那是手写 sw.js 时代的缓存命名（见 3bc3b6a 的 `const VERSION = "ox5000-…"`）。
 * 现在缓存由 workbox 管，名字是 `workbox-precache-v2-<origin>`，前缀一条都对不上，
 * 这段等于每次启动白做一次跨进程 `caches.keys()`；而「删掉不再被任何 SW 引用的旧缓存」
 * 本来就是 `cleanupOutdatedCaches: true` 的职责（见 vite.config.js）。
 * 旧壳的缓存也早已被那次 SW 换代的 activate 清掉了，留着这段只是启动时的纯开销。
 */

const container = document.getElementById("app");
if (!container) throw new Error("缺少挂载节点 #app");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
