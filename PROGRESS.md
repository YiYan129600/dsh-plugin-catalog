# dsh-plugin-catalog — PROGRESS

## 任务 0 开工回执（2026-02-23）

- 实测数字全部符合现状：node v24.18.0 / pnpm 11.7.0 / git 2.55.0 / gh 2.97.0（YiYan129600，token 含 repo scope）；dsh CLI 在 PATH；GUI dsh web @127.0.0.1:3080 HTTP 200；~/.dsh/profiles/web 存在。
- npm 网络通：`npm view tsdown version --cache <白名单内路径>` = 0.22.14（默认缓存路径被沙箱拒，见 BLOCKED.md，后续安装类命令一律带 --cache/--store-dir 指向白名单内）。
- `gh repo view YiYan129600/dsh-plugin-catalog` → GraphQL「Could not resolve to a Repository」，符合「应报不存在」。
- tsdown 构建通：scratch 目录安装 tsdown v0.22.14，build 成功产出 dist/index.mjs（exit 0），scratch 已删除。

## 任务 1 完成（2026-02-23 本轮）

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

（历史：任务 0 回执见上。）
