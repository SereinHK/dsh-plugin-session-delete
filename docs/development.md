# Development notes: building, installing and debugging this plugin

> **Layout note.** These notes were written while the package lived at
> `packages/client/ui-session-delete/` inside a mimic of the upstream monorepo.
> The repository root **is** the package now (so that `github:you/repo` resolves
> its manifest), and the paths below moved up accordingly: `packages/client/ui-session-delete/src`
> is `src/`, and its `tools/` merged with the root `tools/`. Everything else —
> the four pitfalls, the verification story, the tooling — still holds.
> For the *upstream* destination those paths are correct again: see `../PR.md`.



[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件工作区。
交付物是一个**按上游仓库形态写的双面插件包**：在 Web 界面里给每个会话加一行
**「删除对话 / Delete conversation」**，真的从磁盘删掉它；外加**批量清理空会话**。

这个工作区不是 DSH 源码的克隆，而是围绕**本机运行中的构建**（`resources/app.asar`，
`@deepseek-ai/dsh-desktop-runtime` **0.2.0-rc.2**）核对 API 之后写成的插件工程 ＋ 提 PR 所需的一切。

```
dsh/
├── packages/client/ui-session-delete/   # 插件本体（上游形态：src / tests / lib / README×2）
│   ├── src/index.ts                     #   Node 面：POST /api/session.delete、包含性闸门、删除
│   ├── src/client/*.ts                  #   浏览器面：槽位、词典、清理计划、两个对话框
│   ├── tests/*.test.ts                  #   21 个 node:test 用例
│   └── lib/                             #   构建产物（上游由 tsdown 产出）
├── tools/
│   ├── build.mjs                        # 从 src 生成 lib（Node 自带类型剥离，零依赖）
│   ├── verify-artifact.mjs              # 对**构建产物**跑 39 项路由断言
│   ├── verify-boot.mjs                  # 读运行中应用的浏览器插件图（/plugins/events）
│   ├── force-reload.mjs                 # 诊断「组合是否还在重建」
│   ├── probe-reload.mjs                 # 诊断「配置改动是否还在生效」
│   └── asar.mjs                         # 读 Electron app.asar 的小工具
├── upstream/web-app-cordis.patch.yml.diff   # 落到上游的唯一一处包外改动（实测 git apply 干净）
├── docs/upstream-issue-session-persistence-location.md   # 给核心的提案
├── PR.md                                # PR 描述（含验证、风险、reviewer 清单）
├── install.mjs / install.ps1            # 装/卸到某个 profile（零依赖，不需要 pnpm）
└── README.md
```

---

## 1. 快速使用

```powershell
# 1. 构建 + 对产物跑断言 + 安装到当前 profile（默认取 DSH_PROFILE_DIR / desktop）
node install.mjs

# 2. 重启一次 DSH（见 §4 的说明），然后刷新页面；校验：
node tools/verify-boot.mjs      # 运行中的 DSH 是否已把这一行挂进浏览器插件图

# 3. 其它检查
node --test "packages/client/ui-session-delete/tests/*.test.ts"   # 21/21
node tools/verify-artifact.mjs                                    # 39/39（对构建产物）
node tools/build.mjs --check                                      # lib/ 是否与 src/ 同步

# 卸载
node install.mjs --uninstall
```

安装脚本只做两件事：把包复制进
`<profile>/node_modules/@deepseek-ai/dsh-client-ui-session-delete/`，并把 profile 的
`cordis.patch.yml` 改写成带一行 `- insert:` 的样子（逐行改写、先备份、写完回读校验）。
**不需要包管理器**：Node 面只用 Node 内置模块，浏览器面只 `require` 平台种子模块。

功能入口：

- 会话行的 `...` 菜单 → 红色「删除对话」（确认框会说明删什么、不可恢复）
- 侧边栏底部、设置旁 → 「清理空会话」（先列出会删哪些，再按数量确认）

---

## 2. 为什么「删除」要自己写

DSH **刻意不提供**删除会话的能力，这不是疏漏：`SessionPersistence` 只有
`create`/`open`/`flush`/`stat`/`list`；`/clear` 只清选中；归档（`archiveSession`）
只把 id 追加进 `archivedSessionIds` 隐藏行；投影缓存 README 明说淘汰是
out-of-band maintenance。所以插件自己拥有整个删除过程，并把 DSH 的状态一致性逐条处理：

| 事项 | 处理方式 |
|---|---|
| 活会话（本进程持有写句柄） | **拒绝**（409），提示先切走；写句柄会把日志写回来或写坏 |
| 多格式世代日志（v0/v3/v4 并存） | 随整个会话目录一起删，不做单文件删除 |
| 投影缓存记录 | 一并删除（best-effort，结果回报给前端） |
| 工作区记账 / 归档集合 | 不用清：`workspaceRegistry.sessionKnown()` 每次回查 live + 新列表，失效 id 自然下线 |
| SQLite 会话索引 | 不用清：本部署是 `:memory:` + `openAt: never`；即便配了持久路径也是派生只读模型，自行对账 |
| 附件（内容寻址、跨会话共享、无引用计数） | **绝不触碰**：删一个会连带毁掉别的会话的图片 |
| 路径安全 | id 先限制成单段安全字符；删除前再确认目标是 `<root>/<一个项目目录>/<编码 id>` |

完整语义、错误码表、跳过规则见
[`packages/client/ui-session-delete/README.zh.md`](packages/client/ui-session-delete/README.zh.md)。

---

## 3. 用到的 DSH 插件机制（0.2.0-rc.2 实测）

一个包可以同时是 Host 面与浏览器面：

```jsonc
{
  "exports": {
    ".":        { "default": "./lib/index.js" },   // Host 面：普通 cordis 对象插件
    "./client": { "default": "./lib/client.js" }   // 浏览器面：手写的注册脚本
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-workspace"] } }
}
```

- **浏览器面必须是预构建字节**：client-modules 只对已挂载的 Loader 行扫描
  `dsh.client` + `exports["./client"]`，然后把文件**原样**提供给浏览器；没有运行时打包器。
  文件必须长成 `window.__ModuleLoader__.load({ id: "<行名>", factory })`，且 **id 必须等于行名**。
- **浏览器只能 `require` 平台种子模块**（否则整页 boot 失败）：
  `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、
  `@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、
  `@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。
- **UI 只有一个入口**：`ctx.slots.inject(key, () => ctx.slots.register({...}, Component))`。
  本包用 `sidebar.workspaces.session.menu.item`（会话行菜单，list/root）、
  `sidebar.footer.action`（侧边栏底部，list/root）、`shell.overlay`（浮层，list/root）。
- **插件自有 HTTP 端点**：Host 侧
  `ctx.connection.fetch.register({ path: '/api/…', methods, requestBody, fetch })`，
  浏览器侧普通 `fetch`。路由天然落在 `/api` 信任围栏（Host/Origin + 浏览器令牌）内。
  这是插件不依赖仓库内代码生成器就能开口子的官方缝（Typert Remote 的 `./remote` 贡献需要
  `dsh-typert-generator`，公开包里没有）。
- **删除后界面立刻更新**：Host 发 `api-session/removed`（`api-remotes` 转发给每个浏览器，
  会话列表 store 直接删掉那一行），客户端再 `ctx.sessions.refresh()` 兜底重拉权威列表。

---

## 4. 三个真实踩到的坑（工具就是为它们留下的）

**坑一：YAML 里 `@` 开头的标量必须加引号。**
中间版本安装脚本写了 `name: @deepseek-ai/dsh-client-ui-session-delete`（没引号）。
YAML 把 `@` 保留为指示符，这份 patch 层直接解析失败。

**坑二：一次失败的 reload 会把运行中的组合冻住。**
紧接着的第二次写入虽然修好了引号，但 Loader 已经**不再重建插件树**了：
`node tools/force-reload.mjs` 把这一行从 patch 里删掉，浏览器插件图毫无变化
（68 项进 68 项出），而上一版名字 `dsh-plugin-session-delete` 仍然挂在图里 —— 证明
「值级改动（`disabled` 开关）会在原地提交，结构级改动（insert/remove）需要重建」，
而那次重建已经坏掉。**唯一的解法是重启一次 DSH。**

**坑三：一台机器上可能同时跑着两个 DSH 实例，插件却是按 profile 安装的。**
本机真实情况：桌面应用（PID 6280，`desktop` profile）监听 **19387**，
而你打开的浏览器标签页是 `npx dsh web`（PID 14764，`web` profile）监听的 **3080**。
**两边都是 0.2.0-rc.2**（npx 缓存里那个 `package.json` 记的 `^0.1.5-rc.3` 只是它第一次缓存时写的 spec，
实际装的是 0.2.0-rc.2 —— 我一开始就是被这行字骗了，误判成"老版本"，这是错的），
两个实例的差别是 **profile 与 launcher 覆盖层**：桌面覆盖层多挂了几行
（`dsh-client-ui-sidebar-browser`、`dsh-client-product-analytics`），所以条目数 68 vs 66、
行集合也不同 —— **同一份构建照样不同**。插件装进哪个 profile，就只在那个实例里生效。

因此现在的脚本与工具是：

- 安装脚本逐行改写 patch、写完回读、拒绝把裸 `name:` 留在根位置；`--profile` **优先于**环境里的
  `DSH_PROFILE_DIR`（否则在会话里执行时显式参数会被静默忽略，我就踩了这一下），
  并在结束时**逐个实例**报告「这个 origin 是否已经在提供这一行」；
- `tools/verify-boot.mjs` 直接读运行中应用的浏览器插件图（该端点在 `/api` 围栏之外，
  非浏览器进程也能读），不再靠「猜 URL 能不能 200」；它还会报告这一行落在**哪个预加载批次**
  里，把「已挂载」和「已送达浏览器」分开；`--scan` 会列出本机**每个实例**的条目数与是否携带该行，
  并明确说明差异来自 profile/覆盖层而不是版本；
- `tools/verify-browser.mjs` 在 Node 里真的加载构建产物、渲染每个槽位条目并驱动交互
  （没有可用 React，就用一个迷你 hook 运行时 + 桩 primitives），补上「客户端半边无法观测」的空缺：
  正常路径之外还覆盖了**被拒绝的删除（409 session-live 的本地化措辞 + 对话框保持打开 + 不乱刷新）**、
  **批量清理部分失败（逐个尝试 + 分开汇报 + 带原因 + 仍只刷新一次）**、**目标在运行中变成活会话（计为跳过而非失败）**；
- `tools/force-reload.mjs` / `tools/probe-reload.mjs` 分别回答「树还重建吗」「配置还生效吗」。

> **判定显示类问题的第一步永远是**：`node tools/verify-boot.mjs --scan`，再在出问题的窗口
> Console 里敲 `location.href` —— 先确认「你盯着的窗口」和「工具报的实例」是同一个。
> 这一步能省掉一小时瞎猜（本次就是靠它一次定位的，可惜我之前把版本判断写错了）。

> 本机现状：两个实例**都 MOUNTED**。`web` profile 是 `patchReload: live`，装上即热重载生效；
> 刷新浏览器标签页就能看到。

---

**坑四：给已挂载的插件改名，不能在一步里做完。**
把包名从 `@deepseek-ai/dsh-client-ui-session-delete` 改成 `dsh-plugin-session-delete` 时我踩了这条：
运行中的实例仍挂着旧行、client-hmr 还在按 1 秒轮询旧包的 bundle，而**旧字节和新字节注册的是同一批槽位 id**
（`session-delete`、`session-cleanup`）—— 同一个 list 格子里同 id 同优先级第二次注册会抛错，
于是**下一次刷新页面会直接 boot 失败**。更早一步我先删了旧包目录，还让树卡在"不重建"的状态里。

正确的顺序与补救：

1. **先改注册，再删文件**：把补丁里的旧行换掉，等实例重建完，再删旧包目录。安装脚本现在就是这么做的 ——
   它会查询运行中实例的插件图，只要旧名字还在图里就**保留**旧文件并提示（`--prune-legacy` 可强制）。
2. 已经卡住时不要慌：旧行的 bundle 是**从内存里**提供的（客户端模块注册表在组合时抓过字节），
   所以文件删了它也照样发给浏览器。给旧名字放一个**墓碑 bundle** 就能让那一行"能加载但什么都不注册"：

   ```js
   // <profile>/node_modules/<旧包名>/lib/client.js
   window.__ModuleLoader__.load({ id: "<旧包名>", factory: () => ({ inject: [], apply() {} }) })
   ```

   配一个同名 `package.json`（`dsh.client` + `exports["./client"]`）和一个空的 `lib/index.js`；
   写入后新 mtime 会让轮询重新读取，旧行就变成无害的哑巴。
3. 实例重启后旧行从组合里消失，再跑一次 `node install.mjs`（或 `--uninstall`）就会把墓碑目录清掉。

## 5. 验证结果

| 检查 | 结果 |
|---|---|
| `node --test "tests/*.test.ts"`（Host 路由 10 个分节 + 清理计划 + 词典对齐） | **21/21** |
| `node tools/verify-artifact.mjs`（同样的 Host 场景，跑在**构建产物** `lib/index.js` 上） | **39/39** |
| 真实磁盘布局断言（本机 68 个真实会话目录 == `encodeSegment(id)`；`projectKey(cwd)` 复现真实项目目录名） | 通过 |
| `tools/build.mjs` 自检（浏览器 bundle 能作为经典脚本解析；Node 面能导入并导出预期符号） | 通过 |
| 上游 bundle 补丁 diff：`git apply --check` 于真实 `web-app/cordis.patch.yml` | 干净 |
| `tools/verify-browser.mjs`（真实加载构建产物 + 渲染 + 驱动交互，含**拒绝 / 部分失败 / 竞态**三条错误路径） | **42/42** |
| 本机两个实例（19387 桌面应用 / 3080 `dsh web`）的浏览器插件图**都**含本行且已进入预加载批次 | 通过（`--scan`） |
| **真实浏览器窗口里人眼确认可用**（会话 `...` 菜单出现「删除对话」、侧边栏出现「清理空会话」） | 通过 —— 这一格是唯一无法用工具代替的一步 |

---

## 6. 落到上游仓库

[`PR.md`](PR.md) 是可直接改写成 PR 描述的版本。需要的改动只有两处：

1. 新增 `packages/client/ui-session-delete/`（把本工作区该目录整体搬过去）；
2. 在 `packages/bundle/web-app/cordis.patch.yml` 的浏览器插件名册里插一行 ——
   见 [`upstream/web-app-cordis.patch.yml.diff`](upstream/web-app-cordis.patch.yml.diff)
   （锚定在 `ui-workspace` 之后，6 行，实测可干净应用）。

另外 [`docs/upstream-issue-session-persistence-location.md`](docs/upstream-issue-session-persistence-location.md)
是给核心的提案：给 `SessionPersistence` 加一个 `locate(id)`（而不是 `remove`），让插件不必复刻
后端的路径编码（本包现在复刻了 `projectKey`/`encodeSegment`，并用真实磁盘布局断言 + 目录扫描
兜底 + 包含性闸门兜住风险）。提案里也写清了为什么删除不该由存储层负责：活会话的释放口在
agent loop、子会话 lineage、附件无引用计数、两个派生只读模型。

---

## 7. 许可与来源

MIT。工作区内的第三方 API 事实（包名、槽位名、种子模块表、路径编码算法、YAML/JS 行为）
均取自本机安装的 `@deepseek-ai/*` 0.2.0-rc.2 制品，仅为互操作所需；
`tools/asar.mjs` 是本工作区自写的读取工具。
