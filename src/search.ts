/**
 * dsh-plugin-catalog — fuzzy search core (plan §5.3).
 *
 * Pure, dependency-free module shared by BOTH halves (and the vitest suite):
 * the host re-exports it through `src/index.ts` (tests import the built
 * `lib/index.js`), the browser half inlines it via its relative import. It
 * performs no I/O and touches no DOM, so one implementation serves node,
 * jsdom, and the browser.
 *
 * Layers, per plan §5.3:
 *   L1  alias table  — generic-concept hits are the main battlefield
 *       (「远程」→ dsh-ssh, 「看板」→ task-board, 「宠物」→ whale-girl);
 *       alias sourcing: author-declared (future) > built-in table (here) >
 *       user custom `~/.dsh/plugin-aliases.json` (normalized here, read by
 *       the host route).
 *   L2  token match  — lowercase + non-alphanumeric tokenization, substring
 *       hits over the corpus (中文名/别名 > 描述 > keywords > moduleName > entryId).
 *   L2.5 pinyin (v0.2.0 task 2) — hand-written static syllable table
 *       (`src/pinyin.ts`, zero new dependencies): a latin-pinyin query such
 *       as 「yuan cheng」 resolves to 远程 and 「kan ban」 to 看板 by
 *       token-matching the query against the pinyin of the Chinese corpus
 *       (aliases + nameZh + descZh/description).
 *   L3  subsequence  — character-subsequence scoring over moduleName +
 *       short name, tolerant of missing characters.
 *   L4  Fuse.js is intentionally NOT pulled in (size vs. value tradeoff,
 *       plan §5.3 "可选").
 */
import { pinyinForText } from './pinyin.ts'

export type CatalogSourceKind = 'registry' | 'github' | 'link' | 'in-box' | 'unknown'

/** The wire projection the host `PluginMetaService.list()` returns per Loader entry. */
export interface CatalogEntryLike {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase?: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
  meta?: {
    packageName?: string
    version?: string | null
    description?: string | null
    keywords?: string[]
    repository?: string | null
    homepage?: string | null
    license?: string | null
    sourceKind?: CatalogSourceKind | null
    summary?: {
      nameZh?: string | null
      descZh?: string | null
      source?: string
      model?: string
      generatedAt?: string
    } | null
  } | null
}

/** One alias-table row: `keys` name the module (full name / short name / plain id), `aliases` are the concept words. */
export interface BuiltinAliasEntry {
  keys: string[]
  aliases: string[]
}

/**
 * Compact a module specifier without guessing whether its Loader id was
 * generated. Copied from @deepseek-ai/dsh-client-ui-settings-plugin-inventory
 * (lib/client.js `moduleShortName`) — a whitelisted read-only reference.
 */
export function moduleShortName(moduleName: string): string {
  return (moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName)
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/**
 * Built-in alias table (≥10 rows, plan §5.3). The three REQUIRED rows
 * (dsh-ssh → 远程/服务器, task-board → 看板/定时, pet·whale-girl → 宠物/桌宠)
 * are acceptance-critical: clearing this table must red the 「远程/看板/宠物」
 * test cases (reverse verification).
 */
export const BUILTIN_ALIAS_ENTRIES: BuiltinAliasEntry[] = [
  {
    keys: ['dsh-ssh', '@linxin666/dsh-ssh', 'ssh'],
    aliases: ['远程', '服务器', 'ssh', '运维', '部署', '隧道', '集群', '传输'],
  },
  {
    keys: ['task-board', 'dsh-task-board', '@linxin666/dsh-task-board', '@linxin666/dsh-client-ui-task-board', 'kanban'],
    aliases: ['看板', '定时', '任务', '待办', 'kanban', 'cron', '日程'],
  },
  {
    keys: ['whale-girl', 'pet', 'dsh-pet', '@linxin666/dsh-pet'],
    aliases: ['宠物', '桌宠', '摆件', 'pet', '鲸鱼'],
  },
  {
    keys: ['dsh-openpencil', 'openpencil'],
    aliases: ['画布', '绘图', '白板', 'openpencil', '设计'],
  },
  {
    keys: ['dsh-better-sidebar', 'better-sidebar', 'sidebar'],
    aliases: ['侧边栏', 'sidebar', '美化'],
  },
  {
    keys: ['remote-web-ui', 'dsh-remote-web-ui', '@linxin666/dsh-remote-web-ui'],
    aliases: ['远程控制', '手机', '配对', 'remote', '局域网'],
  },
  {
    keys: ['git-graph', 'dsh-client-ui-git-graph', '@linxin666/dsh-client-ui-git-graph'],
    aliases: ['提交图', 'git', '分支', '版本库'],
  },
  {
    keys: ['live-stats', 'dsh-live-stats', '@linxin666/dsh-live-stats'],
    aliases: ['统计', '监控', '实时', 'live'],
  },
  {
    keys: ['skins', 'dsh-skins', '@linxin666/dsh-skins'],
    aliases: ['皮肤', '主题', 'skin', '外观'],
  },
  {
    keys: ['aionui', 'aionui-panel', 'dsh-client-ui-aionui-panel', '@linxin666/dsh-client-ui-aionui-panel'],
    aliases: ['面板', 'ai', 'aion', '悬浮'],
  },
  {
    keys: ['web-ui-settings', 'dsh-client-ui-web-ui-settings', '@linxin666/dsh-client-ui-web-ui-settings'],
    aliases: ['设置面板', 'webui', '聚合'],
  },
  {
    keys: ['web-ui-all', 'dsh-web-ui-all', '@linxin666/dsh-web-ui-all'],
    aliases: ['全家桶', '聚合包', 'web-ui'],
  },
  {
    keys: ['dsh-base', '@deepseek-ai/dsh-base'],
    aliases: ['核心', '基础', '本体', 'base'],
  },
]

/**
 * Resolve every alias the built-in (and any extra) table declares for one
 * module name. A row applies when any of its keys equals the full module
 * name, the short name, or is a trailing path/name segment of the module
 * name — so scoped packages and `dsh-`-prefixed names all land on the same
 * concept words.
 */
export function aliasesFor(moduleName: string, table: readonly BuiltinAliasEntry[] = BUILTIN_ALIAS_ENTRIES): string[] {
  const normalizedName = moduleName.toLowerCase()
  const normalizedShort = moduleShortName(moduleName).toLowerCase()
  const result: string[] = []
  for (const row of table) {
    const applies = row.keys.some((key) => {
      const candidate = key.toLowerCase()
      return candidate === normalizedName
        || candidate === normalizedShort
        || normalizedName.endsWith(`/${candidate}`)
        || normalizedName.endsWith(`-${candidate}`)
    })
    if (applies) {
      for (const alias of row.aliases) if (!result.includes(alias)) result.push(alias)
    }
  }
  return result
}

/**
 * Normalize the user-custom alias file `~/.dsh/plugin-aliases.json` (plan
 * §5.3, third sourcing level) into table rows. Accepts either a map
 * `{ "dsh-ssh": ["远程", "服务器"] }` or an array of `{ keys, aliases }`
 * rows. Malformed input degrades to an empty table (never throws).
 */
export function normalizeUserAliases(raw: unknown): BuiltinAliasEntry[] {
  if (Array.isArray(raw)) {
    const rows: BuiltinAliasEntry[] = []
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue
      const record = item as Record<string, unknown>
      const keys = Array.isArray(record.keys)
        ? record.keys.filter((key): key is string => typeof key === 'string' && key !== '')
        : []
      const aliases = Array.isArray(record.aliases)
        ? record.aliases.filter((alias): alias is string => typeof alias === 'string' && alias !== '')
        : []
      if (keys.length > 0 && aliases.length > 0) rows.push({ keys, aliases })
    }
    return rows
  }
  if (typeof raw === 'object' && raw !== null) {
    const rows: BuiltinAliasEntry[] = []
    for (const [keys, value] of Object.entries(raw)) {
      const aliases = Array.isArray(value)
        ? value.filter((alias): alias is string => typeof alias === 'string' && alias !== '')
        : []
      if (keys !== '' && aliases.length > 0) rows.push({ keys: [keys], aliases })
    }
    return rows
  }
  return []
}

/** Lowercase + non-alphanumeric tokenization (CJK letters count as letters). */
export function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token !== '')
}

/** Greedy character-subsequence coverage of `query` inside `text`, in [0, 1]. */
export function subsequenceCover(query: string, text: string): number {
  if (query === '') return 0
  let matched = 0
  let cursor = 0
  for (const char of query) {
    const at = text.indexOf(char, cursor)
    if (at < 0) break
    matched += 1
    cursor = at + 1
  }
  return matched / query.length
}

/**
 * Character ranges (in the ORIGINAL string — lowercase never changes length
 * for CJK/ASCII, so normalized indices map 1:1) where the query's tokens
 * occur. Merged and sorted; the UI wraps these in <mark>.
 */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
  if (text === '' || query.trim() === '') return []
  const haystack = text.toLowerCase()
  const ranges: Array<[number, number]> = []
  for (const token of tokenize(query)) {
    if (token === '') continue
    let from = 0
    for (;;) {
      const at = haystack.indexOf(token, from)
      if (at < 0) break
      ranges.push([at, at + token.length])
      from = at + token.length
    }
  }
  if (ranges.length === 0) return []
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = [ranges[0]]
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1]
    if (start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** Corpus weights, per plan §5.3: 中文名/别名 > 描述 > keywords > moduleName > entryId. */
const FIELD_ORDER: ReadonlyArray<[field: string, weight: number]> = [
  ['nameZh', 400],
  ['description', 100],
  ['keywords', 60],
  ['moduleName', 30],
  ['entryId', 10],
]

/** The per-entry search corpus (all lowercase-safe original text). */
function corpusOf(entry: CatalogEntryLike): Record<string, string> {
  const meta = entry.meta ?? {}
  const summary = meta.summary ?? {}
  return {
    nameZh: summary.nameZh ?? '',
    description: summary.descZh ?? meta.description ?? '',
    keywords: (meta.keywords ?? []).join(' '),
    moduleName: entry.moduleName,
    entryId: entry.entryId,
  }
}

/** A single scored search result with enough info for the UI to highlight. */
export interface SearchHit {
  entry: CatalogEntryLike
  score: number
  /** Corpus fields that matched (L2/L3). */
  matchedFields: string[]
  /** The corpus field the highlight ranges apply to ('alias' when only L1 matched). */
  hitField: string
  /** Character ranges in the ORIGINAL text of `hitField`. */
  hitRanges: Array<[number, number]>
  /** The alias word that matched (L1), when any. */
  aliasHit: string | null
}

/** A short single-character token is only meaningful when it is CJK (Chinese words are 1–2 chars). */
function tokenMeaningful(token: string): boolean {
  return token.length >= 2 || /[\u4e00-\u9fff]/.test(token)
}

function scoreEntry(entry: CatalogEntryLike, query: string, table: readonly BuiltinAliasEntry[]): SearchHit {
  const corpus = corpusOf(entry)
  let score = 0
  let aliasHit: string | null = null
  const matchedFields = new Set<string>()
  const tokens = tokenize(query)

  // L1 — alias table (generic concepts; the acceptance-critical layer).
  for (const alias of aliasesFor(entry.moduleName, table)) {
    const normalizedAlias = alias.toLowerCase()
    if (normalizedAlias === '') continue
    if (query === normalizedAlias) {
      score += 1000
      aliasHit ??= alias
    } else if (query.length >= 2 && (query.includes(normalizedAlias) || normalizedAlias.includes(query))) {
      score += 700
      aliasHit ??= alias
    }
  }

  // L2 — token substring over the weighted corpus.
  for (const [field, weight] of FIELD_ORDER) {
    const text = corpus[field].toLowerCase()
    if (text === '') continue
    for (const token of tokens) {
      if (tokenMeaningful(token) && text.includes(token)) {
        score += weight
        matchedFields.add(field)
      }
    }
  }

  // L2.5 — pinyin (v0.2.0 task 2): a latin-pinyin query addresses the
  // Chinese corpus (aliases + nameZh + descZh/description) through the
  // hand-written static syllable table. 「yuan cheng」→ 远程, 「kan ban」→
  // 看板. Each matched pinyin token adds a fixed score and records the
  // `pinyin` field for highlighting-eligibility reporting.
  {
    const zhCorpus = [
      ...aliasesFor(entry.moduleName, table),
      corpus.nameZh,
      corpus.description,
    ].filter((part) => part !== '').join(' ')
    if (zhCorpus !== '') {
      const pinyin = pinyinForText(zhCorpus)
      if (pinyin !== '') {
        let pinyinHits = 0
        for (const token of tokens) {
          if (tokenMeaningful(token) && pinyin.includes(token)) pinyinHits += 1
        }
        if (pinyinHits > 0) {
          score += 250 * pinyinHits
          matchedFields.add('pinyin')
        }
      }
    }
  }

  // L3 — whole-query subsequence over moduleName + short name.
  if (tokens.length === 1 && !query.includes(' ')) {
    const text = `${entry.moduleName} ${moduleShortName(entry.moduleName)}`.toLowerCase()
    const cover = subsequenceCover(query, text)
    if (cover > 0) {
      score += Math.round(100 * cover)
      matchedFields.add('moduleName')
    }
  }

  if (score === 0) return { entry, score: 0, matchedFields: [], hitField: 'moduleName', hitRanges: [], aliasHit: null }

  // The highlight field: the highest-weight matched corpus field; alias-only
  // hits have no display text to highlight.
  let hitField = 'alias'
  let bestWeight = 0
  for (const [field, weight] of FIELD_ORDER) {
    if (matchedFields.has(field) && weight > bestWeight) {
      hitField = field
      bestWeight = weight
    }
  }
  const hitRanges = hitField === 'alias' ? [] : highlightRanges(corpus[hitField], query)
  return {
    entry,
    score,
    matchedFields: [...matchedFields],
    hitField,
    hitRanges,
    aliasHit,
  }
}

/**
 * Fuzzy-search the catalog (L1 alias > L2 tokens > L3 subsequence). An empty
 * query returns every entry unscored; entries with no match are omitted.
 * @param extraAliases - user-custom alias rows (plan §5.3 third level).
 */
export function searchPlugins(
  entries: readonly CatalogEntryLike[],
  query: string,
  extraAliases: readonly BuiltinAliasEntry[] = [],
): SearchHit[] {
  const normalized = query.trim().toLowerCase()
  if (normalized === '') {
    return entries.map((entry) => ({ entry, score: 0, matchedFields: [], hitField: 'moduleName', hitRanges: [], aliasHit: null }))
  }
  const table = [...BUILTIN_ALIAS_ENTRIES, ...extraAliases]
  const hits: SearchHit[] = []
  for (const entry of entries) {
    const hit = scoreEntry(entry, normalized, table)
    if (hit.score > 0) hits.push(hit)
  }
  hits.sort((a, b) => b.score - a.score || (a.entry.moduleName < b.entry.moduleName ? -1 : a.entry.moduleName > b.entry.moduleName ? 1 : 0))
  return hits
}

/** Closeness of one corpus candidate to the query (higher = closer). */
function closenessOf(query: string, candidate: string): number {
  if (candidate.includes(query)) return 200 + query.length
  if (query.includes(candidate)) return 150 + candidate.length
  const cover = subsequenceCover(query, candidate)
  if (cover > 0) return Math.round(cover * 100)
  let prefix = 0
  const max = Math.min(query.length, candidate.length)
  while (prefix < max && query[prefix] === candidate[prefix]) prefix += 1
  return prefix
}

/**
 * No-result suggestions (plan §5.3: 「最接近的 3 个建议」). Returns the three
 * closest alias/keyword/short-name candidates that WOULD hit when searched;
 * empty when the query already has results or is blank.
 */
export function suggestQueries(
  query: string,
  entries: readonly CatalogEntryLike[],
  extraAliases: readonly BuiltinAliasEntry[] = [],
): string[] {
  const normalized = query.trim().toLowerCase()
  if (normalized === '') return []
  if (searchPlugins(entries, query, extraAliases).length > 0) return []
  const table = [...BUILTIN_ALIAS_ENTRIES, ...extraAliases]
  const scored = new Map<string, number>()
  for (const entry of entries) {
    const candidates = [...aliasesFor(entry.moduleName, table), ...(entry.meta?.keywords ?? []), moduleShortName(entry.moduleName)]
    for (const candidate of candidates) {
      const normalizedCandidate = candidate.toLowerCase()
      if (normalizedCandidate === '' || normalizedCandidate === normalized) continue
      const closeness = closenessOf(normalized, normalizedCandidate)
      // `-1` default: even a zero-closeness candidate (garbage query, no
      // shared characters) is still the closest thing we have — keep it so
      // the suggestion list is non-empty and deterministic.
      if ((scored.get(normalizedCandidate) ?? -1) < closeness) scored.set(normalizedCandidate, closeness)
    }
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 3)
    .map(([candidate]) => candidate)
}

/** Quick-search chips shown beside the no-result suggestions (plan §5.3). */
export const QUICK_CHIP_QUERIES: readonly string[] = ['远程', '看板', '搜索', '任务', '宠物', '文件']

/** Fiber-phase labels for the status dot (same vocabulary as the official inventory tab). */
export const FIBER_PHASE_LABELS: Record<string, string> = {
  pending: '等待依赖',
  loading: '加载中',
  active: '已挂载',
  failed: '挂载失败',
  unloading: '卸载中',
  unobserved: '未挂载',
}
