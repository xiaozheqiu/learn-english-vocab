import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));

/**
 * 构建标识，注入到前端用于「关于」页展示。
 *
 * 只靠手写的 APP_VERSION 无法回答「手机上是不是最新版」—— 版本号常年不动，
 * 而代码天天变。所以额外注入：
 *   - BUILD_SHA：CI 里是 GITHUB_SHA 前 7 位，本地是 "dev"
 *   - BUILD_TIME：构建时刻（UTC ISO，界面按本地时区显示）
 *   - BUILD_FINGERPRINT：版本 + 提交 + 依赖声明的短哈希，
 *     同一次提交重复构建稳定，改依赖会变。
 */
function buildInfo(command) {
  const sha = (process.env.GITHUB_SHA ?? "").slice(0, 7) || "dev";
  const builtAt = new Date().toISOString();
  const fingerprint = createHash("sha256")
    .update(`${pkg.version}|${sha}|${pkg.dependencies ? JSON.stringify(pkg.dependencies) : ""}`)
    .digest("hex")
    .slice(0, 7);
  return { sha, builtAt, fingerprint, mode: command };
}

// 部署在 https://xiaozheqiu.github.io/learn-english-vocab/
// 本地 vite dev 用 "/"，build 时用仓库子路径
export default defineConfig(({ command }) => {
  const info = buildInfo(command);
  return {
    base: command === "build" ? "/learn-english-vocab/" : "/",
    resolve: { alias: { "@": path.resolve(rootDir, "src") } },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_SHA__: JSON.stringify(info.sha),
      __BUILD_TIME__: JSON.stringify(info.builtAt),
      __BUILD_FINGERPRINT__: JSON.stringify(info.fingerprint),
    },
    // 局域网可访问：手机 / 平板用同一 Wi-Fi 打开终端里打印的 Network 地址即可。
    // host: true 会让 Vite 把本机所有网卡 IP 打出来，不再只有 localhost。
    server: { host: true, port: 5173, strictPort: true },
    preview: { host: true, port: 4173, strictPort: true },
    plugins: [
      react(),
      VitePWA({
        /**
         * prompt：新 SW 装好后停在 waiting，由页面决定何时接管。
         * autoUpdate 会自己 skipWaiting + clientsClaim 直接顶掉旧壳，
         * 那样「发现新版本 → 手动更新」这条链路根本不存在（没有 waiting 可提示）。
         */
        registerType: "prompt",
        devOptions: { enabled: false },
        includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png"],
        manifest: {
          name: "背单词 · Oxford 5000",
          short_name: "背单词",
          description: "Oxford 3000 / 5000 分级词汇（A1–C1，5323 条），FSRS 间隔复习，离线可用。",
          lang: "zh-CN",
          start_url: ".",
          scope: ".",
          display: "standalone",
          background_color: "#F2F5F1",
          theme_color: "#0E7C5A",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "icons/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // 全部产物都进预缓存（含 5 个等级的数据分包），装一次之后离线可用
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,json}"],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          navigateFallback: "index.html",
          cleanupOutdatedCaches: true,
          /**
           * clientsClaim 必须显式打开。
           * registerType: "prompt" 时插件不再自动加，首次安装的新 SW 会停在
           * activated 却不接管页面（navigator.serviceWorker.controller === null），
           * 要等用户关掉重开才生效 —— 首次安装后就断网会直接白屏。
           * 它和 skipWaiting 是两件事：这里只让「首次安装」立即接管，
           * 「已有旧版」的更新仍然停在 waiting 等用户点。 */
          clientsClaim: true,
        },
      }),
    ],
    build: {
      outDir: "dist",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react")) return "react";
          },
        },
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
