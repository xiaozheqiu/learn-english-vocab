import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// 升级后清掉旧版 PWA 缓存（旧壳只有一个页面，缓存键名前缀 ox5000-）
if ("caches" in window) {
  void caches
    .keys()
    .then((names) =>
      Promise.all(
        names.filter((name) => name.startsWith("ox5000-")).map((name) => caches.delete(name)),
      ),
    )
    .catch(() => undefined);
}

const container = document.getElementById("app");
if (!container) throw new Error("缺少挂载节点 #app");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
