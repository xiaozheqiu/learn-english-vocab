# 背单词 · Oxford 5000

线上地址：<https://xiaozheqiu.github.io/learn-english-vocab/>

移动优先的 Oxford 3000 / 5000 词表（PWA）：5323 条 A1–C1 词条，按等级 / 档位 / CEFR /
牛津官方词表筛选与搜索，逐条标记「已掌握」，全部在本机浏览器完成，无服务端。

> v3.0.0 起应用收回到「词表」这一个职责：**PIN 锁屏 → 移除**，**学习节奏设置 → 移除**，
> **复习与练习（含 FSRS 排期、抽题、顽固词）→ 移除**。历史数据里的「已掌握」标记原样保留，
> 旧路由与旧备份文件都能平滑落地，见 [数据](#数据)。

技术栈：TypeScript（strict）+ Tailwind CSS + shadcn/ui + IndexedDB（`idb`）。

## 本地开发

```bash
npm install
npm run dev          # 启动 Vite（数据已是最新时不会重复转换）
```

`npm run data` 把 `data/*.js`（`window.OX.A1 = [[...]]`）转成 `src/data/*.json`。这一步是**增量**的：
产物比源文件新就直接跳过，`dev` / `build` 挂在前面也不会每次重转 270KB。改了 `data/*.js`
之后会自动重转，想强制重来用 `npm run data -- --force`。数据源只有这一份。

Vite 以 `host: true` 启动，终端会同时打印 Local 与 Network 地址，手机 / 平板连同一个 Wi-Fi
打开 Network 那条即可在真机上试。

## 校验

```bash
npm run typecheck    # tsc --noEmit
npm run test         # vitest（算法层纯函数，49 个）
npm run test:e2e     # 浏览器回归（Playwright，三个套件 83 项断言）
npm run build        # data + typecheck + vite build（含 PWA）
```

### 测试只在本地跑

CI（`.github/workflows/deploy.yml`）**只做构建和部署**，不跑任何测试：

```
npm ci → npm run build（含 tsc --noEmit）→ 上传 dist → 部署 Pages
```

「类型错误会让部署失败」是唯一保留的质量闸门——它本来就是 `vite build` 前的一道防线，
不是额外的测试步骤。vitest 与 e2e 都留在本地，提交前自己跑。

**不要给 CI 加 `--omit=optional`**：vite 8 的 bundler（rolldown）原生二进制
就在 `optionalDependencies` 里，跳过它构建会直接失败（实测 `Cannot find native binding`）。

### 浏览器回归的两条硬规则

`e2e/` 下的脚本不是为了「跑绿」，所以定了两条规则：

1. **不为让流程跑通而绕过被测行为。**
   如果某一步本该发生却没发生，就让它失败。绝不「帮它把前置条件补齐」。

2. **断言查结构，不查文案。**
   查 `[role="row"][data-key]` 的数量、`aria-pressed`、`data-*`、URL hash —— 不查
   「已掌握」「全库掌握度」这类会随文案调整而变的字符串。文案改动不该让测试变红，
   行为改动才应该。

为此 UI 上留了一批**语义钩子**（不是给样式用的）：

| 钩子                                                                           | 位置     | 用途                         |
| ------------------------------------------------------------------------------ | -------- | ---------------------------- |
| `data-testid="word-grid"` + `aria-rowcount`                                    | 词表     | 行数与就绪判定               |
| `data-row-index`                                                               | 词表行   | 分页跳转后的序号校验         |
| `data-testid="scope-progress"` + `data-scope` / `data-mastered` / `data-total` | 板块进度 | 当前板块的掌握数与总数       |
| `data-testid="filter-trigger" / filter-mode / filter-done / filter-reset`      | 筛选     | 抽屉交互                     |
| `data-testid="filter-preview"` + `data-pending` / `data-count`                 | 筛选抽屉 | 草稿是否已提交、按草稿剩多少 |
| `data-testid="bulk-fab" / bulk-mark / bulk-unmark`                             | 批量     | 浮动按钮与动作               |

三套浏览器回归的分工：

| 套件                 | 覆盖                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `e2e/flow.mjs`       | 词表渲染、掌握切换、筛选抽屉、板块进度、批量标记、分页、搜索、面板结构 |
| `e2e/edge.mjs`       | 视图跨刷新保留、导出下载、清空二次确认、滚动位置、深链、桌面布局       |
| `e2e/pwa-update.mjs` | 新版本检查 → 弹框 → 稍后 → 立即更新（需要先 `npm run build`）          |

`flow.mjs` 里有一组 **`gone.*` 断言**：复习 / 练习 tab、底部导航、旧深链、学习节奏设置
都必须在界面上不存在。删功能时最容易留下的就是一处没删干净的入口，这组断言专门盯它。

## 页面

| 页面     | 路由      | 说明                                                         |
| -------- | --------- | ------------------------------------------------------------ |
| 词表     | `#/`      | 主页面，筛选抽屉（确定生效）、板块掌握进度、三态框、批量入口 |
| 词性对照 | `#/guide` | 现有 Markdown 页                                             |

hash 路由，GitHub Pages 深链刷新无需 404 兜底。`#/review`、`#/quiz`、`#/lock` 这类旧书签
一律回落词表，不留死页。桌面端顶栏下有两根页签（词表 / 词性对照），移动端走顶栏的
词性对照图标 —— 底部导航随复习/练习一起移除。

## 数据

IndexedDB 库 `ox5000` **v2**，两个 store：

| store     | key   | 内容                         |
| --------- | ----- | ---------------------------- |
| `mastery` | `key` | 手动「已掌握」标记（含时间） |
| `meta`    | `k`   | 显示偏好、迁移标记           |

从 v1 升级时删掉复习遗留的 `srs` / `reviews` / `days` 三个 store，并清掉 `lockEnabled` /
`pinHash` / `lockGraceUntil` / `setupDone` 四个 meta 键 —— 那些数据已经没有界面在读，
留着只会让「这个应用到底存了什么」变得说不清。`mastery` 原样保留。

词条主键沿用旧规则 `等级|单词|词性[|序号]`，所以历史进度零迁移成本：首次启动会把旧的
`localStorage["ox5000-mastered-v1"]` 导入 `mastery`，旧键保留作备份。

隐私模式下打不开 IndexedDB 时降级为内存态，顶栏常驻提示「本次进度不会保存」。

判定分两层（`src/lib/db.ts`）：

- `isMemoryMode()` 同步检查，只能证明「没有 `indexedDB` 这个 API」。
- `probeStorage()` 异步真写一次探针库，才能揭穿「API 在但 `open()` 抛」
  —— Safari 无痕模式就是这种，同步检查会被骗过，导致写入静默落内存、
  界面却没有任何提示。store 初始化时跑一次，失败就把 `memoryMode` 置真。

改这块时注意：只靠同步检查会静默丢数据，`db.test.ts` 里有对应的两条回归。

### 导出 / 导入

导出格式是 `version: 3`，只有 `mastery` 与 `prefs` 两个字段。
v2 老备份（带 `srs` / `days`）导出文件仍能导入：那两个字段被忽略，`mastery` 照常落地，
不会整包失败。偏好归一（`normalizePrefs`）只认 `pageSize` / `defaultLevel`，
其余历史字段（`sessionSize`、`reviewSize`、`quizSize`、`retention`、`quizTypes`、
`includeExtended`、`cefrCap`、`autoLockMinutes`）一律丢弃。

## 词表视图的状态

筛选条件（等级 / 档位 / CEFR / 牛津词表 / 掌握状态 / 搜索词）与页码是一个 `ListView`
对象，写进 `localStorage["ox5000-list-view-v2"]`。刷新、被系统回收后重进、换标签页再回来
都还原到原来的板块与页。读回时逐字段校验（非法等级、0/负数/NaN 页码、超长搜索词各自
单独回落），坏值不会让整条视图作废。隐私模式下写失败就退回纯内存行为。

抽屉里的条件在按「确定」之前只是草稿，列表不动；关闭抽屉即丢弃。
板块进度（`A1 已掌握 12 / 900`）分母固定是板块总词数，不吃搜索词与掌握筛选；
搜索时列表跨等级，进度也跟着报全库。

词表与词性对照都是**常驻**面板：第一次进入后一直挂着，切路由只切 `hidden`，每个面板自己滚。
所以从词性对照返回，筛选、页码与滚动位置都还在。挂在 window 上的快捷键（Shift+↑↓ 扩选）
由 `usePageActive` 门控，隐藏的页面不接键。

## 性能

全库 5323 词下实测：词表勾选一次 16ms（200 行/页）。

`WordRow` 的 `memo` 必须自定义比较函数：行状态里有会随父组件重建的值，浅比较会失效，
一页 200 行时那是 200 次无谓重渲染。

## 目录

```
src/
  main.tsx                    入口（挂载 + 清旧缓存）
  App.tsx                     路由与外壳
  styles.css                  设计 token
  lib/
    types.ts                  共享类型 + 常量
    words.ts                  词表加载与主键生成
    date.ts                   本地时区日期工具
    db.ts                     IndexedDB 仓储 + 迁移 + 导出/导入
    route.ts                  hash 路由
    selection.ts              选中集合纯函数（三态 / 扩选 / 反选 / 作用域）
    listView.ts               词表视图：过滤 / 板块进度 / 视图持久化
  hooks/
    useVocabStore.ts          数据状态 + 写入编排
    useSelection.ts           词表选中集合（运算在 lib/selection.ts）
    usePageActive.ts          常驻面板的可见性，门控 window 快捷键
    useMediaQuery.ts          断点与 reduced-motion
    useFloatingPosition.ts    可拖动贴边的浮动按钮
    usePwaUpdate.ts           新版本检查与更新
  components/
    ui/                       shadcn 组件（button input card badge checkbox tabs progress sheet select）
    layout/                   TopBar / TabPane（常驻面板 + 滚动保存）
    WordList/                 WordRow / BulkSheet / FilterBar / Pager / ScopeProgress
    Panel/                    FloatingPanel（抽屉/悬浮卡）+ 数据 / 设置 / 关于 三个分区
    GuidePage.tsx             词性对照（Markdown）
    UpdatePrompt.tsx          新版本弹窗
scripts/build-data.mjs        data/*.js → src/data/*.json
docs/requirements-v2.md       v2 需求文档（历史存档，含已移除的复习/锁屏设计）
```

## 版本策略

「最新」和「最稳」不是一回事，本项目的取舍：

| 组件          | 用版本                                                                                        | 为什么不是更新/更旧的                                            |
| ------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CI Node       | 24 LTS（Krypton）                                                                             | 26 是 Current 线，奇数主版本不承诺 API 稳定；22 LTS 维护期更短   |
| Actions       | checkout v7 / setup-node v7 / configure-pages v6 / upload-pages-artifact v5 / deploy-pages v5 | 都是当前主版本，`vN` 浮动 tag 是官方推荐写法                     |
| React         | 19.2.8                                                                                        | registry 最新                                                    |
| TypeScript    | 5.9.3                                                                                         | 7 是 preview 线，5.9 是稳定版                                    |
| Vite / Vitest | 8.2.0 / 4.1.10                                                                                | 当前稳定主版本                                                   |
| Tailwind      | 4.3.3                                                                                         | CSS-first 配置（`@theme`），动画用 `tw-animate-css` 替代 v3 插件 |

安全：`npm audit` 的 critical 已清零。剩余 advisory 全部落在 dev 构建链
（vite / vitest / workbox / postcss 等），不进产物。

## 发布

构建产物在 `dist/`，推送 `main` 触发 `.github/workflows/deploy.yml` 发布到 GitHub Pages。
PWA 预缓存由 `vite-plugin-pwa` 生成，装一次之后断网可用。

### 版本更新

`registerType` 是 **`prompt`**，不是 `autoUpdate`：新 SW 装好后停在 waiting，
等页面决定何时接管。

- **什么时候检查**：页面回到前台（`visibilitychange` / `focus`）时主动
  `registration.update()`，30 秒内不重复发请求。
- **发现新版本**：弹窗让用户选「立即更新」或「稍后」。稍后只在本次会话生效，
  新 SW 已下载好，下次冷启动自然用上。
- **`clientsClaim: true` 必须显式保留**：切到 `prompt` 后插件不再自动加它，
  首次安装的新 SW 会停在 activated 却不接管页面（`controller === null`），
  首次装完就断网会白屏。
- **重载由我们自己做，不靠 workbox-window**：它的 `isUpdate` 在 `register()`
  那一刻用 `Boolean(controller)` 固化，本次会话若是首次安装，之后任何接管都会被判成
  「非更新」，只发事件不重载。见 `src/hooks/usePwaUpdate.ts`。

回归：`npm run test:pwa`（从 `dist/` 自己造 A/B 两份夹具，起临时静态服务器，
验证「前台检查 → 弹框 → 稍后不重载 → 立即更新后页面真的变新」）。需要先 `npm run build`。

### 版本标识

「关于」页的版本信息全部来自构建时注入（`vite.config.js` 的 `define`）：
`__APP_VERSION__` / `__BUILD_SHA__` / `__BUILD_TIME__` / `__BUILD_FINGERPRINT__`。

- `BUILD_SHA`：CI 里取 `GITHUB_SHA` 前 7 位，本地构建是 `dev`
- `BUILD_TIME`：构建时刻，界面按本地时区显示到分钟
- `BUILD_FINGERPRINT`：版本 + 提交 + 依赖内容的短哈希，同一提交重复构建稳定

拿到手机后对着「关于」看 sha 和构建时间，与 GitHub 上最新提交比对即可确认。
发版前记得把 `package.json` 的 `version` 递增，它同时供 manifest 与界面使用。
