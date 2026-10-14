import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// 部署在 https://xiaozheqiu.github.io/learn-english-vocab/
// 本地 vite dev 用 "/"，build 时用仓库子路径
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/learn-english-vocab/" : "/",
  resolve: { alias: { "@": path.resolve(rootDir, "src") } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: true, type: "module" },
      includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Oxford 5000 词汇表",
        short_name: "Oxford 5000",
        description:
          "Oxford 3000 / 5000 分级词汇表（A1–C1，共 5323 条）。可勾选标记已掌握。",
        lang: "zh-CN",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#faf9f7",
        theme_color: "#2563eb",
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
        // 全部产物都进预缓存（含 5 个等级的数据分包，共约 590 KiB / gzip 约 150 KiB），
        // 装一次之后离线可用。分包仍然有效：只有首屏等级会被求值执行。
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // 进度数据永远走网络，不缓存
            urlPattern: /^https:\/\/api\.github\.com\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "dist",
    // 数据按等级分包，首屏只要 A1
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
}));
