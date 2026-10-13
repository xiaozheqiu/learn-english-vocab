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

构建**不需要任何密钥**（同步用的 token 是使用者运行时粘贴的，见下）。

## 使用方式

打开页面就能直接用：词表和勾选都正常工作，进度存在本机浏览器里（`localStorage`
的 `ox5000-mastered-v1`），**没有登录门槛**。

想要多端同步，在右上角的同步面板里**粘一次 GitHub token**，之后自动同步。
每台设备各粘一次（只存那台设备的 `localStorage`）。

### token 怎么拿

1. 打开 <https://github.com/settings/tokens/new?scopes=gist>
2. **把其它权限全部取消，只留 `gist`**——这样即使泄露，别人也只能动 gist
3. 选 Classic token（细粒度 token 对 gist 支持不全）
4. 生成后复制，粘进同步面板

> token 只存在浏览器 `localStorage`，**绝不进代码、不进构建产物**。
> 把 PAT 推进公开仓库或公开 gist 会被 GitHub 自动吊销，所以只能用运行时粘贴。

### 进度存在哪

第一次连接时，应用会在你自己的账号下**自动建一个 secret gist**
（文件 `ox5000-progress.json`），之后就一直读写它。gist id 缓存在本机
`localStorage`（`ox5000-gist-id-v1`），找不到就自动重新搜索/新建。
面板里点「查看我的记录」能直接打开它。

选 gist 而不是数据库的原因：不用另建账号、不用建表写 SQL、不会因为闲置被暂停，
数据在自己账号里且有完整版本历史，写坏能回滚。

## 离线与容错

| 场景 | 行为 |
| --- | --- |
| 没粘 token | 照常使用，进度只存本机 |
| 刷新 / 重开 PWA | 读本机的 token 直接连上，**不校验有效性**（校验要联网，会把离线用户挡在门外） |
| 断网启动 | 词表照常显示（数据随包发布）；勾选照常可用 |
| 断网时勾选 | 先落本机，恢复网络后自动补推 |
| 同步超时 | 12 秒后显示「同步失败」，但不影响继续浏览和勾选 |
| 切回前台 | 自动对齐一次（拉取 + 推送） |

## 同步是怎么合的

本机 `localStorage` 始终是离线真相，连接后 / 切回前台时跟 gist 对齐一次：

| 本机状态 | 处理 |
| --- | --- |
| 这台设备第一次连这个账号 | 取并集再推上去（没连时攒的进度、以及旧版页面带过来的进度都不能丢） |
| 同步过，且没有未同步的改动 | 以云端为准（别的设备上的「取消勾选」能带过来） |
| 同步过，但有未同步的改动 | 取并集，再推上去（绝不丢掉刚勾的进度） |

第一行是必须的：如果一上来就「以云端为准」，本地攒的进度会在首次连接时被清掉。

这里有个容易写错的地方：**只有「这份记录还没被任何设备写过」才算空**（gist 刚自动
创建出来、或者文件里没内容）。一旦云端被另一台设备真的清空（手机上全部取消勾选），
那就是明确的意思表示，必须照样按「以云端为准」执行，否则取消永远同步不过来。
所以代码里用 `pull()` 返回的 `created` 标记来区分，而不是看 `keys.length`。

勾选 / 取消之后本地立刻落盘，1.2 秒防抖推一次。gist 的 PATCH 不支持
`If-Match`（实测返回 400），所以写入后**读回来核对**；万一另一台设备刚好也写了，
就把它的新增并进来再写一次，三次仍冲突才报错。

词条的键规则是 `等级\|单词\|词性[|序号]`，和旧版单文件页面完全一致，
所以老用户本地已有的勾选进度不用做迁移。

## 目录

```
app/
  index.html              外壳
  src/
    App.vue               页面骨架 + 筛选/分页/同步编排
    components/
      SyncPanel.vue       右上角同步设置（粘 token、显示状态、断开）
      WordTable.vue       词表：桌面是表格，窄屏自动变成卡片
      Pager.vue           页脚分页器
    lib/
      data.js             数据加载 + 词条键生成
      github.js           gist CRUD + token 存取
      sync.js             本机进度真相 + 跟 gist 双向对齐
    styles.css            窄屏卡片样式在文件末尾的 @media (max-width: 820px) 里
  scripts/build-data.mjs  ../data/*.js → src/data/*.json
```
