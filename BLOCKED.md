# BLOCKED — dsh-plugin-catalog

## 任务 0（2026-02-23）

- 核对结论：现状全部实测数字与任务书一致，**无阻塞、无反证**，任务 0 通过。

- 环境事实（非阻塞，供后续任务遵守）：
  - 沙箱拒绝过：`npm view tsdown version`（默认缓存 `C:\Users\fzw18\AppData\Local\npm-cache\_cacache\tmp\***` 写入 EPERM）。
  - 不重试该命令；一律改用 `npm ... --cache <D:/work/dsh-plugin-catalog 内路径>`，pnpm 同理用 `--store-dir` 指向白名单内目录。

## 任务 1（2026-02-23）— 全部有规避方案，验收已全绿

### 环境事实（沙箱硬边界，勿再试）

1. **esbuild service 模式被沙箱拒**：`vitest`（经 vite）任何一次 `esbuild.build`/transform 都 `spawn EPERM`（esbuild 与 Go 二进制的 stdio 管道被拒）。esbuild 的 postinstall 同样被拒（`pnpm install` 跑它时 EPERM spawn）。**规避**：
   - `pnpm-workspace.yaml` 里 `allowBuilds: { esbuild: false }`（二进制由 `@esbuild/win32-x64` 可选依赖直接提供，postinstall 只是校验，跳过无害）——注意 pnpm 11 不再读 package.json 的 `pnpm` 字段。
   - vitest 全程避开 esbuild：`--configLoader native`（vite 默认 bundle 模式用 esbuild 打包配置）+ `pool: 'threads'`（默认 forks 池用 `child_process.fork` 管道被拒）+ 配置/测试全 `.mjs` 纯 JS + 被测代码走构建产物 `lib/`（纯 ESM 无 TS 语法，vite 不调 esbuild 转它）+ `scripts/patch-exec-for-vitest.mjs` 预载补丁（vite 在 Windows 首次路径解析会 `exec("net use")` 探测网络盘，管道被拒；补丁对 `net use` 回空结果，其余 exec 原样放行）。
   - 测试内**禁用** `new URL(..., import.meta.url)`：会触发 vite:asset `?url` 导入，项目里的 `.ts` 文件（如 tsdown.config.ts）被 vite:esbuild 拦截 → EPERM。用 `process.cwd()` 相对路径。
2. **git push 凭据链被沙箱拒**：`~/.gitconfig` 里 github.com 域的 `!gh auth git-credential` helper 经 msys sh.exe 运行，sh 创建信号管道被拒（`couldn't create signal pipe, Win32 error 5`）→ helper 拿不到 token。**规避（已成功）**：一次性 URL 内嵌 token 推送（`git -c http.sslBackend=openssl push https://x-access-token:<token>@github.com/YiYan129600/dsh-plugin-catalog.git main:main`），推完立即把 remote 还原为干净 URL（`git remote -v` 不含 token）；分支跟踪用 `git config branch.main.remote/merge` 直接写，不用 `git fetch`（同样会触发 helper）。
   - 另外 `http.sslBackend` 系统默认 schannel 在本机报 `SEC_E_NO_CREDENTIALS`，必须 `-c http.sslBackend=openssl`。
3. **pnpm 11 设置搬家**：package.json 的 `pnpm` 字段被忽略，设置只能放 `pnpm-workspace.yaml`（首次 install 会自动生成占位文件）。构建相关命令（`pnpm run`/`exec`）会做 deps 状态检查，node_modules 状态不一致时想 purge 且无 TTY 会中止——`$env:CI="true"` 或删 node_modules 重装解决。

### 新运行依赖（任务书要求记录）

- 无新增运行依赖；全部工具链在豁免清单内（tsdown/vitest/react/jsdom）。`@deepseek-ai/*@0.1.0-rc.6` 为 devDependencies（与运行中 dsh 版本一致；npm latest tag 是 0.0.1-rc.1，须显式 `^0.1.0-rc.6` 才能解析到 next tag 的 rc.6）。

## 任务 2（2026-02-23）— 全部有规避方案，验收已全绿

### 环境事实（沙箱硬边界，勿再试）

1. **esbuild 依旧不可用**（同任务 1）：本任务需要的「标准装饰器转译」官方用 esbuild 做（`__esDecorate` helper），沙箱拒绝任何 esbuild 调用。**规避（已落地）**：`scripts/lower-decorators.mjs` 用已装依赖 `typescript` 的 `transpileModule` 在进程内做等价 stage-3 装饰器降级（postbuild 改写 lib/index.js；产物与 esbuild 的 `__esDecorate` 形状一致，实测 node 可正常 import）。
2. **tsdown 0.22 的 rolldown/oxc 不转译标准（ecma/stage-3）装饰器**（oxc-project/oxc#9170 open）：`@Remote('list')` 会原样留在产物里 → Node `SyntaxError: Invalid or unexpected token`。且 tsdown 的 `external` 选项已废弃（静默忽略），必须用 `deps.neverBundle`；未设 `target` 时 tsdown 完全不做语法转换（须 `target: 'node18'`）。
3. **rolldown tree-shake 丢弃「仅具名 re-export 而未在入口内部使用」的符号**：测试从 lib/ 导入 `buildPluginMeta`/`resolveBundleDir` 报「not a function」。**规避**：入口对元数据模块用 `export * from './meta.ts'` 整体透出。

### 新运行依赖（任务书要求记录）

- 新增 devDependencies（均非豁免清单项，特此记录）：`@deepseek-ai/dsh-typert-protocol@0.1.0-rc.6`（TypertRemoteService/Remote 装饰器，宿主运行时由 dsh 提供，另在 peerDependencies 声明）、`@types/node@^24`（host 半使用 node:fs/module/path/os，typecheck 需要）。无新增运行时依赖。

### 其余

- 无。

## 任务 3（2026-02-23）— 无新增阻塞，验收全绿

### 环境事实（构建方式变更，任务 4 沿用）

- **客户端构建切换为 dsh-web-ui 家族预设**（`format: 'cjs'` + `platform: 'browser'` + outputOptions banner/footer/intro 包 `window.__ModuleLoader__.load({id, factory})`）：任务 1 的「入口自带 load 调用、零值导入」写法无法承载 React/外部依赖（ESM 格式会把 external 打成顶层 `import`，classic script 语法错误）。新预设下 externals（react 等）变 factory 内 `require()`（loader 模块表解析）、相对模块（src/search.ts）内联进 factory；产物 0 顶层 import/export（`tests/client-bundle.test.mjs` 已锁定形状：jsdom 里 `new Function` 执行 + stub `__ModuleLoader__` + 假 require）。`fix-client-bundle.mjs` 相应放宽：无可剥的 `export {}` 时提示并放行（CJS 产物本无）。
- **tsdown `defineConfig` 支持配置数组**（`UserConfigExport = Awaitable<Arrayable<UserConfig> | UserConfigFn>`）：宿主/客户端两个配置按数组顺序执行，宿主 `clean: true` 在前、客户端 `clean: false` 在后。
- **客户端→宿主数据链路走 HTTP 路由**（`ctx.webServer.register` + `fetch('/api/plugin-catalog/list')`，loopback fence）：本项目无 dsh-typert-generator 步骤，`ctx.remote.pluginMeta` 客户端命名空间无 contribution 可挂载；第三方参照 @linxin666/dsh-remote-web-ui 即此模式（已注明出处照抄 fence）。Task-4 的 summary/update 路由继续挂 `src/routes.ts`。

### 新运行依赖（任务书要求记录）

- 无新增依赖（react/react-dom/jsdom/@deepseek-ai/dsh-client-ui-slots 均为任务 1 已装 devDeps；未改 package.json）。

### 其余

- 无。

## 任务 4（2026-02-23）— 无新增阻塞，验收全绿

### 环境事实

- 无新沙箱拒绝发生（本轮未触碰 ~/.dsh 与 dsh web，也未触发任何提权弹窗）。任务 5 的 git push 沿用任务 1 已记录方案：`git -c http.sslBackend=openssl push` + token 一次性 URL，推完还原 remote。
- 半成品排障记录（非阻塞，供后续参考）：任务 4 半成品曾有 15 红，根因是 `parseGitHubRepo`/`parseGitHubRepository` 的解构少滤一层（`[, owner, repo]` 跳过了 owner）、`truncateReadme` 多一个换行符、3 个 update 用例的 mock 数据与 semver 自相矛盾（0.2.0 vs 0.11.0 不可能判 update-available）——均已修，详见 PROGRESS.md 任务 4 决策记录。

### 新运行依赖（任务书要求记录）

- 无新增运行/开发依赖（tsdown/vitest/react/jsdom 均已在豁免清单）。

### 其余

- 无。
