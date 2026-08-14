# dsh-plugin-catalog — PROGRESS

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

（历史：任务 0 回执见上。）
