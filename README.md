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
npm run test         # vitest（算法层纯函数）
npm run build        # data + typecheck + vite build（含 PWA）
```

## 页面

## 性能

全库 5323 词、5323 张 FSRS 卡的规模下实测：`computeStats` 0.53ms、`buildReviewPlan` 0.38ms、
词表勾选一次 16ms（200 行/页）。三处关键优化：

- `retrievability` 用闭式遗忘曲线代替 ts-fsrs 的 `get_retrievability`（省掉每张卡的 Card 对象构造），
  正确性由 63 组参数与库实现逐值交叉校验。
- `computeStats` 把原来的 9 趟遍历（学过的 + 免检计数 + 7 天预测）合成 1 趟。
- `WordRow` 的 `memo` 必须自定义比较函数：`status` 是每帧新对象，浅比较永远失效。

| 页面 | 路由 | 说明 |
|---|---|---|
| 锁屏 | `#/lock` | 4–6 位 PIN，自建 3×4 键盘，连错 5 次锁 30 秒 |
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

## 90 天冲刺

目标：**三个月内覆盖并掌握 A1–C1 全部 5323 条**。据此定的强度：

| 参数 | 值 | 依据 |
|---|---|---|
| `newPerDay` | 60（下限，上限 120，步长 10） | ceil(5323 / 90) = 60 |
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

默认取中间那档：每天约 60 个新词 + 190 次复习。想要更保险就把留存率调到 0.95，
代价是复习量涨 47%。学习面板里有「90 天冲刺」进度条，显示已掌握 / 5323 与按当前
新词量的预计覆盖天数。

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
