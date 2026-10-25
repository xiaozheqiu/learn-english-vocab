# 背单词 · Oxford 5000

线上地址：<https://xiaozheqiu.github.io/learn-english-vocab/>

移动优先的学习 App（PWA）：从「词表页」重构而来，加入 FSRS 间隔复习、测试抽题、本机 PIN 锁屏。
需求与设计定稿见 [docs/requirements-v2.md](docs/requirements-v2.md)。

技术栈：TypeScript（strict）+ Tailwind CSS + shadcn/ui + IndexedDB（`idb`）+ `ts-fsrs`。

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
npm run test         # vitest（算法层纯函数，98 个）
npm run test:e2e     # 浏览器回归（Playwright，两个套件 53 项断言）
npm run build        # data + typecheck + vite build（含 PWA）
```

### 测试只在本地跑

CI（`.github/workflows/deploy.yml`）**只做构建和部署**，不跑任何测试：

```
npm ci → npm run build（含 tsc --noEmit）→ 上传 dist → 部署 Pages
```

实测全程约 36 秒。「类型错误会让部署失败」是唯一保留的质量闸门——它本来就是
`vite build` 前的一道防线，不是额外的测试步骤。

vitest（98 个）和 e2e（53 项）都留在本地，提交前自己跑。理由很直接：
CI 每次跑都要重新装依赖、下 Chromium，几十秒换来的信息在本地一次 `npm run test:e2e` 就有。

**不要给 CI 加 `--omit=optional`**：vite 8 的 bundler（rolldown）原生二进制
就在 `optionalDependencies` 里，跳过它构建会直接失败（实测 `Cannot find native binding`）。

### 浏览器回归的两条硬规则

`e2e/` 下的脚本不是为了「跑绿」，所以定了两条规则：

1. **不为让流程跑通而绕过被测行为。**
   如果某一步本该发生却没发生，就让它失败。绝不「帮它把前置条件补齐」。
   曾经踩过：脚本发现测试页是空态时自动补了一轮复习再回来，
   结果「零基础不出题」这条规则永远测不到，还掩盖了一个真 bug。

2. **断言查结构，不查文案。**
   查 `[role="row"][data-key]` 的数量、`aria-pressed`、`data-grade`、`data-testid`、
   URL hash —— 不查「已掌握」「全库掌握度」这类会随文案调整而变的字符串。
   文案改动不该让测试变红，行为改动才应该。

为此 UI 上补了一批**语义钩子**（不是给样式用的）：

| 钩子 | 位置 | 用途 |
|---|---|---|
| `data-testid="review-running"` + `data-done` / `data-total` | 复习会话 | 进度、补考后队列长度 |
| `data-testid="review-done"` + `data-reviewed` | 复习结束页 | 本轮实际复习数 |
| `data-testid="quiz-question"` + `data-index` / `data-total` | 测试答题 | 题号与总题数 |
| `data-testid="quiz-empty"` + `data-reason` | 测试空态 | 区分「没学过」「池子太小」「无题型」 |
| `data-grade="1..4"` | 评分按钮 | 避免依赖可访问名称 |
| `data-testid="filter-trigger" / filter-mode / filter-done / filter-reset` | 筛选 | 抽屉交互 |
| `data-testid="bulk-fab" / bulk-mark / bulk-unmark` | 批量 | 浮动按钮与动作 |
| `data-row-index` | 词表行 | 分页跳转后的序号校验 |

断言全部落在**行为**上：队列长度变化、`aria-pressed` 翻转、抽屉是否关闭、
题面单词是否在已学集合里、hash 是否被纠正。

## 页面

## 版本策略

「最新」和「最稳」不是一回事，本项目的取舍：

| 组件 | 用版本 | 为什么不是更新/更旧的 |
|---|---|---|
| CI Node | 24 LTS（Krypton） | 26 是 Current 线，奇数主版本不承诺 API 稳定；22 LTS 维护期更短 |
| Actions | checkout v7 / setup-node v7 / configure-pages v6 / upload-pages-artifact v5 / deploy-pages v5 | 都是当前主版本，`vN` 浮动 tag 是官方推荐写法 |
| React | 19.2.8 | registry 最新（`npm outdated` 报的 19.3.0 在 npm 上不存在） |
| TypeScript | 5.9.3 | 7 是 preview 线，5.9 是稳定版 |
| Vite / Vitest | 8.2.0 / 4.1.10 | 当前稳定主版本 |
| Tailwind | 4.3.3 | CSS-first 配置（`@theme`），动画用 `tw-animate-css` 替代 v3 的插件 |

安全：`npm audit` 的 critical 已清零。剩余 10 条 advisory 全部落在 dev 构建链
（vite / vitest / workbox / postcss 等），不进产物；其中 vite 的 launch-editor
问题上游尚未修复（8.2.0 已是最新版）。

## 性能

全库 5323 词、5323 张 FSRS 卡的规模下实测：`computeStats` 0.53ms、`buildReviewPlan` 0.38ms、
词表勾选一次 16ms（200 行/页）。三处关键优化：

- `retrievability` 用闭式遗忘曲线代替 ts-fsrs 的 `get_retrievability`（省掉每张卡的 Card 对象构造），
  正确性由 63 组参数与库实现逐值交叉校验。
- `computeStats` 把原来的 9 趟遍历（学过的 + 免检计数 + 7 天预测）合成 1 趟。
- `WordRow` 的 `memo` 必须自定义比较函数：`status` 是每帧新对象，浅比较永远失效。

| 页面 | 路由 | 说明 |
|---|---|---|
| 锁屏 | `#/lock` | 固定 6 位 PIN，自建 3×4 键盘，连错 5 次锁 30 秒 |
| 首次设置 | `#/setup` | 设 PIN（可跳过）+ 默认等级 + 每日新词上限 |
| 词表 | `#/` | 主页面，右下角可拖动批量入口（全选/反选/标记）、表头三态框、状态左栏 |
| 复习 | `#/review` | FSRS 队列，四档按钮直接印下次间隔，单词可点跳翻译 |
| 测试 | `#/quiz` | 英→中 / 中→英 / 拼写，种子可复现 |
| 词性对照 | `#/guide` | 现有 Markdown 页 |

hash 路由，GitHub Pages 深链刷新无需 404 兜底。

## 数据

IndexedDB 库 `ox5000` v1，五个 store：

| store | key | 内容 |
|---|---|---|
| `mastery` | `key` | 手动「已掌握」标记 |
| `srs` | `key` | FSRS 卡片（due/stability/difficulty/state）+ 测验 right/wrong |
| `reviews` | 自增 | 每次作答流水，可导出供将来拟合权重 |
| `days` | `day` | 当日复习数/对错数/新增词数 |
| `meta` | `k` | 偏好、锁屏、迁移标记 |

词条主键沿用旧规则 `等级|单词|词性[|序号]`，所以历史进度零迁移成本：首次启动会把旧的
`localStorage["ox5000-mastered-v1"]` 导入 `mastery`，旧键保留作备份。

隐私模式下打不开 IndexedDB 时降级为内存态，顶栏常驻提示「本次进度不会保存」。

判定分两层（`src/lib/db.ts`）：

- `isMemoryMode()` 同步检查，只能证明「没有 `indexedDB` 这个 API」。
- `probeStorage()` 异步真写一次探针库，才能揭穿「API 在但 `open()` 抛」
  —— Safari 无痕模式就是这种，同步检查会被骗过去，导致写入静默落内存、
  界面却没有任何提示。store 初始化时跑一次，失败就把 `memoryMode` 置真。

改这块时注意：只靠同步检查会静默丢数据，`db.test.ts` 里有对应的两条回归。

## 学习强度

目标：**覆盖并掌握 A1–C1 全部 5323 条**，节奏由自己定。参数：

| 参数 | 值 | 依据 |
|---|---|---|
| 每日新词 | **无配额** | 学多少由「本轮做多少」自然决定，不设每日上限 |
| `reviewSize` | 300（候选 150/200/300/500） | 90 天冲刺实测到期峰值 265 |
| `quizSize` | 50（候选 20/30/50/100） | 一套约 6 分钟，零碎时间能做完 |
| `MAX_INTERVAL` | 90 天 | 任何词三个月内必定再见一次 |
| `MASTERY_COOLDOWN_DAYS` | 30 天 | 冲刺期里「已掌握」也要每月抽查，不能永久免检 |
| `request_retention` | 0.9（可调到 0.95） | 0.95 时复习量涨到日均 280，见下表 |

实测工作量（FSRS-5 真实参数模拟，56~60 新词/天）：

| 配置 | 学完 5323 | 前 90 天日均 | 峰值 | 每词复习次数 |
|---|---|---|---|---|
| 56/天 + 上限 365 天 + R0.9 | 90 天 | 158 | 230 | 3.64 |
| 60/天 + 上限 90 天 + R0.92 | 84 天 | 190 | 265 | 4.46 |
| 60/天 + 上限 60 天 + R0.95 | 84 天 | 280 | 459 | 6.68 |

复习与测试的题量是分开的两个偏好：复习要清账（默认 300），测试练手感（默认 50）。
旧库里只有一个 `sessionSize`，读取时按「它的值 → 复习题量」迁移，测试题量给默认 50。

**新词没有每日配额。** 学几个由当天的状态决定：复习队列先放到期卡，
再补最多 `NEW_BATCH`（20）张没学过的词。做完想继续就再来一轮，
学多学少都不影响已学词的复习安排（复习只跟 FSRS 排期走）。

一轮 20 张新词是「一批」而不是「一天」：一次灌 300 个新词既记不住也做不完。
``reviewSize`` 只约束单轮总张数（防止一次抽出一千张），不限制一天做几轮。

App 也不显示「还剩多少天」这类倒计时——那等于替用户预设一个他没承诺过的截止日期。
学习面板只陈述事实：全库掌握度（已掌握 / 5323）、已学数量、今日已学。

测试只考**学过的词**（有 FSRS 记录或标记已掌握）。一个词都没学过时，
测试页给的是「先去复习几轮」而不是凭空出 50 道题。

### 欠账（carryOver）

单次题量装不下的到期卡不丢，顺延到明天，但界面会明确写出来：

- 复习页顶部：「今天到期 200 张，本轮做 150 张，剩余 110 张留到明天」
- 结束页：「今天还有 110 张到期卡没做，明天会一起排上」，主按钮改成「继续做剩下的」

这是「慢慢处理」能不能成立的关键：欠账本身不可怕，**不知道自己欠了多少**才可怕。
实测（60 新词/天、上限 90 天）：

| 中断天数 | 最大欠账 | 清完欠账 | 全部学完 |
|---|---|---|---|
| 0 | 0 | — | 第 89 天 |
| 3 | 404 | 第 24 天 | 第 96 天 |
| 7 | 669 | 第 29 天 | 第 101 天 |
| 14 | 898 | 第 37 天 | 第 109 天 |
| 21 | 900 | 第 44 天 | 第 118 天 |

也就是说断两周，冲刺目标从 89 天滑到 109 天，但不会崩 —— 因为新词额度是
「做完到期才补」，欠账期间新词自动停滞，不会雪上加霜。

## 学习机制

三个决定「能不能长期记住」的口径：

1. **词库是全量的**。启动即加载 5 个等级（5323 条，270KB，PWA 预缓存后本地读），
   复习与测试不受词表页筛选影响 —— 学过的词一定会在复习/测试里遇到。
2. **「已掌握」是降频，不是毕业**。标记后免检 30 天，到期自动回队列抽查，考过续期。
3. **单张卡最长间隔 90 天**。FSRS 默认对「一直很熟」的卡会排到 1252 天；
   冲刺期内那等于这个词再也不会被验证。

另外两处：

- 复习中答错（忘记）的卡会在**本轮末尾再考一次**（`ReviewItem.retry`），
  短期记忆当天消化掉，而不是全部堆进明天。
- **选择题答对最多记 hard(2)**（`gradeFromQuiz`）。四选一有 25% 是蒙对的，
  把蒙对当「记住」会让 FSRS 把卡片排到几周后。只有中→英（good）和拼写（easy）
  一次答对才算真的想起来。

## 复习算法

`ts-fsrs` 5.4.2、FSRS-5 默认权重、本地计算，参数在 `src/lib/srs.ts`：

- `request_retention` 0.9（浮窗可调 0.8–0.95）、`maximum_interval` **90 天**、`enable_short_term: false`（日粒度，不做当日内循环；答错由会话在当轮末尾补考一次）。
- 队列由纯函数 `buildReviewPlan` 构建：先取 `due ≤ now` 且未标记已掌握的卡（按 R 升序，同 R 逾期久的先），再按每日额度补新词，最后按单次题量截断。
- 四档按钮上的间隔用 `previewGrades` 现场算，与提交后的实际排期同源，保证「所见即所得」。

## 测试锁定（`src/lib/__tests__/`）

`srs` 间隔单调性与到期判定、`quiz` 加权抽样可复现与拼写判定、`session` 队列构成与连续打卡、
`date` 本地时区、`words` 主键规则、`lock` PIN 哈希与锁定、`db` 导入导出解析、`route` 路由。
`selection` 选中集合运算（三态、扩选、替换域反选）、`build-data` 增量跳过。
另有 `components/Panel/__smoke.test.ts` 对浮窗四个分区做 SSR 冒烟。

## 三个主页面的状态

词表 / 复习 / 测试是**常驻**面板：第一次进入后一直挂着，切 tab 只切 `hidden`，每个面板
自己滚。所以从测试切走再回来，还是刚才那套题、还停在第几题；复习同理；词表的筛选、页码、
滚动位置也都留在原处。挂在 window 上的快捷键（复习 1–4、测试 1–4/回车、词表 Shift+↑↓）
由 `usePageActive` 门控，隐藏的页面不接键。

只有明确点「去测试」「换一套」这类入口才推进 `requestId` 重新抽题。

## 目录

```
src/
  main.tsx                    入口（挂载 + 清旧缓存）
  App.tsx                     路由与外壳
  styles.css                  设计 token（§1.2 全部变量）
  lib/
    types.ts                  共享类型 + 常量
    words.ts                  词表加载、主键生成、拼写归一
    srs.ts                    FSRS 封装（schedule / preview / R / 格式化）
    quiz.ts                   抽题权重、加权抽样、判分
    session.ts                复习队列、统计、连续打卡
    date.ts                   本地时区日期工具
    db.ts                     IndexedDB 仓储 + 迁移 + 导出
    lock.ts                   PIN 哈希（PBKDF2）与解锁状态
    route.ts                  hash 路由
    selection.ts              选中集合纯函数（三态 / 扩选 / 反选 / 作用域）
  hooks/
    useVocabStore.ts          数据状态 + 写入编排
    useLock.ts                锁屏状态与自动锁定
    useSelection.ts          词表选中集合（运算在 lib/selection.ts）
    usePageActive.ts         常驻面板的可见性，门控 window 快捷键
    useMediaQuery.ts          断点与 reduced-motion
  components/
    ui/                       shadcn 组件（button input card badge checkbox tabs progress sheet select slider）
    layout/                   BottomNav / TopBar / TabPane（常驻面板 + 滚动保存）
    LockScreen.tsx            PIN 锁屏
    SetupWizard.tsx           首次设置
    WordList/                 WordRow / StatusRail / BulkSheet / FilterBar / Pager
    Review/                   ReviewCard / RatingBar / ReviewSession / ReviewDone
    Quiz/                     QuizCard / ChoiceList / SpellInput / QuizResult
    Panel/                    FloatingPanel（抽屉/悬浮卡）+ 4 个分区
scripts/build-data.mjs        data/*.js → src/data/*.json
docs/requirements-v2.md       需求文档
```

## 关于锁屏

这是纯前端静态站，没有服务端。PIN 只是挡住随手拿起你设备的人，**不构成访问控制**：
学习数据未加密，打开 DevTools 就能看到，重置 PIN 也不会删除任何数据。PIN 用
PBKDF2-SHA256（随机盐、100k 次迭代）存哈希，不存明文。哈希有两条实现路径，**输出逐字节一致**：
安全上下文（https / localhost / 127.0.0.1）走浏览器原生 `crypto.subtle`，约 10ms；
用局域网 IP 打开 http 页面时 `crypto.subtle` 不存在，退回 `lib/sha256.ts` 里的纯 JS 实现，
约 235ms，所以那条路径上设 PIN 会多花 0.2 秒左右，但不会是弱哈希。
解锁状态放 `sessionStorage`，
关掉标签页重新询问；「记住本设备 7 天」存的是哈希片段 + 到期时间。

## 发布

构建产物在 `dist/`，推送 `main` 触发 `.github/workflows/deploy.yml` 发布到 GitHub Pages。
PWA 预缓存由 `vite-plugin-pwa` 生成，装一次之后断网可用。

### 版本更新

`registerType` 是 **`prompt`**，不是 `autoUpdate`：新 SW 装好后停在 waiting，
等页面决定何时接管。

- **什么时候检查**：页面回到前台（`visibilitychange` / `focus`）时主动
  `registration.update()`，30 秒内不重复发请求。这是 Web 里等价于小程序
  `onShow` 的东西 —— PWA 没有自己的钩子。
- **发现新版本**：弹窗让用户选「立即更新」或「稍后」。不做成自动刷新，
  因为重载会中断正在做的题。稍后只在本次会话生效，新 SW 已下载好，
  下次冷启动自然用上。
- **`clientsClaim: true` 必须显式保留**：切到 `prompt` 后插件不再自动加它，
  首次安装的新 SW 会停在 activated 却不接管页面（`controller === null`），
  首次装完就断网会白屏。
- **重载由我们自己做，不靠 workbox-window**：它的 `isUpdate` 在 `register()`
  那一刻用 `Boolean(controller)` 固化，本次会话若是首次安装（打开时还没有
  controller），之后任何接管都会被判成「非更新」，只发事件不重载 ——
  表现为点了立即更新、新 SW 已 activated、页面还是旧的。见
  `src/hooks/usePwaUpdate.ts`。

回归：`npm run test:pwa`（从 `dist/` 自己造 A/B 两份夹具，起临时静态服务器，
验证「前台检查 → 弹框 → 稍后不重载 → 立即更新后页面真的变新」）。
需要先 `npm run build`。

### 版本标识

「关于」页的版本信息全部来自构建时注入（`vite.config.js` 的 `define`），
不再手写：`__APP_VERSION__` / `__BUILD_SHA__` / `__BUILD_TIME__` / `__BUILD_FINGERPRINT__`。

之前 `APP_VERSION` 是硬编码的 `"2.0.0"`，自 v2.0.0 之后 11 个提交都没动过，
而 PWA 静默更新 —— 只看版本号无法判断手机上是不是最新版。现在：

- `BUILD_SHA`：CI 里取 `GITHUB_SHA` 前 7 位（Actions 默认提供，无需改 workflow），
  本地构建是 `dev`
- `BUILD_TIME`：构建时刻，界面按本地时区显示到分钟
- `BUILD_FINGERPRINT`：版本 + 提交 + 依赖内容的短哈希，同一提交重复构建稳定

拿到手机后对着「关于」看 sha 和构建时间，与 GitHub 上最新提交比对即可确认。
发版前记得把 `package.json` 的 `version` 递增，它同时供 manifest 与界面使用。
