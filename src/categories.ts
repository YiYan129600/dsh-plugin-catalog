/**
 * dsh-plugin-catalog — static category classifier + chip filter (plan §5.3 /
 * v0.2.0 task 2).
 *
 * Pure, dependency-free module shared by BOTH halves (and the vitest suite),
 * exactly like `src/search.ts` / `src/localize.ts` / `src/pinyin.ts`. It
 * performs no I/O and touches no DOM.
 *
 * The classifier is deliberately static and keyword-based: it reads the same
 * corpus the search layer reads (moduleName + short name + aliases +
 * keywords + description + zh name/desc), so a chip click filters the list
 * with zero extra data from the host. Categories: remote / ui / pets / ops /
 * design (acceptance-required) plus ai / web / storage as useful extras.
 */

import { aliasesFor, moduleShortName, type BuiltinAliasEntry, type CatalogEntryLike } from './search.ts'

/** One category chip definition. */
export interface CategoryDef {
  /** Stable id used by `classifyEntry` / `filterByCategory` / the chips. */
  id: string
  /** Short Chinese label shown on the chip. */
  label: string
  /**
   * Concept words. CJK keywords match as substrings; short latin keywords
   * (≤ 2 chars, e.g. `ui`, `ai`, `web`) match as whole tokens so `ui` never
   * fires on `gui`; longer latin keywords match as substrings.
   */
  keywords: string[]
}

/** The static chip set. remote/ui/pets/ops/design are acceptance-required. */
export const CATEGORY_DEFS: readonly CategoryDef[] = [
  {
    id: 'remote',
    label: '远程',
    keywords: ['ssh', '远程', '服务器', 'remote', '隧道', '运维', '部署', '集群', '传输', 'deploy', 'server', 'forward'],
  },
  {
    id: 'ui',
    label: '界面',
    keywords: ['ui', 'sidebar', '侧边栏', 'panel', '面板', 'theme', '主题', 'skin', '皮肤', 'layout', '布局', '外观', 'canvas', '画布', '设置', 'settings', 'web-ui', '渲染', '预览'],
  },
  {
    id: 'pets',
    label: '宠物',
    keywords: ['pet', 'whale', '宠物', '桌宠', '摆件'],
  },
  {
    id: 'ops',
    label: '运维任务',
    keywords: ['task', '看板', 'kanban', '定时', 'cron', '任务', '待办', 'jobs', '后台', 'update', '更新', '统计', '监控', 'ops', 'check', '状态'],
  },
  {
    id: 'design',
    label: '设计',
    keywords: ['openpencil', '画布', '绘图', '设计', '白板', 'drawing', 'design', 'canvas'],
  },
  {
    id: 'ai',
    label: '智能',
    keywords: ['agent', '智能体', '模型', 'llm', '摘要', 'summary', 'goal', '目标', 'skill', '技能', 'tool', '工具', 'workflow', '流程', 'subagent', '子代理', 'ai'],
  },
  {
    id: 'web',
    label: '联网',
    keywords: ['web', '联网', 'search', '搜索', '抓取', 'remote-web', '手机', '配对', '浏览器'],
  },
  {
    id: 'storage',
    label: '存储',
    keywords: ['storage', 'session', '会话', '缓存', 'cache', 'spill', '溢出', 'credential', '凭据', '附件', 'jsonl', 'sqlite', '存储'],
  },
]

/**
 * Whether one keyword matches the (lowercased, space-joined) entry corpus.
 * CJK keywords are substrings; short latin keywords are whole tokens; longer
 * latin keywords are substrings.
 */
function categoryMatches(text: string, keyword: string): boolean {
  const lower = keyword.toLowerCase()
  if (/^[\u4e00-\u9fff]+$/.test(lower)) return text.includes(lower)
  if (lower.length <= 2) return text.split(/[^a-z0-9]+/).includes(lower)
  return text.includes(lower)
}

/**
 * Classify one catalog entry into category ids (zero, one, or several).
 * The corpus is exactly what the search layer sees, so the chips and the
 * search agree on what an entry "is".
 */
export function classifyEntry(
  entry: CatalogEntryLike,
  table: readonly BuiltinAliasEntry[] = [],
): string[] {
  const meta = entry.meta ?? {}
  const text = [
    entry.moduleName,
    moduleShortName(entry.moduleName),
    ...aliasesFor(entry.moduleName, table),
    ...(meta.keywords ?? []),
    meta.description ?? '',
    meta.summary?.nameZh ?? '',
    meta.summary?.descZh ?? '',
  ]
    .filter((part) => part !== '')
    .join(' ')
    .toLowerCase()
  const ids: string[] = []
  for (const def of CATEGORY_DEFS) {
    if (def.keywords.some((keyword) => categoryMatches(text, keyword))) ids.push(def.id)
  }
  return ids
}

/**
 * Filter entries by a category id. Unknown ids return an empty list (the UI
 * only offers ids from `CATEGORY_DEFS`, so this is a defensive no-match).
 */
export function filterByCategory(entries: readonly CatalogEntryLike[], categoryId: string): CatalogEntryLike[] {
  return entries.filter((entry) => classifyEntry(entry).includes(categoryId))
}
