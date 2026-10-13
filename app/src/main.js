import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

// 旧版单文件页面用的是手写 service worker，缓存名形如 ox5000-xxxx。
// 现在换成 workbox 生成的 sw.js，它只清理自己的 precache，
// 老缓存会永远留在用户浏览器里，所以这里主动清一次。
if ("caches" in window) {
  caches
    .keys()
    .then((names) =>
      Promise.all(
        names
          .filter((n) => /^ox5000-/.test(n))
          .map((n) => caches.delete(n)),
      ),
    )
    .catch(() => {});
}

createApp(App).mount("#app");
