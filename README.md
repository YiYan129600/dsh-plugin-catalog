# dsh-plugin-catalog

DSH 设置 → 插件 → 插件清单的第三方改进插件：让每个插件的用途一眼看懂（中文名 + 一句话描述 + 版本），支持按泛概念模糊搜索（远程 / 看板 / 宠物…），每日自动检测更新，可一键更新并可跳转 GitHub。

单包双半：宿主半 `lib/index.js`（元数据 / AI 摘要 / 更新检测服务）+ 客户端半 `lib/client.js`（清单 tab 界面）。

## 安装（领导手工两步，本插件不自动执行）

```bash
dsh plugin --profile web add link:D:/work/dsh-plugin-catalog
# 然后重启 dsh web
```

## 开发

```bash
pnpm install      # 沙箱环境请加 --store-dir <白名单内路径>
pnpm build        # tsdown → lib/index.js + lib/client.js
pnpm test         # vitest（jsdom）
pnpm typecheck    # tsc --noEmit
```

## 任务进度

- 任务 1（本轮）：骨架 + GitHub —— 可构建、可被 DSH 识别的 bundle 包，已推至公开仓库。
- 任务 2：宿主元数据服务（PluginMetaService）。
- 任务 3：客户端清单页 + 模糊搜索。
- 任务 4：AI 摘要 + 更新检测。
- 任务 5：收尾。

详见 `PROGRESS.md` / `BLOCKED.md`。
