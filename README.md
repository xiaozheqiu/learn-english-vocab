# Oxford 5000 词汇表（React 版）

线上地址：<https://xiaozheqiu.github.io/learn-english-vocab/>

这是一个基于 React、Tailwind CSS 和 shadcn 风格组件的 Oxford 5000 词汇表。等级选择、掌握状态筛选、搜索、分页和本机掌握标记保留原有行为；顶部信息区只保留必要的筛选工具，页面不再显示重复的统计或标题栏。

## 本地开发

```bash
cd 词汇/learn-english-vocab-site
npm install
npm run dev
```

`npm run data` 会把上级目录的 `data/*.js`（`window.OX.A1 = [[...]]`）转成 `src/data/*.json`。数据源只有这一份，构建时会自动重新生成。

## 构建与发布

```bash
npm run build
```

构建产物在 `dist/`，推送 `main` 会触发 `.github/workflows/deploy.yml` 发布到 GitHub Pages。PWA 资源和离线缓存由 `vite-plugin-pwa` 生成。

## 使用方式

- 桌面端使用等级 tabs；移动端使用等级下拉框。
- 搜索会按单词和中文释义匹配，跨等级搜索时按需加载全部词表。
- 点击每行的状态框标记已掌握，数据写入当前浏览器的 `localStorage`（键名为 `ox5000-mastered-v1`）。
- 分页器显示当前筛选结果总数，可调整每页数量或跳页；所有控件集中在底部一行。

词条键规则是 `等级\|单词\|词性[|序号]`，和旧版页面一致，因此已有的本机勾选进度无需迁移。

## 目录

```
src/
  App.jsx                    页面状态与数据编排
  components/Pager.jsx       分页器
  components/WordTable.jsx   桌面表格与移动端词卡
  components/ui/             shadcn 风格基础组件
  lib/data.js                数据加载与词条键生成
  lib/sync.js                本机进度读写
  lib/utils.js               cn 类名合并工具
  styles.css                 Tailwind 主题变量
scripts/build-data.mjs       data/*.js -> src/data/*.json
```
