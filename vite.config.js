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
  // 局域网可访问：手机 / 平板用同一 Wi-Fi 打开终端里打印的 Network 地址即可。
  // host: true 会让 Vite 把本机所有网卡 IP 打出来，不再只有 localhost。
  server: { host: true, port: 5173, strictPort: true },
  preview: { host: true, port: 4173, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "背单词 · Oxford 5000",
        short_name: "背单词",
        description:
          "Oxford 3000 / 5000 分级词汇（A1–C1，5323 条），FSRS 间隔复习，离线可用。",
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
}));
