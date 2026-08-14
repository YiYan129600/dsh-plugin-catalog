# dsh.plugin 元数据公约（dsh-plugin-convention）

> 适用对象：任何希望自己的插件在 **DSH 插件目录**（设置 → 插件 → 插件目录，`dsh-plugin-catalog`）中「一眼看懂」的插件作者。
> 配套实现：无依赖校验器 `src/plugin-manifest.ts`（`validateDshPluginManifest` / `validateDshPluginField`）；目录页展开区可一键「导出 dsh.plugin 片段」生成符合本公约的 JSON。
> 版本：v0.2.0（与目录页一起演进）。

## 1. 公约内容

在插件的 `package.json` 中新增可选的 `dsh.plugin` 段：

```json
{
  "name": "dsh-ssh",
  "description": "Remote command execution, file transfer, port forwarding and cluster ops for dsh",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "plugin": {
      "displayName": { "zh": "SSH 远程运维", "en": "SSH Remote Ops" },
      "description": { "zh": "远程执行命令、传输文件、端口转发与集群并发运维", "en": "Remote command execution, file transfer, port forwarding and cluster ops for dsh" },
      "categories": ["remote", "ops"],
      "aliases": ["ssh", "远程", "服务器", "隧道", "部署"]
    }
  }
}
```

| 字段 | 类型 | 可选 | 含义 |
|---|---|---|---|
| `displayName.zh` | string | ✅ | 中文显示名（建议 ≤10 字） |
| `displayName.en` | string | ✅ | 英文显示名（缺失回退顶层 `name`） |
| `description.zh` | string | ✅ | 中文一句话简介（建议 ≤40 字） |
| `description.en` | string | ✅ | 英文简介（缺失回退顶层 `description`） |
| `categories` | string[] | ✅ | 分类 id 列表（见 §2） |
| `aliases` | string[] | ✅ | 检索别名：中文泛概念词 + 英文关键词 |

**全部字段可选**，缺失即回退：`displayName.en` ← 顶层 `name`，`description.en` ← 顶层 `description`；都缺则目录页降级为缩略名样式，绝不报错。

## 2. 分类 id

目录页内置静态分类器（`src/categories.ts` 的 `CATEGORY_DEFS`），作者声明时建议使用同一套 id；未声明时目录页仍会按关键词自动归类：

| id | 标签 | 典型插件 |
|---|---|---|
| `remote` | 远程 | SSH 远程运维、手机远程控制 |
| `ui` | 界面 | 侧边栏、皮肤中心、设置面板 |
| `pets` | 宠物 | 桌宠、鲸鱼娘 |
| `ops` | 运维任务 | 任务看板、实时统计、更新检测 |
| `design` | 设计 | OpenPencil 画布 |
| `ai` | 智能 | 智能体、摘要、技能、流程 |
| `web` | 联网 | 搜索、抓取、浏览器桥 |
| `storage` | 存储 | 会话、缓存、凭据、附件 |

## 3. 别名的三层来源

1. **作者自声明**（本公约 `dsh.plugin.aliases`）——优先级最高；
2. **内置词表**（目录页 `BUILTIN_ALIAS_ENTRIES`，覆盖官方 in-box 与 web-ui 家族）；
3. **用户自定义** `~/.dsh/plugin-aliases.json`（只读，`{ "包名": ["词", …] }` 或行数组）。

搜索按「中文名/别名 > 描述 > keywords > moduleName > entryId」加权，支持中文、英文、**拼音**（自写静态音节表，如 `yuan cheng` → 远程、`kan ban` → 看板，零第三方依赖）。

## 4. 校验器用法（无依赖，可直接在 Node 中 import）

```js
import { validateDshPluginField, validateDshPluginManifest } from 'dsh-plugin-catalog'

// 校验整个 package.json（自动读 dsh.plugin，并回退顶层 name/description）
const result = validateDshPluginField(pkg)
if (result.ok) {
  console.log(result.value) // 归一化后的 manifest（缺失字段已回退）
} else {
  console.error(result.errors) // 字段级错误列表
}

// 或只校验裸的 dsh.plugin 值
validateDshPluginManifest(rawPluginValue, { name: 'my-pkg', description: '…' })
```

规则：

- `dsh.plugin` 必须是对象（不是 null / 数组 / 字符串）；
- `displayName` / `description` 必须是 `{ zh?, en? }` 对象，值必须是非空字符串；
- `categories` / `aliases` 必须是字符串数组（元素非空）；
- 其余未知键容忍（公约是增量演进的，不拒绝未来字段）。

## 5. 反哺闭环

目录页展开区「导出 dsh.plugin 片段」按钮：一键把「内置中文表/AI 摘要生成的中文名与简介 + 自动分类 + 别名」序列化为本公约 JSON 并复制到剪贴板，作者粘贴回自己仓库的 `package.json` 即可——AI 摘要结果反哺生态（规划 §5.4 闭环）。

## 6. 示例

**正例（合法）**：

```json
{
  "displayName": { "zh": "任务看板", "en": "Task Board" },
  "description": { "zh": "多列看板管理任务，可定时执行", "en": "Kanban task board with cron schedules" },
  "categories": ["ops", "ui"],
  "aliases": ["看板", "定时", "kanban", "cron"]
}
```

**反例（校验失败）**：

```json
{ "displayName": "任务看板" }
// → errors: ["displayName: 必须是对象 { zh?, en? }"]

{ "categories": "ops" }
// → errors: ["categories: 必须是字符串数组"]

{ "aliases": [42, "ssh"] }
// → errors: ["aliases[0]: 必须是非空字符串"]

{ "displayName": { "zh": 42 } }
// → errors: ["displayName.zh: 必须是非空字符串"]
```

**最小合法（其余全部回退）**：

```json
{ "aliases": ["ssh", "远程"] }
```
