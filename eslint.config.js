import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "dev-dist", "coverage", "src/data", "data"]),
  {
    // 不要自动删除「未使用」的 eslint-disable 注释：那是作者写的解释，
    // 规则升级后失效很正常，让 --fix 顺手删掉会丢掉上下文。
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // 只启用 react-hooks 的两条经典规则。插件 v7 的 recommended 预设会把
      // React Compiler 的 14 条规则（refs / set-state-in-effect / purity …）
      // 一并打开并设为 error，那是「是否迁移到编译器」的重构决定，不属于 lint 基线。
      ...reactHooks.configs.flat.recommended.rules,
      "react-hooks/static-components": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/immutability": "off",
      "react-hooks/globals": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/config": "off",
      "react-hooks/gating": "off",
      // 只在开发期影响热更新体验，不该卡住 lint
      "react-refresh/only-export-components": "warn",
      // 约定：下划线前缀表示「占位但保持签名」，不算未使用
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "e2e/**/*.mjs", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  // 必须放最后：关掉所有与 Prettier 冲突的格式类规则（尾随逗号、引号、缩进等）。
  // 格式只由 Prettier 决定，ESLint 只管正确性问题。
  prettier,
]);
