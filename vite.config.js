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
         * autoUpdate：新版装好即接管，页面自动重载 —— 强制更新，没有「稍后」。
         *
         * 这个项目的更新是数据契约级别的（裁字段、改主键、改搜索口径），
         * 让用户留在旧壳上有实际后果；而「提示 → 用户点确认」那条链路已经
         * 被证明可以被无限推掉。所以选择物理上不留旧版。
         *
         * 插件在此模式下会自动置 workbox.skipWaiting = true 与
         * clientsClaim = true（见 vite-plugin-pwa 的 registerType === "autoUpdate"
         * 分支，只在 injectRegister 为 auto/null 时生效 —— 这里不覆盖它），
         * 客户端注册代码则在 activated 且 isUpdate 时直接 location.reload()。
         */
        registerType: "autoUpdate",
        devOptions: { enabled: false },
        includeAssets: ["icons/favicon-32.png", "icons/apple-touch-icon.png"],
        manifest: {
          name: "背单词 · Oxford 5000",
          short_name: "背单词",
          description:
            "Oxford 3000 / 5000 分级词汇表（A1–C1，5323 条），筛选、搜索与已掌握标记，离线可用。",
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
           * 两项都显式写出来（autoUpdate 下插件默认也会加，但依赖默认值太脆）：
           * - skipWaiting：新 SW 装好立刻进 activated，不停在 waiting
           * - clientsClaim：激活后立即接管现有页面，不用等用户关掉重开
           *
           * 两者合起来才是「强制更新」：旧壳没有机会继续跑。代价是刷新是
           * 无预告的 —— 首屏刚渲染完也可能撞上一次重载，所以词表视图状态
           * 持久化在 localStorage，刷新后筛选、页码、滚动位置都还原。
           */
          skipWaiting: true,
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
