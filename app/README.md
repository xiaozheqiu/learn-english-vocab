# Oxford 5000 词汇表（Vue 版）

线上地址：<https://xiaozheqiu.github.io/learn-english-vocab/>

仓库根目录下的旧版单文件 `index.html` 已经不再参与发布（Pages 现在是
`build_type: workflow`，只发布 `app/dist`）。它仍保留在仓库里，双击打开可以离线用，
但新功能只加在 `app/` 下。

## 本地开发

```bash
cd app
npm install
npm run dev      # 先转数据再起 vite
```

`npm run data` 会把上级目录的 `../data/*.js`（`window.OX.A1 = [[...]]`）转成
`src/data/*.json`。数据源只有这一份，旧版页面和 Vue 版读的是同一批文件。
转换产物不入库，构建时自动重新生成。

## 构建与发布

```bash
cd app
npm run build    # 产物在 app/dist
```

推送 `main` 会触发 `.github/workflows/deploy.yml`：`npm ci` → `npm run build` →
发布到 GitHub Pages。要改发布内容，改 `app/` 就够了，不需要往仓库根目录拷产物。

## 接入 Supabase（必做，否则页面进不去）

页面是**硬门槛**：没登录只显示登录页，词表一个字都不渲染，数据文件也不会被请求。
所以下面三步必须先做完，站点才能用。

**1. 建项目 + 建表**

在 <https://supabase.com> 新建一个免费项目，然后打开 SQL Editor，
把 `supabase/schema.sql` 整段粘进去执行。它会建 `public.ox_progress` 表
（主键 `(user_id, key)`）并打开 RLS，保证任何人只能读写自己的进度。

**2. 建你的账号**

Authentication → Users → Add user，填邮箱和密码。
本项目按「只有我自己用」设计，页面上**没有注册入口**，账号在后台手工建。

**3. 把地址和 anon key 交给构建**

Settings → API 里能拿到 `Project URL` 和 `anon public` key，然后二选一：

- **线上**：仓库 Settings → Secrets and variables → Actions → New repository secret，
  建 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，再重新跑一次部署。
  这两个值是**编译时**注入的，所以配完必须重新构建，光刷新页面没用。
- **本地**：在 `app/` 下建 `.env.local`（已被 gitignore）：

  ```
  VITE_SUPABASE_URL=https://xxxx.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
  ```

> anon key 是设计上要暴露给浏览器的公开键，真正的边界是 RLS 策略。
> 但 `service_role` key 绝对不能进前端，也不要提交进仓库。

### 这个门槛能挡到什么

站点是公开的 GitHub Pages，构建产物任何人都能下载，所以**登录门只能挡住
顺手点进来的人，挡不住真想拿数据的人**。要更强的话，得把词表数据本身也
搬进 Supabase 走 RLS，现在是纯前端校验登录态。

## 登录与离线

| 场景 | 行为 |
| --- | --- |
| 没登录 | 只渲染登录页；不请求词表数据 |
| 刷新 / 重开 PWA | 读本机会话直接进去，**不校验 token**（校验要联网，会把离线用户挡在门外） |
| 断网启动 | 词表照常显示（数据随包发布）；勾选照常可用 |
| 断网时勾选 | 先落本机，恢复网络后自动补推 |
| 同步超时 | 8 秒后状态栏显示「同步失败」，但不影响继续浏览和勾选 |

## 同步是怎么合的

本机 `localStorage` 始终是离线真相，登录 / 切回前台时跟云端对齐一次：

| 本机状态 | 处理 |
| --- | --- |
| 这台设备第一次登这个账号 | 取并集再推上去（未登录时攒的进度、以及旧版页面带过来的进度都不能丢） |
| 同步过，且没有未同步的改动 | 以云端为准（别的设备上的「取消勾选」能带过来） |
| 同步过，但有未同步的改动 | 取并集，再推上去（绝不丢掉刚勾的进度） |

第一行是必须的：如果一上来就「以云端为准」，离线攒的进度会在首次登录时
被空云端直接清掉。

勾选 / 取消之后本地立刻落盘，1.2 秒防抖推一次云端；取消勾选会真的 `delete` 云端那一行。

词条的键规则是 `等级\|单词\|词性[|序号]`，和旧版单文件页面完全一致，
所以老用户本地已有的勾选进度不用做迁移。

## 目录

```
app/
  index.html              外壳
  src/
    App.vue               登录门 + 页面骨架 + 筛选/分页/同步编排
    components/
      LoginScreen.vue     登录页（未配数据库时显示配置步骤）
      WordTable.vue       词表：桌面是表格，窄屏自动变成卡片
      Pager.vue           页脚分页器
    lib/
      data.js             数据加载 + 词条键生成
      sync.js             与 Supabase 双向对齐
      supabase.js         客户端；没配环境变量时为 null
    styles.css            窄屏卡片样式在文件末尾的 @media (max-width: 820px) 里
  scripts/build-data.mjs  ../data/*.js → src/data/*.json
  supabase/schema.sql     建表 + RLS
```
