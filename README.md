# dsh-plugin-catalog

DSH 设置 → 插件 → 插件清单的第三方改进插件：让每个插件的用途一眼看懂（中文概括名 + 英文缩略名 + 一句话描述 + 版本徽章），支持按泛概念模糊搜索（搜「远程」命中 dsh-ssh、搜「看板」命中 task-board、搜「宠物」命中 whale-girl…），每日自动检测更新、可一键更新，并可跳转 GitHub。

单包双半 bundle：宿主半 `lib/index.js`（PluginMetaService / SummaryService / UpdateCheckService / UpdateRunner + `/api/plugin-catalog/*` 路由）+ 客户端半 `lib/client.js`（设置页「插件目录」tab）。

## 功能说明

- **一眼看懂**：每张卡片显示中文概括名 + 英文缩略名 + 一句话描述 + 版本徽章 + 启用状态；in-box 官方包用内置词表、第三方插件可一键生成 AI 中文摘要（复用 DSH 已配置的模型 API，先 token 预估后生成，缓存 key = `pkg@version`）。
- **模糊搜索**：别名（内置 13 条 + 用户 `~/.dsh/plugin-aliases.json`）→ 分词 → 子序列三级匹配，命中高亮，无结果给建议词。
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

验收基线：`pnpm test` 90/90、skip 0；`pnpm build` 产物存在；`pnpm typecheck` 0 错误；`npm pack --dry-run` 无错（14 文件、119.8 kB）。

详见 `PROGRESS.md` / `BLOCKED.md`。
