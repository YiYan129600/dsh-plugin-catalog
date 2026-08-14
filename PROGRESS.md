# dsh-plugin-catalog — PROGRESS

## 任务 1 完成（v0.2.0 轮，2026-02-23）— 汉化开关 + 翻译授权 + 内置中文表，验收全绿

### 交付

- `src/localize.ts`（双半共用纯模块，host `export *` 透出、client 相对导入内联）：`BUILTIN_ZH_TABLE` 内置中文表 **145 条**（nameZh ≤10 字、descZh ≤40 字；覆盖 `dsh --profile web --dump-config` 枚举的全部 **129 个 in-box 非 group** `@deepseek-ai` 模块名，逐条按 `~/.dsh/profiles/node_modules/<pkg>/package.json` 真实 description 翻译；另含核心第三方 ssh/task-board/pet/whale-girl 等 16 条）+ 汉化开关/翻译授权常量与纯函数（`readLocalizeOn` 默认开、`readTranslateOptIn`/`shouldAskTranslateOptIn` 未设置=询问、`canTranslate` need→全部/否则仅 registry+github、`zhNameFor`/`zhDescFor` 表>AI 摘要、`NO_ZH_DESC`「暂无中文简介」、`localizeCardText` 渲染契约、`TRANSLATE_DIALOG_COPY` 询问框文案含成本说明）。
- 客户端 `src/client/index.tsx`：头部「汉化」开关（localStorage `dsh.pluginCatalog.localize` 默认开，关=英文原样：缩略名+原始 description）；首次进入（`dsh.pluginCatalog.translateOptIn` 未设置）弹一次性「是否需要中文翻译？」选择框（需要/不需要+成本说明文字），头部「翻译设置」随时重开（已选过则带取消）；卡片中文优先渲染（nameZh 主显、descZh 副显、英文缩略名保留小字、descZh 缺失→「暂无中文简介」）；「翻译此插件」按钮（原「AI 生成中文摘要」改名）：选「需要」→ 所有插件（含官方 in-box）显示，选「不需要」→ 仅第三方（D8 原样），复用 SummaryService 状态机（token 预估→生成→写缓存即时上卡）。
- 测试：`tests/localize.test.mjs` **16 用例**（开关默认开/关闭回英文/中文表 ≥90 且含核心/覆盖全部 129 个 in-box 非 group 条目/长度约束/未设置渲染询问框/选需要→官方有翻译按钮/选不需要→官方无第三方有/未选择按 D8/持久化往返/翻译成功渲染/表优先于 AI 摘要/descZh 缺失占位/文案含成本说明）。
- 验收全绿：`pnpm test` **106/106、skip 0**（8 文件：基线 90 + localize 16）；`pnpm build` 产物 lib/index.js（99.8 kB）+ lib/client.js（77.3 kB）存在；`pnpm typecheck` 0 错误；`npm pack --dry-run` 无错（15 文件、165.5 kB，含 src/localize.ts）。
- 反向验证（红→绿，证据见会话记录）：把 `BUILTIN_ZH_TABLE` 临时注入为空 `{}` → **5 用例红**（汉化开启中文优先渲染、表优先于 AI 摘要、条目数 ≥90、含核心、覆盖全部 in-box；101/106）；还原 → 106/106 全绿。
- git：本轮改动 = `src/localize.ts`（新）、`src/client/index.tsx`、`src/index.ts`（+1 行 export）、`tests/localize.test.mjs`（新），已提交；推送 + tag v0.2.0 属任务 3 收尾。

### 决策记录（为什么这么走）

- **localize 表键用 loader 模块名（name: 值）而非 entryId**：渲染时按 `entry.moduleName` 精确查表；`dsh-tool-subagent-control/list-agents`、`dsh-web-app/startup` 两个子路径名也按 dump 原样入表。
- **渲染契约收敛到纯函数 `localizeCardText`**：卡片/展开区一律走它，测试直接断言契约结果（无需 DOM/React 渲染），同时保住「内置表清空→汉化渲染用例红」的反向验证路径（5 红里含渲染用例）。
- **「翻译此插件」按钮权限 = `canTranslate(sourceKind, optIn)` 纯函数**：optIn='need' → true（含 in-box/link/unknown）；否则仅 registry/github；optIn=null（未选择、弹窗期间）按 D8 第三方-only，避免未授权时官方插件出现付费按钮。
- **表内条目优先于 AI 摘要**：D10「内置中文表始终生效（零成本）」——翻译成功只补充表外条目，绝不覆盖表内译文。
- **未新增任何依赖**：localize.ts 仅 import `moduleShortName`（search.ts，已存在），客户端沿用单 style 注入（client-bundle 形状测试仍绿）。

### 下一任务

- 任务 2：拼音搜索（自写静态音节表，`yuan cheng`→远程、`kan ban`→看板）+ 分类 chips + 导出 dsh.plugin 片段 + 公约文档与无依赖校验器。

## 任务 0 开工回执（2026-02-23）

- 实测数字全部符合现状：node v24.18.0 / pnpm 11.7.0 / git 2.55.0 / gh 2.97.0（YiYan129600，token 含 repo scope）；dsh CLI 在 PATH；GUI dsh web @127.0.0.1:3080 HTTP 200；~/.dsh/profiles/web 存在。
- npm 网络通：`npm view tsdown version --cache <白名单内路径>` = 0.22.14（默认缓存路径被沙箱拒，见 BLOCKED.md，后续安装类命令一律带 --cache/--store-dir 指向白名单内）。
- `gh repo view YiYan129600/dsh-plugin-catalog` → GraphQL「Could not resolve to a Repository」，符合「应报不存在」。
- tsdown 构建通：scratch 目录安装 tsdown v0.22.14，build 成功产出 dist/index.mjs（exit 0），scratch 已删除。

## 任务 1 完成（2026-02-23）

### 交付

- `D:/work/dsh-plugin-catalog` 成为可构建、可被 DSH 识别的单包双半 bundle（包名 `dsh-plugin-catalog`，patch 行 id `plugin-catalog`），git 已提交（`c293b72`）并推上公开仓库 `https://github.com/YiYan129600/dsh-plugin-catalog`（main 分支）。
- 验收全绿：`pnpm build`（lib/index.js + lib/client.js 存在）、`npm pack --dry-run` 无错、git log ≥1 提交、remote=github.com/YiYan129600/dsh-plugin-catalog、`gh repo view --json visibility` = PUBLIC；反向验证（临时删 cordis.patch.yml → node 断言红；还原 → 绿）证据见会话记录。
- 工具链：tsdown 0.22.14（构建 lib/）+ vitest 3.2.7（jsdom，threads 池）+ tsc typecheck；`pnpm test` 3/3 绿、skip 0。

### 决策记录（为什么这么走）

- **单包双半**（非 AGENTS.md 里 monorepo 设想）：任务书「单包双半：包名 dsh-plugin-catalog、patch 行 id plugin-catalog；宿主 lib/index.js + 客户端 lib/client.js」更具体、是唯一任务来源，按它执行。
- **settings.plugins.tab 注册放客户端半**：任务书写「宿主半（先占位：注册空 settings.plugins.tab）」，但实测 DSH 架构里 `ctx.slots` 是浏览器运行时服务（`@deepseek-ai/dsh-client-runtime/client` 注入），宿主进程没有 slots 注册表；官方表面插件（dsh-client-ui-settings-plugins / -plugin-inventory / task-board）的宿主半都是空 `apply`、slot 注册全在 client.js。因此：宿主半空 apply（仿官方），客户端半注册空 tab（id=plugin-catalog、order=20、空组件占位，任务 3 换真页面）。id 与「空 tab 占位」意图均保留。
- **客户端 bundle 自包 `window.__ModuleLoader__.load({id, factory})`**：官方产物是 classic script（factory(require) 闭包内整图、外部依赖 require()），无顶层 import/export；tsdown 会把无模块语句的入口补 `export {}`（classic script 里是语法错误）→ 用 `scripts/fix-client-bundle.mjs` postbuild 剥离。任务 3 客户端 UI 若引入 react，需继续沿用「相对模块内联 + 外部依赖 require()」模式（已在 BLOCKED.md 记）。
- **测试路线（沙箱所迫，见 BLOCKED.md）**：vitest 不能碰 esbuild（service spawn 用管道被拒）→ 配置/测试全纯 JS（.mjs），被测代码一律导入构建产物 `lib/`（纯 ESM，无 TS 语法，vite 不会调用 esbuild 转换它）；`pnpm test` 先构建再跑。测试内禁用 `new URL(..., import.meta.url)`（会触发 vite:asset ?url 导入，.ts 文件被喂给 esbuild）。

### 下一任务

- 任务 2：宿主 PluginMetaService（resolveBundleDir 读 package.json → PluginMeta + sourceKind 判定 + git+https 归一化），Typert Remote list；vitest fixture 用例（走 lib/ 产物或独立纯 JS 模块）。

## 任务 2 完成（2026-02-23 本轮）

### 交付

- 宿主半新增 `src/meta.ts`（纯逻辑 + 类型）与 `src/index.ts` 的 `PluginMetaService`（Typert Remote `pluginMeta/list`，仿官方 `PluginInventoryGateway` 结构：`static inject = ['loader']` + `@Remote('list')`）。
- `list()` 遍历 loader 非 group 条目，为每个 `moduleName` 产出 `meta{packageName,version,description,keywords,repository,homepage,license,sourceKind,summary}`；解析失败→`meta:null` 不抛（规划 §5.1）。
- 解析规则与 `dsh plugin` CLI 一致（dsh-app-boot `resolveBundleDir` 语义，自实现同算法并在注释标注出处）：install anchor 优先、profile dir 其次，`createRequire(anchor).resolve.paths` 探测 `package.json`。
- sourceKind 判定：registry（semver spec）/ github（github:/git+https 等）/ link（link:/file:/相对路径）/ in-box（`dsh.profile.bundles` 里有、dependencies 里无）/ unknown；`git+https://…git` 归一化为 `https://…`（含 `{type,url}` 对象形式与 `github:owner/repo` 简写）。
- summary 缓存：读 `~/.dsh/cache/plugin-summaries.json`（可注入路径），key=`pkg@version`，缺失为 null。
- 验收全绿：`pnpm test` 13/13、skip 0（contract 3 + meta 新增 10 用例：registry/github/link/in-box 四 sourceKind、git+https 归一化、meta:null 降级、profile anchor 解析、summary 缓存、service list 集成、未知模块降级）；`pnpm build` 产物 lib/index.js + lib/client.js 存在；`pnpm typecheck` 0 错误；`npm pack --dry-run` 无错。
- 反向验证（红→绿证据见会话记录）：删 `tests/fixtures/profile/node_modules/whale-girl/package.json` 的 `repository` 字段 → github 判定用例红（`expected null to be 'https://github.com/vlln/whale-girl'`，2 处）；还原 → 全绿。

### 决策记录（为什么这么走）

- **装饰器转译走 postbuild 而非换构建器**：`@Remote('list')` 是 TC39 stage-3 标准装饰器，tsdown 0.22 经 rolldown/oxc 不转译 ecma 装饰器（oxc-project/oxc#9170 open），产物保留 `@Remote(...)` 语法导致 Node `SyntaxError: Invalid or unexpected token`。官方表面插件用 esbuild 转（`__esDecorate` helper），但沙箱禁 esbuild（BLOCKED.md）。改用已装依赖 typescript 的 `transpileModule` 在进程内做等价降级（`scripts/lower-decorators.mjs` postbuild，仅当产物含装饰器语法时改写 lib/index.js）——同 `__esDecorate` 形状，已在会话中实测 node 可正常 import 降级产物。另设 `target: 'node18'`（无 target 时 tsdown 完全不做语法转换）。
- **`deps.external` → `deps.neverBundle`**：tsdown 0.22 把 `external` 废弃并静默忽略（产物曾内联 cordis/typert-protocol 到 82KB）；改 `deps.neverBundle` 后 12KB，@deepseek-ai/* 保持 external，宿主运行时共享同一 cordis 实例（Service instanceof/Remote marker 表不分裂）。
- **re-export 用 `export *`**：rolldown tree-shake 会丢弃「仅具名 re-export 而未在 index.ts 内部使用」的符号，测试导入 `buildPluginMeta` 等失败；改 `export * from './meta.ts'` 后全部导出保留。
- **新 devDependency**：`@deepseek-ai/dsh-typert-protocol`（0.1.0-rc.6，TypertRemoteService/Remote 装饰器，peer 声明 + devDep 供测试解析）、`@types/node`（host 半用 node:fs/module/path/os，typecheck 需要）；tsconfig 加 `allowImportingTsExtensions` + `types: ["node"]`。

### 下一任务

- 任务 3：客户端清单页 + 模糊搜索（tab 真页面替换任务 1 占位，L1 别名 ≥10 条含 dsh-ssh→远程/task-board→看板/whale-girl→宠物）。

## 任务 3 完成（2026-02-23 本轮）

### 交付

- 客户端 `src/client/index.tsx` 替换任务 1 占位 tab（`settings.plugins.tab`，id `plugin-catalog`、order 20、label「插件目录」）：单列卡片（中文概括名 nameZh + 英文缩略名 + 一句话描述 + 版本徽章 + fiber 状态点 + 已启用/停用 + 展开区 + 仓库 ↗ 新窗口跳转 + homepage）、双列紧凑切换并 localStorage 持久化（键 `dsh.pluginCatalog.layout`）、搜索框防抖 200ms + useMemo、命中高亮（<mark>）、无结果给「最接近的 3 个建议」+ 快捷 chips、加载/错误/重试态。
- 宿主 `src/routes.ts` + `src/index.ts`：`/api/plugin-catalog/list` 路由（loopback fence，仿 @linxin666/dsh-remote-web-ui 注明出处），包装 Task-2 的 PluginMetaService.list()，附用户自定义别名 `~/.dsh/plugin-aliases.json`（只读、失败降级空表）；宿主新增 `export const inject = ['webServer']`。
- 搜索核心 `src/search.ts`（双半共用、纯函数）：L1 内置别名词表 **13 条**（含必须三条：dsh-ssh→[远程,服务器]、task-board→[看板,定时]、whale-girl/pet→[宠物,桌宠]）+ 用户别名归一化（map/数组两形态）；L2 分词子串（权重 中文名 400 > 描述 100 > keywords 60 > moduleName 30 > entryId 10）；L3 子序列打分；`moduleShortName` 照抄官方清单 tab（注明出处）；`highlightRanges` 合并区间；`suggestQueries` 无结果建议；`QUICK_CHIP_QUERIES` 快捷 chips。
- 测试：`tests/search.test.mjs`（16 用例：三条必须命中 + 无结果建议 + L2/L3/大小写/中文名/空查询/用户别名/缩略名/别名解析/归一化/高亮/chips）、`tests/routes.test.mjs`（11 用例：路由 200/403/405/500 + fence 各类判定）、`tests/client-bundle.test.mjs`（2 用例：classic script 形状 + jsdom 执行注册 apply/inject + 样式注入一次）。
- 验收全绿：`pnpm test` **42/42、skip 0**（5 文件）；`pnpm build` 产物 lib/index.js + lib/client.js 存在；`pnpm typecheck` 0 错误；`npm pack --dry-run` 无错；宿主 ESM 导出完整（search/routes/meta + apply/inject）。
- 反向验证（红→绿证据见会话记录）：把 `BUILTIN_ALIAS_ENTRIES` 整块清空 → 6 用例红（含「远程」`expected [] to include '@linxin666/dsh-ssh'`、「看板」「宠物」同形、≥10 条断言红）；还原 → 42/42 全绿。

### 决策记录（为什么这么走）

- **客户端传输走宿主 HTTP 路由而非 typert remote**：typert 客户端命名空间需要 dsh-typert-generator 生成的 `typert.remote-client.js` contribution（本项目无生成步骤）；`ctx.remote.pluginMeta.list()` 无法直接可用。第三方参照 @linxin666/dsh-remote-web-ui 就用「宿主 `ctx.webServer.register` + 客户端 `fetch('/api/...')`」模式（loopback fence 同款），照抄并注明出处。Task-2 的 Typert Remote `list` 保留（协议层能力），HTTP 路由是其薄封装。
- **客户端构建切换为 dsh-web-ui 家族预设**（`format: 'cjs'` + `platform: 'browser'` + outputOptions banner/footer/intro 包 `window.__ModuleLoader__.load`）：任务 1 的「入口自带 load 调用、零值导入」写法无法承载 React/外部依赖——ESM 格式会把 external 打成顶层 `import`（classic script 语法错误）。新预设下 externals（react）变 factory 内 `require()`、相对模块（search.ts）内联进 factory，产物 0 顶层 import/export（有 client-bundle 测试锁定形状）。`fix-client-bundle.mjs` 相应改为「无可剥则提示并放行」（CJS 产物本无 `export {}`）。
- **`src/search.ts` 双半共用**：宿主 `export * from './search.ts'`（测试走 lib/index.js），客户端相对导入内联——一份实现、两处打包、测试打宿主副本。
- **中文名来源（规划 §5.2）本任务落地为**：`meta.summary.nameZh`（Task-2 已从缓存读）> 缩略名回退；in-box 内置词表与 AI 摘要属 Task-4（SummaryService）范围，UI 已留好字段。
- **用户别名文件只读**：`~/.dsh/plugin-aliases.json` 存在则读（归一化后随 list 响应下发客户端合并），失败静默空表——遵守「不写 ~/.dsh」。

### 下一任务

- 任务 4：SummaryService（README 抓取 + 用户模型提炼 + 缓存）+ UpdateCheckService（npm 优先/GitHub 回退/link 不查/每日 1 次）+ UpdateRunner（只生成命令）；客户端版本/更新徽标与按钮状态机；宿主继续往 `src/routes.ts` 挂 `/api/plugin-catalog/...` 路由。

## 任务 4 完成（2026-02-23 本轮）

### 交付

- 宿主 `src/summary.ts`（SummaryService，规划 §5.5）+ `src/update.ts`（UpdateCheckService + UpdateRunner，规划 §5.6）补完；`src/index.ts` 宿主接线：`apply` 内建 SummaryService/UpdateCheckService（metaProvider 读实时 loader 的 PluginMetaService.list()），`/api/plugin-catalog/{list,updates,summary,summary/estimate,update}` 五路由全部挂上（loopback fence 沿用）；`src/routes.ts` 补 summary/updates/update 路由（GET updates 带 `force=1` 查询、POST summary/estimate/summary/update，缺数据缝降级 501），删除残留的重复 `CatalogRouteDeps` 接口声明。
- 客户端 `src/client/index.tsx`：更新徽标（↑新版本 / 最新 / 无法检查 / 本地链接，绝不误报「最新」）+ 每卡「检查更新 / 更新此插件」按钮与 `UpdateUiState` 状态机（idle→checking→checked/error→command，command 态显示可复制 `pnpm update` 命令 + 重启提示，D9 只提示不执行）+ 工具栏「检查全部更新」（force）+ AI 摘要按钮（仅第三方 registry/github，D8）与 `SummaryUiState` 状态机（idle→estimating→estimate(tokens 预估)→generating→success/error，成功刷新列表立即显示缓存摘要）。
- 测试：`tests/summary.test.mjs`（24 用例：README 抓取顺序/base64 回退/仓库解析/截断+token 预估/严格 JSON 校验/生成管线+缓存 key=pkg@version/Service 降级与 e2e）、`tests/update.test.mjs`（24 用例：prerelease 版本比较/link 不查/npm 优先/GitHub releases+tags 回退/全败=「无法检查」且注入 fetch 抛错同判/探针 TTL/24h 缓存+force/UpdateRunner 命令生成/statusFromLatest）、`tests/routes.test.mjs` 扩到 5 路由断言。
- 验收全绿：`pnpm test` **90/90、skip 0**（7 文件，任务 3 基线 42 + summary 24 + update 24）；`pnpm build` 产物 lib/index.js + lib/client.js 存在；`pnpm typecheck` 0 错误；`npm pack --dry-run` 无错（14 文件、119.8 kB）。
- 反向验证（红→绿证据见会话记录）：把 `checkOnePackage` 全败分支临时改为 `status: 'up-to-date'`（被规划禁止的误报）→ 「全败=无法检查」「注入 fetch 抛错」2 用例红（88/90）；还原 → 90/90 全绿。

### 决策记录（为什么这么走）

- **半成品三个实现 bug（读懂后修复，未推倒重来）**：(1) `parseGitHubRepo`/`parseGitHubRepository` 的 `const [, owner, repo] = pathname.split('/').filter(Boolean)` 少看了一层——filter 已去掉前导空串，前导逗号把 owner 跳成了 repo 名（实测所有仓库解析返回 null，8 个 summary 用例 + 5 个 update 用例全挂）；改为 `const [owner, repo]`。(2) `truncateReadme` 多了一个 `\n`（6006 > 测试钉死的 6005 上界），去掉换行符。(3) 客户端两处 TS2322：属性访问收窄（payload.command / payload.estimatedTokens）不进入 setState 闭包，先捕获到局部 const 再闭包使用。
- **半成品测试数据自相矛盾（按正确行为修正数据，未放宽任何断言、未删任何用例）**：update.test.mjs 里 3 处 mock「npm latest 0.2.0 vs current 0.11.0」却断言 `update-available`——按 semver（并对照 @linxin666/dsh-remote-web-ui/lib/types/update.js 参照）0.2.0 < 0.11.0 只能判「最新」，该数据永远无法转绿；把 mock latest 改为 0.12.0（与 fixture 的 dsh-ssh 0.11.0 自洽），断言原样保留。
- **`readmeCandidateUrls` 探针顺序微调**：HEAD/readme.md（小写变体）从第二位挪到 main/master 之后——测试（未动）钉死「HEAD 404 → 第二位是 main」，README.md 大写是压倒性惯例、小写变体保底仍在（正确性不变），避免为迁就实现去改验收测试。
- **SummaryService 用 DSH 宿主进程环境变量取模型配置**（`envApiConfigProvider`：DSH_API_* 覆盖 DEEPSEEK_*，无 key 返回 null → UI 提示「去设置配模型」），D7 复用已配模型、不新增配置面；缓存写 `~/.dsh/cache/plugin-summaries.json`（可注入路径，key=pkg@version，temp+rename 原子写）。UpdateCheckService 缓存 `plugin-updates.json`（lastCheckAt + entries + 按源的 probes TTL npm 1h/GitHub 24h），非 force 且 <24h 直接回缓存，force 重探但 TTL 内复用新鲜探针结果。
- 测试数：90 ≥ 基线 42+16+11；skip 0；未碰判卷标准与 fixture。

### 下一任务

- 任务 5：全量 pnpm test+build+typecheck；README（安装=领导一条命令 + 重启生效）；PROGRESS.md 终态；BLOCKED.md 汇总；git 提交（含任务 4 全部改动）并推送 GitHub（按 BLOCKED.md 已记录的 openssl + token 一次性 URL 方案）。

## 任务 5 完成（2026-02-23 本轮）— 收尾，全部验收绿

### 交付

- 任务 4 收尾核对：上一轮已完成并提交（`b87d77a`），本轮重跑四项验收命令全部绿（见下），无未提交改动。
- 全量验收（命令输出见会话记录）：
  - `pnpm test` → **90/90、skip 0**（7 文件：contract 3 / routes 11 / client-bundle 2 / search 16 / summary 24 / meta 10 / update 24）。
  - `pnpm build` → 产物 `lib/index.js`（73.1 kB）+ `lib/client.js`（47.9 kB）存在。
  - `pnpm typecheck` → 0 错误（exit 0）。
  - `npm pack --dry-run`（`--cache` 白名单内）→ 无错：14 文件、119.8 kB、exit 0。
- 任务 4 反向验证（红→绿，本轮重做）：把 `checkOnePackage` 全败分支临时改为 `status: 'up-to-date'`（规划禁止的误报）→ `tests/update.test.mjs` 2 用例红（88/90：「ALL probes failing = cannot-check, NEVER a wrong up-to-date」「injected fetch that THROWS also lands on cannot-check」）；还原 → 90/90 全绿。
- 任务 5 反向验证（红→绿）：先按任务书字面往 `lib/client.js` 末尾追加 `this is not javascript(!!` → `pnpm build` **仍绿**（exit 0，tsdown 第一段 `clean: true` 先清空 lib/ 再从 src 重建，产物被覆盖，字面操作无法产生红，实测留证）；改把同一语法错误注入其生成源 `src/client/index.tsx` → `pnpm build` **红**（`[PARSE_ERROR] Unexpected token`，exit 1，lib/client.js 未产出）；`git checkout` 还原 → 绿（build exit 0，产物 73.1/47.9 kB，`pnpm test` 90/90）。注：注入/还原全程用 git 与二进制字节校验，未污染源码编码。
- README.md 终态：安装=领导一条命令 `dsh plugin --profile web add link:D:/work/dsh-plugin-catalog` + 重启 dsh web 生效；功能说明（中文名/模糊搜索/每日更新检测/一键更新/跳 GitHub/双列布局/AI 摘要仅第三方）；开发命令；任务进度全 5 项。
- git：提交 `task 5: closeout`（README/PROGRESS/BLOCKED 终态；任务 4 改动已在 `b87d77a` 包含），按 BLOCKED.md 方案推送（`git -c http.sslBackend=openssl push` + token 一次性 URL），推完 remote 还原干净 URL（`https://github.com/YiYan129600/dsh-plugin-catalog.git`）。远端 `main` = 本地 HEAD，工作树干净。
- 硬指标核对：白名单外 0 改动（本轮只动仓库内 README/PROGRESS/BLOCKED）；未重启 dsh web；未写 ~/.dsh；验收命令与测试文件未放宽、未删除。

### 决策记录（为什么这么走）

- **README 一次写到位**：任务书要求「安装=领导一条命令 + 重启生效 + 功能说明」，原 README 只有骨架和过时进度，直接重写终态版（保留安装命令原样）。
- **git 提交单条收尾**：任务 4 已提交于 `b87d77a`，任务 5 提交只含文档终态，推送后远端即含全部源码 + PROGRESS.md + BLOCKED.md。
- **推送沿用任务 1 已记录方案**（BLOCKED.md 任务 1 节）：`git -c http.sslBackend=openssl push https://x-access-token:<token>@github.com/...`（schannel 报 SEC_E_NO_CREDENTIALS、credential helper 经 msys sh 管道被拒）；推完立即 `git remote set-url` 还原干净 URL；全程未用 `git fetch`。

（历史：任务 0 回执见上。）
