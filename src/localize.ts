/**
 * dsh-plugin-catalog — built-in Chinese localization table + translate
 * opt-in logic (plan §5.8 / decision D10, v0.2.0).
 *
 * Pure, dependency-free module shared by BOTH halves (and the vitest suite),
 * exactly like `src/search.ts`: the host re-exports it through `src/index.ts`
 * (tests import the built `lib/index.js`), the browser half inlines it via its
 * relative import. It performs no I/O and touches no DOM.
 *
 * Responsibilities:
 *   1. `BUILTIN_ZH_TABLE` — the zero-cost built-in Chinese table covering
 *      every in-box (template-bundled `@deepseek-ai/*`) non-group entry
 *      enumerated from `dsh --profile web --dump-config` (129 module names),
 *      plus the core third-party entries (ssh / task-board / pet / whale-girl
 *      etc.). Constraints: nameZh ≤ 10 chars, descZh ≤ 40 chars, each
 *      descZh translated from the real package.json `description`.
 *   2. 汉化开关 (`dsh.pluginCatalog.localize`, default ON): when off the
 *      cards render the English original; when on Chinese wins.
 *   3. 一次性翻译授权 (`dsh.pluginCatalog.translateOptIn`, unset = ask on
 *      first visit): 「需要」→ every plugin (in-box included) gets the manual
 *      「翻译此插件」 button; 「不需要」→ only third-party (registry/github),
 *      per D8. The built-in table always applies regardless of the choice.
 *   4. Rendering contract `localizeCardText` — single source of truth the
 *      browser half uses for card text, so the tests exercise the exact
 *      render decision without a DOM.
 */
import { moduleShortName } from './search.ts'

/** One built-in table row: Chinese display name + one-line Chinese description. */
export interface LocalizeEntry {
  nameZh: string
  descZh: string
}

/** localStorage key of the 汉化 switch (D10: default on). */
export const LOCALIZE_KEY = 'dsh.pluginCatalog.localize'

/** localStorage key of the one-time translate opt-in (D10: unset = ask). */
export const TRANSLATE_OPTIN_KEY = 'dsh.pluginCatalog.translateOptIn'

/** The persisted translate choice. */
export type TranslateOptIn = 'need' | 'no-need'

/** Shown when an entry has no Chinese description (table miss AND no AI summary). */
export const NO_ZH_DESC = '暂无中文简介'

/** Structural view of the localStorage surface (testable without a DOM). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

/**
 * Built-in Chinese table. Keys are the loader `moduleName` values enumerated
 * from `dsh --profile web --dump-config` (real rows; 129 in-box non-group
 * `@deepseek-ai/*` entries + the installed core third-party entries), each
 * translated from the package's actual `description` (read-only
 * `~/.dsh/profiles/node_modules/<pkg>/package.json`). nameZh ≤ 10 chars and
 * descZh ≤ 40 chars for every row; the table applies regardless of the
 * translateOptIn choice (zero cost).
 */
export const BUILTIN_ZH_TABLE: Record<string, LocalizeEntry> = {
  // ── in-box: @deepseek-ai template bundles (dsh-base / dsh-web-app) ──
  '@deepseek-ai/cordis-plugin-hmr': { nameZh: '热更新', descZh: 'Cordis 热模块替换插件' },
  '@deepseek-ai/cordis-plugin-timer': { nameZh: '定时器', descZh: 'Cordis 定时器服务' },
  '@deepseek-ai/dsh-agent': { nameZh: '智能体', descZh: '智能体接口、注册表与事件体系' },
  '@deepseek-ai/dsh-agent-default-model': { nameZh: '默认模型', descZh: '智能体入口共用的默认模型选择' },
  '@deepseek-ai/dsh-agent-instructions': { nameZh: '指令加载', descZh: '加载 AGENTS.md 等指令文件' },
  '@deepseek-ai/dsh-agent-loop': { nameZh: '智能体循环', descZh: '智能体主循环插件' },
  '@deepseek-ai/dsh-agent-presets': { nameZh: '智能体预设', descZh: '按预设组装每会话智能体' },
  '@deepseek-ai/dsh-api-gateway': { nameZh: 'API 网关', descZh: 'Typert 远程分发与客户端 API 端点' },
  '@deepseek-ai/dsh-api-remotes': { nameZh: '远程装配', descZh: '远程 BFF 装配与主机查询策略' },
  '@deepseek-ai/dsh-attachment-local': { nameZh: '附件存储', descZh: 'DSH_HOME 内私有附件存储' },
  '@deepseek-ai/dsh-bash-sandbox': { nameZh: '命令沙箱', descZh: '沙箱化的 bash 命令执行' },
  '@deepseek-ai/dsh-bridge-browser': { nameZh: '浏览器桥', descZh: '浏览器扩展 WebSocket 桥接与浏览器工具' },
  '@deepseek-ai/dsh-client-connection': { nameZh: '连接层', descZh: 'HTTP 上行 WebSocket 下行连接与重连' },
  '@deepseek-ai/dsh-client-hmr': { nameZh: '前端热更', descZh: '开发期客户端热重载驱动' },
  '@deepseek-ai/dsh-client-locale': { nameZh: '本地化', descZh: '中英文偏好与语言快照' },
  '@deepseek-ai/dsh-client-modules': { nameZh: '模块系统', descZh: '客户端模块系统（入口图与模块表）' },
  '@deepseek-ai/dsh-client-runtime': { nameZh: '客户端核心', descZh: '插槽注册与会话运行时等核心服务' },
  '@deepseek-ai/dsh-client-ui-agent-preset': { nameZh: '智能体预设界面', descZh: '智能体预设与组合编辑器界面' },
  '@deepseek-ai/dsh-client-ui-commands': { nameZh: '命令面板', descZh: '斜杠命令目录与三类命令界面' },
  '@deepseek-ai/dsh-client-ui-conversation': { nameZh: '会话界面', descZh: '会话骨架、聊天流与输入器' },
  '@deepseek-ai/dsh-client-ui-cordis': { nameZh: '动态插件卡', descZh: 'Cordis 动态插件定义卡片' },
  '@deepseek-ai/dsh-client-ui-deliverables': { nameZh: '成果文件', descZh: '产出文件列表与可点击引用' },
  '@deepseek-ai/dsh-client-ui-goal': { nameZh: '目标栏', descZh: '会话目标栏（悬浮于输入器上方）' },
  '@deepseek-ai/dsh-client-ui-input-trigger': { nameZh: '输入触发', descZh: '斜杠与 @ 触发、候选菜单' },
  '@deepseek-ai/dsh-client-ui-jobs': { nameZh: '任务列表', descZh: '会话头部后台任务实时列表' },
  '@deepseek-ai/dsh-client-ui-layout': { nameZh: '界面布局', descZh: '三栏应用框架与拖拽布局' },
  '@deepseek-ai/dsh-client-ui-message-feedback': { nameZh: '消息反馈', descZh: '消息点赞/评价反馈控件' },
  '@deepseek-ai/dsh-client-ui-model-selection': { nameZh: '模型选择', descZh: '会话模型切换弹窗' },
  '@deepseek-ai/dsh-client-ui-permission-presets': { nameZh: '权限设置', descZh: '权限预设界面与会话权限弹窗' },
  '@deepseek-ai/dsh-client-ui-plan': { nameZh: '计划模式', descZh: '计划模式输入控件与命令通道' },
  '@deepseek-ai/dsh-client-ui-settings': { nameZh: '设置基座', descZh: '设置命名空间与插槽契约' },
  '@deepseek-ai/dsh-client-ui-settings-general': { nameZh: '常规设置', descZh: '设置-常规分区与欢迎说明' },
  '@deepseek-ai/dsh-client-ui-settings-models': { nameZh: '模型设置', descZh: '模型设置与配置引导弹窗' },
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory': { nameZh: '插件清单', descZh: '设置中的只读插件清单页' },
  '@deepseek-ai/dsh-client-ui-settings-plugins': { nameZh: '插件设置', descZh: '插件设置分区与插件卡片' },
  '@deepseek-ai/dsh-client-ui-sidebar': { nameZh: '侧边栏', descZh: '会话树、搜索与分组侧边栏' },
  '@deepseek-ai/dsh-client-ui-skill': { nameZh: '技能界面', descZh: '技能引用与技能工具行' },
  '@deepseek-ai/dsh-client-ui-subagent': { nameZh: '子代理界面', descZh: '子代理会话目录与继续路由' },
  '@deepseek-ai/dsh-client-ui-theme': { nameZh: '主题', descZh: '明暗主题令牌与外观设置' },
  '@deepseek-ai/dsh-client-ui-tool': { nameZh: '工具界面', descZh: '工具调用树渲染与展示' },
  '@deepseek-ai/dsh-client-ui-trajectory': { nameZh: '轨迹记录', descZh: '轨迹事件账本与时间轴概览' },
  '@deepseek-ai/dsh-client-ui-user-questions': { nameZh: '提问界面', descZh: '向用户提问的功能界面' },
  '@deepseek-ai/dsh-client-ui-workflow-run': { nameZh: '流程运行', descZh: '工作流运行的会话节点展示' },
  '@deepseek-ai/dsh-client-ui-workspace': { nameZh: '工作区选择', descZh: '工作区选择器（侧边栏）' },
  '@deepseek-ai/dsh-code-runtime-worker-thread': { nameZh: '代码运行', descZh: '工作线程代码执行实现' },
  '@deepseek-ai/dsh-command-compact': { nameZh: '压缩命令', descZh: '手动压缩会话的斜杠命令' },
  '@deepseek-ai/dsh-command-feedback': { nameZh: '反馈命令', descZh: '会话反馈记录与斜杠命令' },
  '@deepseek-ai/dsh-command-goal': { nameZh: '目标命令', descZh: '会话内目标的斜杠命令' },
  '@deepseek-ai/dsh-commands': { nameZh: '命令注册', descZh: '插件级人类命令注册表' },
  '@deepseek-ai/dsh-compaction-basic': { nameZh: '上下文压缩', descZh: '按 token 触发的上下文压缩策略' },
  '@deepseek-ai/dsh-compaction-tool-result-pruner': { nameZh: '结果裁剪', descZh: '工具结果安全裁剪（头中尾）' },
  '@deepseek-ai/dsh-cordis-client-runner': { nameZh: '动态插件前端', descZh: '双半插件的浏览器半边运行器' },
  '@deepseek-ai/dsh-cordis-host-runner': { nameZh: '动态插件宿主', descZh: '双半插件定义与宿主半边生命周期' },
  '@deepseek-ai/dsh-credentials-local': { nameZh: '凭据存储', descZh: '基于 .env 文件的本地凭据提供' },
  '@deepseek-ai/dsh-fs-observation-policy': { nameZh: '文件观察', descZh: '文件读取-编辑-版本守卫策略' },
  '@deepseek-ai/dsh-fs-sandbox': { nameZh: '文件沙箱', descZh: '沙箱化的读写编辑文件操作' },
  '@deepseek-ai/dsh-goal': { nameZh: '目标管理', descZh: '会话内目标状态与生命周期' },
  '@deepseek-ai/dsh-goal-round-driver': { nameZh: '目标轮次', descZh: '会话目标轮次驱动器' },
  '@deepseek-ai/dsh-host-apiproxy': { nameZh: '主机代理', descZh: 'API 代理契约与 fetch 通道' },
  '@deepseek-ai/dsh-host-directory-picker-auto': { nameZh: '目录选择', descZh: '自适应目录选择后端' },
  '@deepseek-ai/dsh-host-plugin-inventory': { nameZh: '插件清单服务', descZh: '插件装载器状态的只读投影' },
  '@deepseek-ai/dsh-host-webserver': { nameZh: 'Web 服务', descZh: 'HTTP/升级路由注册与静态回退' },
  '@deepseek-ai/dsh-jobs-local': { nameZh: '后台任务', descZh: '进程内后台任务注册表' },
  '@deepseek-ai/dsh-llm': { nameZh: '大模型服务', descZh: '模型无关的 LLM 服务接口' },
  '@deepseek-ai/dsh-llm-deepseek': { nameZh: '模型适配', descZh: 'DeepSeek 对话补全适配器' },
  '@deepseek-ai/dsh-llm-pi-ai': { nameZh: 'PI 模型适配', descZh: 'pi-ai 驱动的 DeepSeek 适配器' },
  '@deepseek-ai/dsh-llm-retry': { nameZh: '重试策略', descZh: '按供应商路由的请求重试' },
  '@deepseek-ai/dsh-message-feedback': { nameZh: '消息评价', descZh: '消息评分与备注的附属存储' },
  '@deepseek-ai/dsh-permission-presets': { nameZh: '权限预设', descZh: '沙箱模式与审批策略预设' },
  '@deepseek-ai/dsh-plan-mode': { nameZh: '计划模式', descZh: '智能体计划模式与退出审查' },
  '@deepseek-ai/dsh-pwsh-sandbox': { nameZh: '命令沙箱', descZh: '沙箱化的 PowerShell 命令执行' },
  '@deepseek-ai/dsh-repeat-tool-reminder': { nameZh: '重复提醒', descZh: '重复调用工具时给出提醒' },
  '@deepseek-ai/dsh-sandbox-local': { nameZh: '本地沙箱', descZh: '本地进程沙箱后端（多平台）' },
  '@deepseek-ai/dsh-sandbox-policy': { nameZh: '沙箱策略', descZh: '逐调用沙箱策略解析' },
  '@deepseek-ai/dsh-session': { nameZh: '会话存储', descZh: '事件溯源的会话存储' },
  '@deepseek-ai/dsh-session-checkpoint-policy': { nameZh: '会话检查点', descZh: '模型请求前的会话持久化检查点' },
  '@deepseek-ai/dsh-session-log-export': { nameZh: '日志导出', descZh: '会话日志导出命令与下载弹窗' },
  '@deepseek-ai/dsh-session-persistence-jsonl': { nameZh: 'JSONL 存储', descZh: 'JSONL 格式的会话持久化' },
  '@deepseek-ai/dsh-session-projection': { nameZh: '会话投影', descZh: '会话派生状态投影注册表' },
  '@deepseek-ai/dsh-session-projection-cache': { nameZh: '投影缓存', descZh: '会话投影持久化缓存' },
  '@deepseek-ai/dsh-session-query-sqlite': { nameZh: '会话检索', descZh: '基于 SQLite 的会话搜索' },
  '@deepseek-ai/dsh-session-stats': { nameZh: '会话统计', descZh: '全量会话计数与耗时统计' },
  '@deepseek-ai/dsh-session-telemetry-otel': { nameZh: '遥测上报', descZh: 'OpenTelemetry 遥测后端' },
  '@deepseek-ai/dsh-session-title': { nameZh: '会话标题', descZh: '基于日志的会话标题服务' },
  '@deepseek-ai/dsh-session-title-first-prompt-llm': { nameZh: '标题生成', descZh: '用首条消息生成会话标题' },
  '@deepseek-ai/dsh-settings-file': { nameZh: '设置存储', descZh: '基于 settings.yaml 的设置提供' },
  '@deepseek-ai/dsh-shell-env': { nameZh: '环境变量', descZh: '受管 DSH_* 环境变量注册' },
  '@deepseek-ai/dsh-skill': { nameZh: '技能注册', descZh: '智能体技能提供者注册表' },
  '@deepseek-ai/dsh-skill-badge': { nameZh: '徽章技能', descZh: '内置 dsh 徽章技能' },
  '@deepseek-ai/dsh-skill-filesystem': { nameZh: '文件技能', descZh: '本地文件系统技能' },
  '@deepseek-ai/dsh-spill-local': { nameZh: '溢出存储', descZh: '本地溢出文件存储实现' },
  '@deepseek-ai/dsh-spill-policy': { nameZh: '溢出策略', descZh: '超长工具结果转溢出文件' },
  '@deepseek-ai/dsh-storage': { nameZh: '存储中枢', descZh: '命名存储后端注册表与挂载' },
  '@deepseek-ai/dsh-storage-domain': { nameZh: '域存储', descZh: '带校验与事件的 KV 域存储' },
  '@deepseek-ai/dsh-storage-json': { nameZh: 'JSON 存储', descZh: 'JSON 文件 KV 存储后端' },
  '@deepseek-ai/dsh-subagent': { nameZh: '子代理接口', descZh: '子代理委托的抽象接口' },
  '@deepseek-ai/dsh-subagent-fork-in-process': { nameZh: '子代理分叉', descZh: '进程内分叉子代理后端' },
  '@deepseek-ai/dsh-subagent-spawn-in-process': { nameZh: '子代理派生', descZh: '进程内新起子代理后端' },
  '@deepseek-ai/dsh-subprocess-local': { nameZh: '子进程', descZh: '本地子进程执行实现' },
  '@deepseek-ai/dsh-system-prompt': { nameZh: '系统提示', descZh: '系统提示词组装注册表' },
  '@deepseek-ai/dsh-token-meter': { nameZh: 'Token 计量', descZh: '防重放的 token 计量服务' },
  '@deepseek-ai/dsh-tool-bash': { nameZh: 'Bash 工具', descZh: '面向模型的 bash 执行工具' },
  '@deepseek-ai/dsh-tool-call-timeout-policy': { nameZh: '超时策略', descZh: '工具调用超时控制' },
  '@deepseek-ai/dsh-tool-fs': { nameZh: '文件工具', descZh: '读、写、编辑文件工具' },
  '@deepseek-ai/dsh-tool-fs-search': { nameZh: '搜索工具', descZh: 'glob 与 grep 文件搜索工具' },
  '@deepseek-ai/dsh-tool-goal': { nameZh: '目标工具', descZh: '面向模型的目标管理工具' },
  '@deepseek-ai/dsh-tool-jobs': { nameZh: '任务工具', descZh: '后台任务输出与停止工具' },
  '@deepseek-ai/dsh-tool-pwsh': { nameZh: 'Pwsh 工具', descZh: '面向模型的 PowerShell 工具' },
  '@deepseek-ai/dsh-tool-ralph': { nameZh: 'Ralph 工具', descZh: '新代理循环执行的 Ralph 工具' },
  '@deepseek-ai/dsh-tools': { nameZh: '工具管线', descZh: '工具注册与执行流水线' },
  '@deepseek-ai/dsh-tool-skill': { nameZh: '技能工具', descZh: '加载技能指令的工具' },
  '@deepseek-ai/dsh-tool-str-replace-editor': { nameZh: '文本编辑工具', descZh: '查看创建与替换插入的编辑工具' },
  '@deepseek-ai/dsh-tool-subagent': { nameZh: '子代理工具', descZh: '委托子代理执行任务的工具' },
  '@deepseek-ai/dsh-tool-subagent-control': { nameZh: '子代理控制', descZh: '消息、中断、列表子代理工具' },
  '@deepseek-ai/dsh-tool-subagent-control/list-agents': { nameZh: '子代理列表', descZh: '子代理控制（列表）工具' },
  '@deepseek-ai/dsh-tool-subagent-report': { nameZh: '子代理汇报', descZh: '子代理范围内汇报结果工具' },
  '@deepseek-ai/dsh-tool-todo': { nameZh: '待办工具', descZh: '面向模型的任务清单工具' },
  '@deepseek-ai/dsh-tool-web': { nameZh: '联网工具', descZh: '联网搜索与抓取工具' },
  '@deepseek-ai/dsh-tool-workflow': { nameZh: '流程工具', descZh: '运行 JS 编排脚本的工作流工具' },
  '@deepseek-ai/dsh-typert-loader': { nameZh: 'Typert 装载', descZh: 'Typert 包贡献的装载集成' },
  '@deepseek-ai/dsh-typert-registry': { nameZh: 'Typert 注册', descZh: '包反射与校验模式的运行时注册' },
  '@deepseek-ai/dsh-user-approval': { nameZh: '用户审批', descZh: '用户审批决策通道' },
  '@deepseek-ai/dsh-user-questions': { nameZh: '用户提问', descZh: '向用户提问的抽象接口' },
  '@deepseek-ai/dsh-web': { nameZh: '联网能力', descZh: '搜索/抓取提供者注册与词汇' },
  '@deepseek-ai/dsh-web-app': { nameZh: 'Web 应用', descZh: '浏览器面补丁层与运行胶水' },
  '@deepseek-ai/dsh-web-app/startup': { nameZh: 'Web 启动', descZh: 'Web 应用启动插件' },
  '@deepseek-ai/dsh-web-search-deepseek': { nameZh: '深度搜索', descZh: 'DeepSeek 驱动的联网搜索提供者' },
  '@deepseek-ai/dsh-workflow-worker-thread': { nameZh: '流程引擎', descZh: '工作线程工作流引擎' },
  '@deepseek-ai/dsh-workspace': { nameZh: '工作区', descZh: '工作区实体注册与附件管理' },

  // ── core third-party entries installed on this machine (ssh/task-board/pet
  // ── are acceptance-critical: the table must contain them) ──
  '@linxin666/dsh-ssh': { nameZh: '远程运维', descZh: '远程执行命令、传输文件、端口转发与集群并发运维' },
  '@linxin666/dsh-client-ui-task-board': { nameZh: '任务看板', descZh: '多列看板管理任务，可定时执行' },
  '@linxin666/dsh-pet': { nameZh: '桌宠', descZh: '鲸鱼娘桌面宠物，跟随模型状态互动' },
  'whale-girl': { nameZh: '鲸鱼桌宠', descZh: 'DSH 内置桌面宠物摆件' },
  'dsh-better-sidebar': { nameZh: '增强侧边栏', descZh: '仿 VSCode 的右侧边栏（资源/终端/Git）' },
  '@zseven-w/dsh-openpencil': { nameZh: '设计画布', descZh: 'OpenPencil 设计画布集成' },
  '@linxin666/dsh-web-ui-all': { nameZh: '界面全家桶', descZh: 'web-ui 插件家族聚合安装包' },
  '@linxin666/dsh-client-ui-web-ui-settings': { nameZh: '界面设置', descZh: 'web-ui 家族插件的开关与配置面板' },
  '@linxin666/dsh-client-ui-aionui-panel': { nameZh: '右侧面板', descZh: '仿 AionUi 的资源管理器与预览面板' },
  '@linxin666/dsh-client-ui-git-graph': { nameZh: '提交图', descZh: '会话头部的 Git 分支选择与提交图' },
  '@linxin666/dsh-remote-web-ui': { nameZh: '手机远程', descZh: '扫码配对，手机远程控制 Web 界面' },
  '@linxin666/dsh-live-stats': { nameZh: '实时统计', descZh: '实时 token 估算与生成吞吐' },
  '@linxin666/dsh-client-ui-skin-center': { nameZh: '皮肤中心', descZh: '界面内试穿与一键应用皮肤' },
  'dsh-mobile-access': { nameZh: '手机接入', descZh: '扫码配对的手机远程访问设置' },
  'dsh-plugin-catalog': { nameZh: '插件目录', descZh: '插件目录页：汉化、搜索、更新检测' },
  '@deepseek-ai/dsh-mcp-client': { nameZh: 'MCP 客户端', descZh: '连接 MCP 服务器并注册其工具' },
}

/** Copy of the one-time translate dialog (含成本说明文字, D10). */
export const TRANSLATE_DIALOG_COPY = {
  title: '是否需要中文翻译？',
  body: '开启后所有插件卡片将优先显示中文名称与简介：官方内置插件使用本地中文表（零成本），第三方插件可手动点「翻译此插件」（按 README 长度预估 token，会消耗您的模型额度）。选择后可在头部「翻译设置」随时更改。',
  needLabel: '需要',
  noNeedLabel: '不需要',
} as const

/**
 * Read the 汉化 switch. Default ON (D10): any absent/garbage value means the
 * Chinese-first rendering stays on; only an explicit '0'/'false'/'off' turns
 * it off. Storage failures degrade to the default, never throw.
 */
export function readLocalizeOn(storage: StorageLike | null | undefined): boolean {
  try {
    if (storage === null || storage === undefined) return true
    const value = storage.getItem(LOCALIZE_KEY)
    if (value === null) return true
    return value !== '0' && value !== 'false' && value !== 'off'
  } catch {
    return true
  }
}

/** Persist the 汉化 switch; storage failures degrade silently. */
export function persistLocalizeOn(storage: StorageLike | null | undefined, on: boolean): void {
  try {
    storage?.setItem(LOCALIZE_KEY, on ? '1' : '0')
  } catch {
    // ignore — the switch still applies for this session
  }
}

/** Read the persisted translate choice; unset (or garbage) → null = ask. */
export function readTranslateOptIn(storage: StorageLike | null | undefined): TranslateOptIn | null {
  try {
    if (storage === null || storage === undefined) return null
    const value = storage.getItem(TRANSLATE_OPTIN_KEY)
    return value === 'need' ? 'need' : value === 'no-need' ? 'no-need' : null
  } catch {
    return null
  }
}

/** Persist the translate choice; storage failures degrade silently. */
export function persistTranslateOptIn(storage: StorageLike | null | undefined, choice: TranslateOptIn): void {
  try {
    storage?.setItem(TRANSLATE_OPTIN_KEY, choice)
  } catch {
    // ignore
  }
}

/** True when the one-time dialog must be shown (first visit, D10: unset = ask). */
export function shouldAskTranslateOptIn(storage: StorageLike | null | undefined): boolean {
  return readTranslateOptIn(storage) === null
}

/**
 * Whether a plugin may show the manual 「翻译此插件」 button (D10 overrides
 * D8): with the 'need' opt-in EVERY plugin (in-box official included) gets
 * the button; otherwise only third-party registry/github packages do. While
 * the choice is unset (null), fall back to the D8 third-party-only rule.
 */
export function canTranslate(sourceKind: string | null | undefined, optIn: TranslateOptIn | null): boolean {
  if (optIn === 'need') return true
  return sourceKind === 'registry' || sourceKind === 'github'
}

/**
 * Chinese display name: built-in table wins (zero cost, always applied),
 * then the AI/manual summary nameZh, else '' (the caller falls back to the
 * English short name).
 */
export function zhNameFor(
  moduleName: string,
  summary: { nameZh?: string | null } | null | undefined,
): string {
  const fromTable = BUILTIN_ZH_TABLE[moduleName]?.nameZh
  if (typeof fromTable === 'string' && fromTable !== '') return fromTable
  const fromSummary = summary?.nameZh
  return typeof fromSummary === 'string' && fromSummary !== '' ? fromSummary : ''
}

/**
 * Chinese description: built-in table wins, then the summary descZh, else
 * the 「暂无中文简介」 placeholder (D10: descZh 缺失时显示「暂无中文简介」).
 */
export function zhDescFor(
  moduleName: string,
  summary: { descZh?: string | null } | null | undefined,
): string {
  const fromTable = BUILTIN_ZH_TABLE[moduleName]?.descZh
  if (typeof fromTable === 'string' && fromTable !== '') return fromTable
  const fromSummary = summary?.descZh
  return typeof fromSummary === 'string' && fromSummary !== '' ? fromSummary : NO_ZH_DESC
}

/** The meta projection the render contract needs. */
export interface LocalizeMetaLike {
  description?: string | null
  summary?: { nameZh?: string | null; descZh?: string | null } | null
}

/** The rendered card text (name / secondary short / description line). */
export interface LocalizeCardText {
  name: string
  short: string
  desc: string
  /** True when `desc` is the 暂无中文简介 placeholder. */
  descPlaceholder: boolean
}

/**
 * Single source of truth for card rendering (D10):
 *   - 汉化开: Chinese-first — nameZh (table > summary) 主显 with the English
 *     short name kept as the secondary small text; descZh (table > summary)
 *     副显, 「暂无中文简介」 when missing.
 *   - 汉化关: English original — short name as the main display and the
 *     raw package.json description verbatim.
 */
export function localizeCardText(
  moduleName: string,
  meta: LocalizeMetaLike | null | undefined,
  localizeOn: boolean,
): LocalizeCardText {
  const short = moduleShortName(moduleName)
  if (!localizeOn) {
    return { name: short, short, desc: meta?.description ?? '', descPlaceholder: false }
  }
  const name = zhNameFor(moduleName, meta?.summary) || short
  const desc = zhDescFor(moduleName, meta?.summary)
  return { name, short, desc, descPlaceholder: desc === NO_ZH_DESC }
}
