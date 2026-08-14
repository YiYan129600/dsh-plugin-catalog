import { describe, expect, it } from 'vitest'
// Tested code comes from the BUILD OUTPUT (lib/), per the project's test
// route (BLOCKED.md): pure ESM, no TS syntax, vite never feeds it to esbuild.
import {
  CATEGORY_DEFS,
  PINYIN_SYLLABLE_TABLE,
  buildPluginManifestSnippet,
  classifyEntry,
  filterByCategory,
  pinyinForText,
  searchPlugins,
  stringifyPluginManifest,
  validateDshPluginField,
  validateDshPluginManifest,
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

// Corpus is deliberately ENGLISH-ONLY (like search.test.mjs): the pinyin
// queries (yuan cheng / kan ban) must hit EXCLUSIVELY through the pinyin
// layer over the alias table — that is what makes the reverse validation
// (emptying PINYIN_SYLLABLE_TABLE → red) meaningful.
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

describe('拼音搜索（自写静态音节表，task 2）', () => {
  it('音节表 ≥150 字，且含验收关键音节（远/程→yuan/cheng、看/板→kan/ban）', () => {
    expect(Object.keys(PINYIN_SYLLABLE_TABLE).length).toBeGreaterThanOrEqual(150)
    expect(PINYIN_SYLLABLE_TABLE['远']).toBe('yuan')
    expect(PINYIN_SYLLABLE_TABLE['程']).toBe('cheng')
    expect(PINYIN_SYLLABLE_TABLE['看']).toBe('kan')
    expect(PINYIN_SYLLABLE_TABLE['板']).toBe('ban')
  })

  it('pinyinForText：远程→yuan cheng、看板→kan ban、英文透传、空串安全', () => {
    expect(pinyinForText('远程')).toBe('yuan cheng')
    expect(pinyinForText('看板')).toBe('kan ban')
    expect(pinyinForText('远程运维')).toBe('yuan cheng yun wei')
    expect(pinyinForText('ssh 远程运维')).toBe('ssh yuan cheng yun wei')
    expect(pinyinForText('')).toBe('')
    expect(pinyinForText('abc')).toBe('abc')
  })

  it('「yuan cheng」命中远程（dsh-ssh，第一命中）', () => {
    const hits = searchPlugins(entries, 'yuan cheng')
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('@linxin666/dsh-ssh')
    const ssh = hits.find((hit) => hit.entry.moduleName === '@linxin666/dsh-ssh')
    expect(ssh.matchedFields).toContain('pinyin')
    expect(ssh.score).toBeGreaterThan(0)
    expect(hits[0].entry.moduleName).toBe('@linxin666/dsh-ssh')
  })

  it('「kan ban」命中看板（task-board，第一命中）', () => {
    const hits = searchPlugins(entries, 'kan ban')
    expect(hits.map((hit) => hit.entry.moduleName)).toContain('@linxin666/dsh-client-ui-task-board')
    const board = hits.find((hit) => hit.entry.moduleName === '@linxin666/dsh-client-ui-task-board')
    expect(board.matchedFields).toContain('pinyin')
    expect(hits[0].entry.moduleName).toBe('@linxin666/dsh-client-ui-task-board')
  })

  it('拼音对中文名/描述语料同样生效（nameZh/descZh 拼音命中）', () => {
    const fancy = entry('my-fancy-plugin', {
      description: 'A collection of handy utilities',
      keywords: ['tools'],
      summary: { nameZh: '酷炫工具箱', descZh: '日常小工具合集' },
    })
    const hits = searchPlugins([...entries, fancy], 'ku xuan')
    const matched = hits.find((hit) => hit.entry.moduleName === 'my-fancy-plugin')
    expect(matched).toBeDefined()
    expect(matched.matchedFields).toContain('pinyin')
    // descZh 拼音同样可命中（ri chang）
    const hitsDesc = searchPlugins([...entries, fancy], 'ri chang')
    expect(hitsDesc.map((hit) => hit.entry.moduleName)).toContain('my-fancy-plugin')
  })

  it('音节表为空时拼音查询不可能命中（反向验证机制：空表=零音节）', () => {
    expect(pinyinForText('远程', {})).toBe('')
    expect(pinyinForText('远程运维', {})).toBe('')
    // 中文查询与英文查询不受影响（不经过拼音层）
    expect(searchPlugins(entries, '远程').map((hit) => hit.entry.moduleName)).toContain('@linxin666/dsh-ssh')
    expect(searchPlugins(entries, 'ssh').map((hit) => hit.entry.moduleName)).toContain('@linxin666/dsh-ssh')
  })
})

describe('分类 chips（静态分类器，task 2）', () => {
  it('CATEGORY_DEFS 含 remote/ui/pets/ops/design 五个必备分类，标签非空', () => {
    const ids = CATEGORY_DEFS.map((def) => def.id)
    for (const required of ['remote', 'ui', 'pets', 'ops', 'design']) {
      expect(ids).toContain(required)
    }
    for (const def of CATEGORY_DEFS) {
      expect(def.label).not.toBe('')
      expect(def.keywords.length).toBeGreaterThan(0)
    }
  })

  it('静态分类：ssh→remote、task-board→ops/ui、whale-girl→pets、openpencil→design', () => {
    expect(classifyEntry(entries[0])).toContain('remote')
    expect(classifyEntry(entries[1])).toEqual(expect.arrayContaining(['ops', 'ui']))
    expect(classifyEntry(entries[2])).toContain('pets')
    expect(classifyEntry(entries[3])).toContain('design')
  })

  it('filterByCategory 按分类过滤列表（点 chip 过滤）', () => {
    expect(filterByCategory(entries, 'remote').map((item) => item.moduleName)).toEqual(['@linxin666/dsh-ssh'])
    expect(filterByCategory(entries, 'pets').map((item) => item.moduleName)).toEqual(['whale-girl'])
    expect(filterByCategory(entries, 'ops').map((item) => item.moduleName)).toContain('@linxin666/dsh-client-ui-task-board')
  })

  it('未知/空分类返回空列表（防御性 no-match）', () => {
    expect(filterByCategory(entries, 'does-not-exist')).toEqual([])
    expect(filterByCategory([], 'remote')).toEqual([])
  })
})

describe('导出 dsh.plugin 片段（task 2）', () => {
  it('导出结构：displayName/description/categories/aliases 取自 meta+summary', () => {
    const snippet = buildPluginManifestSnippet(entries[0])
    // zh 名/简介来自内置中文表（表内条目零成本生效）
    expect(snippet.displayName.zh).toBe('远程运维')
    expect(snippet.displayName.en).toBe('ssh')
    expect(snippet.description.zh).toContain('远程')
    expect(snippet.description.en).toContain('Remote command execution')
    // 分类与别名来自静态分类器与别名词表
    expect(snippet.categories).toContain('remote')
    expect(snippet.aliases).toEqual(expect.arrayContaining(['远程', '服务器']))
  })

  it('导出 JSON 可解析往返（粘贴进 package.json 的形态）', () => {
    const snippet = buildPluginManifestSnippet(entries[1])
    const text = stringifyPluginManifest(snippet)
    expect(text).toContain('"displayName"')
    expect(JSON.parse(text)).toEqual(snippet)
  })

  it('导出片段通过无依赖校验器（自洽闭环）', () => {
    for (const item of entries) {
      const result = validateDshPluginManifest(buildPluginManifestSnippet(item))
      expect(result.ok).toBe(true)
    }
  })
})

describe('dsh.plugin 无依赖校验器（task 2）', () => {
  it('正例：完整合法 manifest 通过并原样归一化', () => {
    const valid = {
      displayName: { zh: 'SSH 远程运维', en: 'SSH Remote Ops' },
      description: { zh: '远程执行命令', en: 'Remote ops' },
      categories: ['remote', 'ops'],
      aliases: ['ssh', '远程', '服务器'],
    }
    const result = validateDshPluginManifest(valid)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(valid)
  })

  it('正例：空对象/最小 manifest 合法，缺失字段按 package.json 顶层回退', () => {
    const empty = validateDshPluginManifest({})
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.value).toEqual({})
    const withFallback = validateDshPluginManifest({}, { name: 'my-pkg', description: 'My desc' })
    expect(withFallback.ok).toBe(true)
    if (withFallback.ok) {
      expect(withFallback.value).toEqual({ displayName: { en: 'my-pkg' }, description: { en: 'My desc' } })
    }
    const minimal = validateDshPluginManifest({ aliases: ['ssh'] }, { name: 'pkg' })
    expect(minimal.ok).toBe(true)
    if (minimal.ok) {
      expect(minimal.value).toEqual({ displayName: { en: 'pkg' }, aliases: ['ssh'] })
    }
    // validateDshPluginField 从 package.json 形态读 dsh.plugin 并回退
    const field = validateDshPluginField({ name: 'x', description: 'y', dsh: { plugin: {} } })
    expect(field.ok).toBe(true)
    if (field.ok) expect(field.value).toEqual({ displayName: { en: 'x' }, description: { en: 'y' } })
  })

  it('反例：非对象（null/数组/字符串/非对象 package.json）拒绝', () => {
    expect(validateDshPluginManifest(null).ok).toBe(false)
    expect(validateDshPluginManifest([]).ok).toBe(false)
    expect(validateDshPluginManifest('nope').ok).toBe(false)
    expect(validateDshPluginField('nope').ok).toBe(false)
  })

  it('反例：字段类型错误逐条报错（含字段路径）', () => {
    const cases = [
      [{ displayName: '任务看板' }, 'displayName'],
      [{ categories: 'ops' }, 'categories'],
      [{ aliases: [42, 'ssh'] }, 'aliases[0]'],
      [{ displayName: { zh: 42 } }, 'displayName.zh'],
      [{ description: { en: '   ' } }, 'description.en'],
    ]
    for (const [raw, expected] of cases) {
      const result = validateDshPluginManifest(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.some((error) => error.startsWith(expected))).toBe(true)
      }
    }
  })
})
