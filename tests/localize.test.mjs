import { describe, expect, it } from 'vitest'
import {
  BUILTIN_ZH_TABLE,
  LOCALIZE_KEY,
  NO_ZH_DESC,
  TRANSLATE_DIALOG_COPY,
  TRANSLATE_OPTIN_KEY,
  canTranslate,
  localizeCardText,
  persistLocalizeOn,
  persistTranslateOptIn,
  readLocalizeOn,
  readTranslateOptIn,
  shouldAskTranslateOptIn,
  zhDescFor,
  zhNameFor,
} from '../lib/index.js'

/** In-memory localStorage stand-in (StorageLike surface). */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
  }
}

/**
 * Every in-box non-group module name enumerated from
 * `dsh --profile web --dump-config` on the target machine (the @deepseek-ai
 * template bundles `dsh-base` + `dsh-web-app`, 129 unique `name:` rows).
 * Static snapshot — the built-in table must cover all of them (D10).
 */
const INBOX_MODULE_NAMES = [
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-attachment-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-bridge-browser',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-hmr',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-agent-preset',
  '@deepseek-ai/dsh-client-ui-commands',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-cordis',
  '@deepseek-ai/dsh-client-ui-deliverables',
  '@deepseek-ai/dsh-client-ui-goal',
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-client-ui-jobs',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-message-feedback',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-permission-presets',
  '@deepseek-ai/dsh-client-ui-plan',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-general',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-skill',
  '@deepseek-ai/dsh-client-ui-subagent',
  '@deepseek-ai/dsh-client-ui-theme',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-client-ui-trajectory',
  '@deepseek-ai/dsh-client-ui-user-questions',
  '@deepseek-ai/dsh-client-ui-workflow-run',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-code-runtime-worker-thread',
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-command-feedback',
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-cordis-client-runner',
  '@deepseek-ai/dsh-cordis-host-runner',
  '@deepseek-ai/dsh-credentials-local',
  '@deepseek-ai/dsh-fs-observation-policy',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-goal',
  '@deepseek-ai/dsh-goal-round-driver',
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-host-directory-picker-auto',
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-jobs-local',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-llm-retry',
  '@deepseek-ai/dsh-message-feedback',
  '@deepseek-ai/dsh-permission-presets',
  '@deepseek-ai/dsh-plan-mode',
  '@deepseek-ai/dsh-pwsh-sandbox',
  '@deepseek-ai/dsh-repeat-tool-reminder',
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-checkpoint-policy',
  '@deepseek-ai/dsh-session-log-export',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-session-projection-cache',
  '@deepseek-ai/dsh-session-query-sqlite',
  '@deepseek-ai/dsh-session-stats',
  '@deepseek-ai/dsh-session-telemetry-otel',
  '@deepseek-ai/dsh-session-title',
  '@deepseek-ai/dsh-session-title-first-prompt-llm',
  '@deepseek-ai/dsh-settings-file',
  '@deepseek-ai/dsh-shell-env',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-skill-badge',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-spill-local',
  '@deepseek-ai/dsh-spill-policy',
  '@deepseek-ai/dsh-storage',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-storage-json',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-subagent-fork-in-process',
  '@deepseek-ai/dsh-subagent-spawn-in-process',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-call-timeout-policy',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-goal',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-ralph',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tool-str-replace-editor',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-tool-subagent-control/list-agents',
  '@deepseek-ai/dsh-tool-subagent-report',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-typert-loader',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-user-questions',
  '@deepseek-ai/dsh-web',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-web-app/startup',
  '@deepseek-ai/dsh-web-search-deepseek',
  '@deepseek-ai/dsh-workflow-worker-thread',
  '@deepseek-ai/dsh-workspace',
]

describe('汉化开关 (D10, task 1)', () => {
  it('开关默认开：未持久化任何值时 localizeOn=true', () => {
    expect(readLocalizeOn(memoryStorage())).toBe(true)
    expect(readLocalizeOn(null)).toBe(true)
    expect(readLocalizeOn(memoryStorage({ [LOCALIZE_KEY]: 'garbage' }))).toBe(true)
  })

  it('关闭后回英文原样显示：英文缩略名 + 原始 description', () => {
    const english = localizeCardText('@linxin666/dsh-ssh', { description: 'Remote SSH operations for the dsh web GUI' }, false)
    expect(english.name).toBe('ssh')
    expect(english.desc).toBe('Remote SSH operations for the dsh web GUI')
    expect(english.descPlaceholder).toBe(false)
    // 关闭即持久化为 '0'，再读回为 false
    const storage = memoryStorage()
    persistLocalizeOn(storage, false)
    expect(storage.getItem(LOCALIZE_KEY)).toBe('0')
    expect(readLocalizeOn(storage)).toBe(false)
    // 开启持久化为 '1'
    persistLocalizeOn(storage, true)
    expect(readLocalizeOn(storage)).toBe(true)
  })

  it('汉化开启时卡片中文优先渲染（nameZh 主显、descZh 副显、缩略名保留小字）', () => {
    const text = localizeCardText('@linxin666/dsh-ssh', {}, true)
    expect(text.name).toBe('远程运维')
    expect(text.short).toBe('ssh')
    expect(text.desc).toContain('远程')
    expect(text.descPlaceholder).toBe(false)
  })

  it('descZh 缺失（表外且未翻译）时显示「暂无中文简介」', () => {
    expect(zhDescFor('@deepseek-ai/does-not-exist', null)).toBe(NO_ZH_DESC)
    const text = localizeCardText('@deepseek-ai/does-not-exist', { summary: null }, true)
    expect(text.desc).toBe(NO_ZH_DESC)
    expect(text.descPlaceholder).toBe(true)
    expect(text.name).toBe('does-not-exist')
  })

  it('翻译成功后摘要立即渲染上卡（summary descZh 生效）', () => {
    // A module OUTSIDE the built-in table: after 「翻译此插件」 succeeds the
    // cached summary must render immediately (nameZh 主显、descZh 副显).
    const text = localizeCardText('@example/third-party-plugin', {
      summary: { nameZh: '第三方插件', descZh: 'AI 翻译后的中文简介' },
    }, true)
    expect(text.name).toBe('第三方插件')
    expect(text.desc).toBe('AI 翻译后的中文简介')
    expect(text.descPlaceholder).toBe(false)
  })

  it('内置中文表优先于 AI 摘要（表内条目不被摘要覆盖）', () => {
    expect(zhNameFor('@linxin666/dsh-ssh', { nameZh: 'AI 起的名字' })).toBe('远程运维')
    expect(zhDescFor('@linxin666/dsh-ssh', { descZh: 'AI 写的简介' })).toContain('远程')
  })
})

describe('内置中文表 (task 1)', () => {
  it('条目数 ≥ 90', () => {
    expect(Object.keys(BUILTIN_ZH_TABLE).length).toBeGreaterThanOrEqual(90)
  })

  it('含核心条目：ssh / task-board / pet / whale-girl', () => {
    for (const core of ['@linxin666/dsh-ssh', '@linxin666/dsh-client-ui-task-board', '@linxin666/dsh-pet', 'whale-girl']) {
      expect(BUILTIN_ZH_TABLE[core]).toBeDefined()
      expect(BUILTIN_ZH_TABLE[core].nameZh).not.toBe('')
      expect(BUILTIN_ZH_TABLE[core].descZh).not.toBe('')
    }
  })

  it('覆盖全部 in-box 非 group 条目（dump-config 枚举的 129 个 @deepseek-ai 模块名）', () => {
    const missing = INBOX_MODULE_NAMES.filter((name) => BUILTIN_ZH_TABLE[name] === undefined)
    expect(missing).toEqual([])
  })

  it('nameZh ≤ 10 字 / descZh ≤ 40 字（全部条目）', () => {
    const over = Object.entries(BUILTIN_ZH_TABLE).filter(([name, row]) => [...row.nameZh].length > 10 || [...row.descZh].length > 40)
    expect(over.map(([name]) => name)).toEqual([])
  })
})

describe('一次性翻译授权 (D10, task 1)', () => {
  it('translateOptIn 未设置时弹一次性询问（首次进入）', () => {
    expect(shouldAskTranslateOptIn(memoryStorage())).toBe(true)
    expect(shouldAskTranslateOptIn(null)).toBe(true)
    persistTranslateOptIn(memoryStorage(), 'need')
    expect(shouldAskTranslateOptIn(memoryStorage({ [TRANSLATE_OPTIN_KEY]: 'need' }))).toBe(false)
  })

  it('选「需要」→ 所有插件（含官方 in-box）显示翻译按钮', () => {
    expect(canTranslate('in-box', 'need')).toBe(true)
    expect(canTranslate('registry', 'need')).toBe(true)
    expect(canTranslate('github', 'need')).toBe(true)
    expect(canTranslate('unknown', 'need')).toBe(true)
    expect(canTranslate(null, 'need')).toBe(true)
  })

  it('选「不需要」→ 官方无按钮、第三方有（D8 原样）', () => {
    expect(canTranslate('in-box', 'no-need')).toBe(false)
    expect(canTranslate('link', 'no-need')).toBe(false)
    expect(canTranslate('registry', 'no-need')).toBe(true)
    expect(canTranslate('github', 'no-need')).toBe(true)
  })

  it('未选择（null）时按 D8 仅第三方显示按钮', () => {
    expect(canTranslate('in-box', null)).toBe(false)
    expect(canTranslate('registry', null)).toBe(true)
    expect(canTranslate('github', null)).toBe(true)
  })

  it('选择持久化并可随时更改（头部「翻译设置」读写往返）', () => {
    const storage = memoryStorage()
    persistTranslateOptIn(storage, 'need')
    expect(readTranslateOptIn(storage)).toBe('need')
    persistTranslateOptIn(storage, 'no-need')
    expect(readTranslateOptIn(storage)).toBe('no-need')
  })

  it('询问框文案含成本说明（需要=可能消耗模型额度）', () => {
    expect(TRANSLATE_DIALOG_COPY.title).toContain('中文翻译')
    expect(TRANSLATE_DIALOG_COPY.needLabel).toBe('需要')
    expect(TRANSLATE_DIALOG_COPY.noNeedLabel).toBe('不需要')
    const body = TRANSLATE_DIALOG_COPY.body
    expect(/额度|费用|成本|token/i.test(body)).toBe(true)
    expect(body).toContain('翻译设置')
  })
})
