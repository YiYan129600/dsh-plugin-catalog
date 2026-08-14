/**
 * dsh-plugin-catalog — browser half (plan §5.2/§5.3).
 *
 * Replaces the Task-1 placeholder tab with the real plugin-list page:
 *   - single-column cards by default (中文概括名 + 英文缩略名 + 一句话描述 +
 *     version badge + fiber status dot + expandable details + GitHub jump);
 *   - manual single/dual-column compact switch, persisted in localStorage;
 *   - fuzzy search (L1 alias table > L2 token > L3 subsequence) with hit
 *     highlighting and no-result suggestions + quick chips.
 *
 * Build shape (plan appendix A + dsh-web-ui shared/tsdown.client.ts): the
 * client entry is a plain module; tsdown emits it as a CJS closure wrapped
 * in `window.__ModuleLoader__.load({ id, factory })` (banner/footer), with
 * externals (react) resolved through the injected `require` (the loader's
 * module table). The plugin list itself crosses the wire through the host's
 * loopback-fenced `/api/plugin-catalog/list` route (see src/routes.ts) —
 * same transport as @linxin666/dsh-remote-web-ui.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings-surface slot contract (SlotMap
// 'settings.plugins.tab') and the dsh-client-ui-slots module augmentation,
// so `ctx.slots.inject/register` type-checks against the real slot.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useMemo, useState } from 'react'
import {
  FIBER_PHASE_LABELS,
  QUICK_CHIP_QUERIES,
  highlightRanges,
  moduleShortName,
  searchPlugins,
  suggestQueries,
  type BuiltinAliasEntry,
  type CatalogEntryLike,
} from '../search.ts'

/** The host `/api/plugin-catalog/list` payload. */
export interface PluginCatalogListResponse {
  entries: CatalogEntryLike[]
  aliases?: BuiltinAliasEntry[]
}

/** Inject face the tab receives from the settings slot. */
export interface PluginCatalogTabProps {
  list: () => Promise<PluginCatalogListResponse>
}

/** localStorage key of the layout switch (plan D2: persisted per project). */
const LAYOUT_KEY = 'dsh.pluginCatalog.layout'
type Layout = 'single' | 'dual'

/** Read the persisted layout; any storage failure falls back to single. */
function readLayout(): Layout {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === 'dual' ? 'dual' : 'single'
  } catch {
    return 'single'
  }
}

/** Persist the layout choice; storage failures degrade silently. */
function persistLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, layout)
  } catch {
    // ignore — the switch still applies for this session
  }
}

/**
 * Site stylesheet. Class names are `dpc-` prefixed (no CSS-module pipeline in
 * this repo — the fork's lightningcss virtual module is build-infra specific,
 * so the style tag is injected by hand, exactly like the official CSS
 * virtual-module output does at factory execution). Design tokens mirror the
 * official inventory tab (`var(--dsw-alias-*)`).
 */
const STYLE_TAG_ID = 'dsh-plugin-catalog/site.css'
const STYLE_CSS = `
.dpc-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}
.dpc-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dpc-search{flex:1;min-width:180px;position:relative;display:flex;align-items:center}
.dpc-search input{width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:0 12px;font-size:13px}
.dpc-search input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dpc-search input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dpc-layout-toggle{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:34px;border-radius:8px;padding:0 12px;cursor:pointer;white-space:nowrap}
.dpc-layout-toggle:hover{border-color:var(--dsw-alias-border-l1)}
.dpc-count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dpc-status,.dpc-failure{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0}
.dpc-failure{color:var(--dsw-alias-state-error-primary);display:flex;align-items:center;gap:10px}
.dpc-failure button{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:transparent;border-radius:6px;padding:4px 10px}
.dpc-cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.dpc-cards.dpc-dual{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
.dpc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}
.dpc-card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}
.dpc-card-main{width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;min-width:0}
.dpc-status-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.dpc-status-dot[data-phase=active]{background:var(--dsw-alias-state-success-primary)}
.dpc-status-dot[data-phase=pending],.dpc-status-dot[data-phase=loading]{background:var(--dsw-alias-state-warning-primary)}
.dpc-status-dot[data-phase=failed]{background:var(--dsw-alias-state-error-primary)}
.dpc-name{font-size:13px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpc-short{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:none}
.dpc-version{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:11px;line-height:16px;padding:0 6px;color:var(--dsw-alias-label-secondary);flex:none;font-variant-numeric:tabular-nums}
.dpc-config{font-size:11px;line-height:16px;border-radius:6px;padding:0 6px;flex:none}
.dpc-config[data-enabled=true]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
.dpc-config[data-enabled=false]{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.dpc-repo{margin-left:auto;color:var(--dsw-alias-label-secondary);text-decoration:none;font-size:14px;line-height:1;flex:none}
.dpc-repo:hover{color:var(--dsw-alias-state-business-primary)}
.dpc-chevron{color:var(--dsw-alias-label-tertiary);font-size:12px;flex:none;transition:transform .12s ease}
.dpc-card[data-open=true] .dpc-chevron{transform:rotate(180deg)}
.dpc-desc{margin:0;padding:0 12px 10px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpc-cards.dpc-dual .dpc-desc{display:none}
.dpc-details{padding:0 12px 12px;display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);margin-top:2px;padding-top:10px}
.dpc-details p{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;white-space:pre-wrap;word-break:break-word}
.dpc-details dl{margin:0;display:flex;flex-direction:column;gap:4px}
.dpc-details dl div{display:flex;gap:8px;font-size:12px;line-height:18px}
.dpc-details dt{color:var(--dsw-alias-label-tertiary);flex:none;width:76px}
.dpc-details dd{margin:0;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis}
.dpc-details a{color:var(--dsw-alias-state-business-primary);text-decoration:none}
.dpc-details a:hover{text-decoration:underline}
.dpc-actions{display:flex;gap:8px;flex-wrap:wrap}
.dpc-actions button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:26px;border-radius:6px;padding:0 10px;cursor:pointer}
.dpc-actions button:hover{border-color:var(--dsw-alias-border-l1)}
.dpc-no-result{display:flex;flex-direction:column;gap:10px;padding:4px 2px}
.dpc-no-result p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dpc-suggestions{display:flex;flex-direction:column;gap:6px}
.dpc-suggestions strong{font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:500}
.dpc-chips{display:flex;gap:8px;flex-wrap:wrap}
.dpc-chip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:26px;border-radius:999px;padding:0 12px;cursor:pointer}
.dpc-chip:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dpc-mark{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 32%,transparent);border-radius:3px;padding:0 1px}
`

// Inject the stylesheet once, at factory execution (module scope lands inside
// the bundle factory), exactly like the official CSS virtual-module output.
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plugin-catalog'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = STYLE_CSS
  document.head.appendChild(tag)
}

/** Wrap the query's occurrences in <mark> (hit highlighting). */
function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  const ranges = useMemo(() => highlightRanges(text, query), [text, query])
  if (ranges.length === 0) return <>{text}</>
  const nodes: JSX.Element[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) nodes.push(<span key={`t${cursor}`}>{text.slice(cursor, start)}</span>)
    nodes.push(<mark key={`m${start}`} className="dpc-mark">{text.slice(start, end)}</mark>)
    cursor = end
  }
  if (cursor < text.length) nodes.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>)
  return <>{nodes}</>
}

/** One catalog card (single- or dual-column via the parent's class). */
function PluginCard({
  entry,
  query,
  open,
  onToggle,
}: {
  entry: CatalogEntryLike
  query: string
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const meta = entry.meta ?? {}
  const summary = meta.summary ?? {}
  const shortName = moduleShortName(entry.moduleName)
  const nameZh = summary.nameZh ?? ''
  const descZh = summary.descZh ?? meta.description ?? ''
  const phase = entry.fiberPhase ?? 'unobserved'
  const statusLabel = FIBER_PHASE_LABELS[phase] ?? phase
  const detailId = `dpc-details-${encodeURIComponent(entry.entryId)}`

  return (
    <li className="dpc-card" data-plugin-entry={entry.entryId} data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="dpc-card-main"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className="dpc-status-dot" data-phase={phase} role="img" aria-label={statusLabel} title={statusLabel} />
        <span className="dpc-name" title={nameZh !== '' ? nameZh : entry.moduleName}>
          {nameZh !== '' ? <Highlight text={nameZh} query={query} /> : shortName}
        </span>
        <span className="dpc-short">{shortName}</span>
        {meta.version != null && <span className="dpc-version">v{meta.version}</span>}
        <span className="dpc-config" data-enabled={entry.enabled ? 'true' : 'false'}>
          {entry.enabled ? '已启用' : '已停用'}
        </span>
        {meta.repository != null && meta.repository !== '' && (
          <a
            className="dpc-repo"
            href={meta.repository}
            target="_blank"
            rel="noreferrer"
            title="打开仓库（新窗口）"
            onClick={(event) => event.stopPropagation()}
          >
            ↗
          </a>
        )}
        <span className="dpc-chevron" aria-hidden="true">▾</span>
      </button>
      <p className="dpc-desc" title={descZh !== '' ? descZh : undefined}>
        {descZh !== '' ? <Highlight text={descZh} query={query} /> : shortName}
      </p>
      {open && (
        <div className="dpc-details" id={detailId}>
          {descZh !== '' && <p>{descZh}</p>}
          <dl>
            <div><dt>包名</dt><dd>{entry.moduleName}</dd></div>
            <div><dt>入口</dt><dd>{entry.entryId}</dd></div>
            {meta.version != null && <div><dt>版本</dt><dd>v{meta.version}</dd></div>}
            {meta.sourceKind != null && <div><dt>来源</dt><dd>{meta.sourceKind}</dd></div>}
            <div><dt>配置</dt><dd>{entry.enabled ? '已启用' : '已停用'}</dd></div>
            {entry.enabled && <div><dt>Cordis</dt><dd>{statusLabel}</dd></div>}
            {meta.repository != null && meta.repository !== '' && (
              <div><dt>仓库</dt><dd><a href={meta.repository} target="_blank" rel="noreferrer">{meta.repository} ↗</a></dd></div>
            )}
            {meta.homepage != null && meta.homepage !== '' && (
              <div><dt>主页</dt><dd><a href={meta.homepage} target="_blank" rel="noreferrer">{meta.homepage} ↗</a></dd></div>
            )}
          </dl>
        </div>
      )}
    </li>
  )
}

/** The settings → 插件 → 插件目录 tab body. */
function PluginCatalogTab({ list }: PluginCatalogTabProps): JSX.Element {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; entries: CatalogEntryLike[]; aliases: BuiltinAliasEntry[] }
  >({ status: 'loading' })
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>(readLayout)

  // Debounce the query (plan §5.3: 防抖 + useMemo).
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200)
    return () => clearTimeout(timer)
  }, [query])

  // Load the catalog from the host route on mount and on retry.
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    Promise.resolve()
      .then(() => list())
      .then(
        (response) => {
          if (current) setState({ status: 'ready', entries: response.entries, aliases: response.aliases ?? [] })
        },
        (error: unknown) => {
          if (current) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        },
      )
    return () => {
      current = false
    }
  }, [list, request])

  const results = useMemo(
    () => (state.status === 'ready' ? searchPlugins(state.entries, debounced, state.aliases) : []),
    [state, debounced],
  )
  const suggestions = useMemo(
    () => (
      state.status === 'ready' && debounced.trim() !== '' && results.length === 0
        ? suggestQueries(debounced, state.entries, state.aliases)
        : []
    ),
    [state, debounced, results],
  )

  // Collapse an entry that the current filter no longer shows.
  useEffect(() => {
    if (expanded !== null && state.status === 'ready' && !results.some((hit) => hit.entry.entryId === expanded)) {
      setExpanded(null)
    }
  }, [expanded, results, state])

  const toggleLayout = (): void => {
    const next: Layout = layout === 'single' ? 'dual' : 'single'
    setLayout(next)
    persistLayout(next)
  }

  return (
    <section className="dpc-section" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && <p className="dpc-status">正在读取插件…</p>}
      {state.status === 'error' && (
        <div className="dpc-failure" role="alert">
          <p>暂时无法读取插件：{state.message}</p>
          <button type="button" onClick={() => setRequest((value) => value + 1)}>重试</button>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <div className="dpc-toolbar">
            <label className="dpc-search">
              <span style={{ display: 'none' }}>搜索插件</span>
              <input
                type="search"
                value={query}
                placeholder="搜索插件（远程 / 看板 / 宠物 / ssh…）"
                aria-label="搜索插件"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <button type="button" className="dpc-layout-toggle" onClick={toggleLayout}>
              {layout === 'single' ? '双列紧凑' : '单列'}
            </button>
            <span className="dpc-count" data-plugin-count={results.length}>{results.length} 个</span>
          </div>

          {state.entries.length === 0 && <p className="dpc-status">暂无插件。</p>}
          {state.entries.length > 0 && debounced.trim() !== '' && results.length === 0 && (
            <div className="dpc-no-result">
              <p>没有匹配「{debounced}」的插件。</p>
              {suggestions.length > 0 && (
                <div className="dpc-suggestions">
                  <strong>最接近的建议：</strong>
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" className="dpc-chip" onClick={() => setQuery(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              <div className="dpc-chips">
                {QUICK_CHIP_QUERIES.map((chip) => (
                  <button key={chip} type="button" className="dpc-chip" onClick={() => setQuery(chip)}>{chip}</button>
                ))}
              </div>
            </div>
          )}

          {results.length > 0 && (
            <ul className={`dpc-cards${layout === 'dual' ? ' dpc-dual' : ''}`}>
              {results.map((hit) => (
                <PluginCard
                  key={hit.entry.entryId}
                  entry={hit.entry}
                  query={debounced}
                  open={expanded === hit.entry.entryId}
                  onToggle={() => setExpanded((current) => (current === hit.entry.entryId ? null : hit.entry.entryId))}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/** Services required by the tab registration (the settings slot seat). */
export const inject = ['slots']

/**
 * Register the plugin's own tab into the Plugins settings section
 * (`settings.plugins.tab` list slot; id `plugin-catalog`, after the built-in
 * `all` tab at order 10). `ctx.slots.inject` defers the registration until
 * the section owner mounts (registering into an undeclared slot throws).
 */
export function apply(ctx: ClientContext): void {
  const list = async (): Promise<PluginCatalogListResponse> => {
    const response = await fetch('/api/plugin-catalog/list')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !Array.isArray((body as { entries?: unknown }).entries)) {
      throw new Error('无效的响应数据')
    }
    const record = body as PluginCatalogListResponse
    return { entries: record.entries, aliases: record.aliases }
  }
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'plugin-catalog',
    order: 20,
    label: '插件目录',
    inject: () => ({ list }),
  }, PluginCatalogTab))
}
