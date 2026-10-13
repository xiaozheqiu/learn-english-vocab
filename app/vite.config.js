import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

// 部署在 https://xiaozheqiu.github.io/learn-english-vocab/
// 本地 vite dev 用 "/"，build 时用仓库子路径
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/learn-english-vocab/" : "/",
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Oxford 5000 词汇表",
        short_name: "Oxford 5000",
        description:
          "Oxford 3000 / 5000 分级词汇表（A1–C1，共 5323 条）。可勾选标记已掌握，登录后多端同步。",
        lang: "zh-CN",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#faf9f7",
        theme_color: "#1d9e75",
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
            // Supabase 请求永远走网络，不缓存进度数据
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.co\/.*/i,
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
          if (id.includes("node_modules/@supabase")) return "supabase";
          if (id.includes("node_modules/vue")) return "vue";
        },
      },
    },
  },
}));
