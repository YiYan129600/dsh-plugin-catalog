# dsh-plugin-catalog

DSH 设置 → 插件 → 插件目录的第三方改进插件（v0.2.0）：让每个插件的用途一眼看懂（中文概括名 + 英文缩略名 + 一句话描述 + 版本徽章），支持按泛概念模糊搜索（搜「远程」命中 dsh-ssh、搜「看板」命中 task-board、搜「宠物」命中 whale-girl…），拼音搜索（`yuan cheng`→远程、`kan ban`→看板）、分类 chips 筛选、导出 `dsh.plugin` 元数据片段，每日自动检测更新、可一键更新，并可跳转 GitHub。

单包双半 bundle：宿主半 `lib/index.js`（PluginMetaService / SummaryService / UpdateCheckService / UpdateRunner + `/api/plugin-catalog/*` 路由）+ 客户端半 `lib/client.js`（设置页「插件目录」tab）。

## 功能说明

- **一眼看懂**：每张卡片显示中文概括名 + 英文缩略名 + 一句话描述 + 版本徽章 + 启用状态；in-box 官方包用内置词表、第三方插件可一键生成 AI 中文摘要（复用 DSH 已配置的模型 API，先 token 预估后生成，缓存 key = `pkg@version`）。
- **汉化开关**：目录头部开关「汉化」，默认**开**（localStorage 键 `dsh.pluginCatalog.localize`）；开启时中文优先渲染（`nameZh` 主显、`descZh` 副显、英文缩略名保留小字、`descZh` 缺失显示「暂无中文简介」），关闭时英文原样显示。
- **翻译授权**：首次进入标签页弹一次性询问「是否需要中文翻译？」（localStorage 键 `dsh.pluginCatalog.translateOptIn`，未设置=询问，含 token 成本说明）——选「需要」→ 所有插件（含官方 in-box）显示「翻译此插件」按钮；选「不需要」→ 按原约定仅第三方插件显示。选择随时可在头部「翻译设置」更改；无论选择如何，内置中文表（零成本）始终生效。
- **内置中文表**：`src/localize.ts` 静态表 145 条，覆盖 `dsh --profile web --dump-config` 枚举的全部 129 个 in-box 非 group 模块（nameZh ≤10 字、descZh ≤40 字，按真实 package.json description 翻译），零 API 成本。
- **模糊搜索**：别名（内置 13 条 + 用户 `~/.dsh/plugin-aliases.json`）→ 分词 → 拼音（自写静态音节表 458 字，零依赖）→ 子序列四级匹配，命中高亮，无结果给建议词。
- **分类 chips**：工具栏静态分类器（remote/ui/pets/ops/design 必备五类 + ai/web/storage），点选过滤列表、与搜索取交集、带每类计数。
- **导出 dsh.plugin 片段**：卡片展开区「导出 dsh.plugin 片段」→ 一键复制 JSON（displayName/description/aliases/categories，取自内置中文表 + AI 摘要 + 别名词表），为上游反哺备料；元数据公约与无依赖校验器见 `docs/dsh-plugin-convention.md`（`src/plugin-manifest.ts`）。
- **更新检测**：`link:` 本地链接不检查；npm `/latest` 优先、GitHub releases/tags 回退；全部失败如实显示「无法检查」，绝不误报「最新」；默认每日检查 1 次（惰性，>24h），工具栏可手动刷新（force）。
- **一键更新**：单卡「更新此插件」/ 工具栏「检查全部更新」；更新成功后只提示复制重启命令，不自动重启（避免断开会话）。
- **布局**：单列默认，可切双列紧凑（localStorage 持久化）；展开栏可跳转 GitHub 仓库。

## 安装（领导手工一步，本插件不自动执行）

```bash
dsh plugin --profile web add link:D:/work/dsh-plugin-catalog
# 然后重启 dsh web 生效
```

## 开发

```bash
pnpm install      # 沙箱环境请加 --store-dir <白名单内路径>
pnpm build        # tsdown → lib/index.js + lib/client.js
pnpm test         # vitest（jsdom），先构建再测
pnpm typecheck    # tsc --noEmit
npm pack --dry-run
```

## 任务进度

- 任务 1：骨架 + GitHub（可构建、可被 DSH 识别的 bundle 包，已推公开仓库）。
- 任务 2：宿主元数据服务（PluginMetaService + Typert Remote `pluginMeta/list`）。
- 任务 3：客户端清单页 + 模糊搜索 + 双列布局 + `/api/plugin-catalog/list` 路由。
- 任务 4：AI 摘要（SummaryService）+ 更新检测（UpdateCheckService / UpdateRunner）+ 客户端徽标与按钮状态机 + 五个 HTTP 路由。
- 任务 5：收尾（全量验收、README、PROGRESS/BLOCKED 终态、git 提交并推送 GitHub）。
- v0.2.0 任务 1：汉化开关 + 一次性翻译授权 + 内置中文表（`src/localize.ts`，145 条）。
- v0.2.0 任务 2：拼音搜索 + 分类 chips + 导出 dsh.plugin 片段 + 公约文档与无依赖校验器。
- v0.2.0 任务 3：收尾——版本 0.2.0、README 更新、全量验收重跑、git 提交推送 + tag v0.2.0。

验收基线（v0.2.0）：`pnpm test` 123/123、skip 0；`pnpm build` 产物存在；`pnpm typecheck` 0 错误；`npm pack --dry-run` 无错（19 文件、212.2 kB）。

详见 `PROGRESS.md` / `BLOCKED.md`。
