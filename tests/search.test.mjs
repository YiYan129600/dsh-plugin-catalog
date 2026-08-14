import { describe, expect, it } from 'vitest'
// Tested code comes from the BUILD OUTPUT (lib/), per the project's test
// route (BLOCKED.md): pure ESM, no TS syntax, vite never feeds it to esbuild.
import {
  BUILTIN_ALIAS_ENTRIES,
  QUICK_CHIP_QUERIES,
  aliasesFor,
  highlightRanges,
  moduleShortName,
  normalizeUserAliases,
  searchPlugins,
  suggestQueries,
} from '../lib/index.js'

/** A catalog row in the exact wire shape the host list() projects. */
function entry(moduleName, overrides = {}) {
  return {
    entryId: moduleName,
    moduleName,
    enabled: overrides.enabled ?? true,
    fiberPhase: overrides.fiberPhase ?? 'active',
    meta: {
      version: overrides.version ?? '1.0.0',
      description: overrides.description ?? null,
      keywords: overrides.keywords ?? [],
      sourceKind: overrides.sourceKind ?? 'registry',
      ...(overrides.summary !== undefined ? { summary: overrides.summary } : {}),
    },
  }
}

// Corpus is deliberately ENGLISH-ONLY: the acceptance-critical CJK queries
// (远程/看板/宠物) must hit EXCLUSIVELY through the alias table — that is what
// makes the reverse verification (clearing the alias table → red) meaningful.
const entries = [
  entry('@linxin666/dsh-ssh', {
    description: 'Remote command execution, file transfer, port forwarding and cluster ops for dsh',
    keywords: ['ssh', 'remote', 'server', 'deploy'],
  }),
  entry('@linxin666/dsh-client-ui-task-board', {
    description: 'Kanban task board for the dsh web GUI',
    keywords: ['task', 'kanban', 'board'],
  }),
  entry('whale-girl', {
    description: 'A whale girl desktop pet companion',
    keywords: ['pet', 'desktop'],
    sourceKind: 'github',
  }),
  entry('dsh-openpencil', {
    description: 'Design canvas for the dsh web GUI',
    keywords: ['canvas', 'design'],
    sourceKind: 'link',
  }),
]

describe('fuzzy search (task 3)', () => {
  it('内置别名词表 ≥10 条，且包含三条必须别名（远程/服务器、看板/定时、宠物/桌宠）', () => {
    expect(BUILTIN_ALIAS_ENTRIES.length).toBeGreaterThanOrEqual(10)
    expect(aliasesFor('@linxin666/dsh-ssh')).toEqual(expect.arrayContaining(['远程', '服务器']))
    expect(aliasesFor('@linxin666/dsh-client-ui-task-board')).toEqual(expect.arrayContaining(['看板', '定时']))
    expect(aliasesFor('whale-girl')).toEqual(expect.arrayContaining(['宠物', '桌宠']))
    expect(aliasesFor('@linxin666/dsh-pet')).toEqual(expect.arrayContaining(['宠物', '桌宠']))
  })

  it('「远程」命中 dsh-ssh（L1 别名）', () => {
    const hits = searchPlugins(entries, '远程')
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('@linxin666/dsh-ssh')
    const ssh = hits.find((hit) => hit.entry.moduleName === '@linxin666/dsh-ssh')
    expect(ssh.aliasHit).toBe('远程')
    expect(ssh.score).toBeGreaterThan(0)
  })

  it('「看板」命中 task-board（L1 别名）', () => {
    const hits = searchPlugins(entries, '看板')
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('@linxin666/dsh-client-ui-task-board')
    const board = hits.find((hit) => hit.entry.moduleName === '@linxin666/dsh-client-ui-task-board')
    expect(board.aliasHit).toBe('看板')
  })

  it('「宠物」命中 whale-girl（L1 别名）', () => {
    const hits = searchPlugins(entries, '宠物')
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('whale-girl')
    const whale = hits.find((hit) => hit.entry.moduleName === 'whale-girl')
    expect(whale.aliasHit).toBe('宠物')
  })

  it('无结果查询返回空命中与「最接近的 3 个建议」', () => {
    const hits = searchPlugins(entries, 'zzz不存在的词')
    expect(hits).toEqual([])
    const suggestions = suggestQueries('zzz不存在的词', entries)
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.length).toBeLessThanOrEqual(3)
    for (const suggestion of suggestions) {
      expect(typeof suggestion).toBe('string')
      expect(suggestion.length).toBeGreaterThan(0)
      // Each suggestion is drawn from the corpus/aliases, so it must hit.
      expect(searchPlugins(entries, suggestion).length).toBeGreaterThan(0)
    }
    // A query WITH results gets no suggestions.
    expect(suggestQueries('远程', entries)).toEqual([])
  })

  it('分词匹配（L2）：多词查询容忍顺序与部分词', () => {
    const hits = searchPlugins(entries, 'kanban board')
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('@linxin666/dsh-client-ui-task-board')
  })

  it('子序列匹配（L3）：漏字查询可命中', () => {
    const hits = searchPlugins(entries, 'whalgrl')
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('whale-girl')
    const whale = hits.find((hit) => hit.entry.moduleName === 'whale-girl')
    expect(whale.matchedFields).toContain('moduleName')
  })

  it('搜索大小写不敏感', () => {
    const hits = searchPlugins(entries, 'SSH')
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('@linxin666/dsh-ssh')
  })

  it('中文概括名（nameZh）命中且作为高亮字段（L2 权重最高）', () => {
    const fancy = entry('my-fancy-plugin', {
      description: 'A collection of handy utilities',
      keywords: ['tools'],
      summary: { nameZh: '酷炫工具箱', descZh: '日常小工具合集' },
    })
    const hits = searchPlugins([...entries, fancy], '工具箱')
    const matched = hits.find((hit) => hit.entry.moduleName === 'my-fancy-plugin')
    expect(matched).toBeDefined()
    expect(matched.hitField).toBe('nameZh')
    expect(matched.hitRanges).toEqual([[2, 5]])
  })

  it('空查询返回全部条目（不过滤）', () => {
    const hits = searchPlugins(entries, '   ')
    expect(hits.map((hit) => hit.entry.moduleName)).toEqual(entries.map((item) => item.moduleName))
  })

  it('用户自定义别名（extraAliases）参与搜索（L1 第三来源）', () => {
    // Without the user row the query matches nothing…
    expect(searchPlugins(entries, '宇宙')).toEqual([])
    // …and with it, whale-girl hits.
    const hits = searchPlugins(entries, '宇宙', [{ keys: ['whale-girl'], aliases: ['宇宙'] }])
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('whale-girl')
  })
})

describe('alias table utilities (task 3)', () => {
  it('计算缩略名（与官方清单 tab 同规则）', () => {
    expect(moduleShortName('@linxin666/dsh-ssh')).toBe('ssh')
    // 官方正则只剥一层 `dsh-client-`，所以 `dsh-client-ui-task-board` 得 `ui-task-board`
    expect(moduleShortName('@linxin666/dsh-client-ui-task-board')).toBe('ui-task-board')
    expect(moduleShortName('whale-girl')).toBe('whale-girl')
    expect(moduleShortName('@deepseek-ai/dsh-base')).toBe('base')
  })

  it('scoped 包名 / 裸名 / dsh- 前缀均解析到同一组别名', () => {
    expect(aliasesFor('@linxin666/dsh-ssh')).toEqual(expect.arrayContaining(['远程', '服务器']))
    expect(aliasesFor('dsh-ssh')).toEqual(expect.arrayContaining(['远程', '服务器']))
    expect(aliasesFor('@linxin666/dsh-task-board')).toEqual(expect.arrayContaining(['看板', '定时']))
    expect(aliasesFor('pet')).toEqual(expect.arrayContaining(['宠物', '桌宠']))
  })

  it('归一化用户自定义别名文件（map 与数组两种形态）', () => {
    expect(normalizeUserAliases({ 'dsh-ssh': ['远程', '服务器'] })).toEqual([
      { keys: ['dsh-ssh'], aliases: ['远程', '服务器'] },
    ])
    expect(normalizeUserAliases([{ keys: ['x'], aliases: ['y'] }])).toEqual([{ keys: ['x'], aliases: ['y'] }])
    expect(normalizeUserAliases(null)).toEqual([])
    expect(normalizeUserAliases('nope')).toEqual([])
    expect(normalizeUserAliases({ bad: 42 })).toEqual([])
    expect(normalizeUserAliases([{ keys: [], aliases: ['y'] }])).toEqual([])
  })

  it('高亮范围：合并相邻命中、大小写不敏感、空输入安全', () => {
    expect(highlightRanges('SSH 远程运维', 'ssh')).toEqual([[0, 3]])
    expect(highlightRanges('远程运维工具', '远程')).toEqual([[0, 2]])
    expect(highlightRanges('aXbXc', 'x')).toEqual([[1, 2], [3, 4]])
    expect(highlightRanges('', 'x')).toEqual([])
    expect(highlightRanges('abc', '')).toEqual([])
    expect(highlightRanges('abc', '   ')).toEqual([])
  })

  it('无结果建议的快捷 chips 存在且非空', () => {
    expect(QUICK_CHIP_QUERIES.length).toBeGreaterThanOrEqual(5)
    for (const chip of ['远程', '看板', '任务', '宠物']) expect(QUICK_CHIP_QUERIES).toContain(chip)
  })
})
