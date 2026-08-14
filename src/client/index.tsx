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
import {
  TRANSLATE_DIALOG_COPY,
  canTranslate,
  localizeCardText,
  persistLocalizeOn,
  persistTranslateOptIn,
  readLocalizeOn,
  readTranslateOptIn,
  type TranslateOptIn,
} from '../localize.ts'
import { CATEGORY_DEFS, classifyEntry } from '../categories.ts'
import { buildPluginManifestSnippet, stringifyPluginManifest } from '../plugin-manifest.ts'

/** The host `/api/plugin-catalog/list` payload. */
export interface PluginCatalogListResponse {
  entries: CatalogEntryLike[]
  aliases?: BuiltinAliasEntry[]
}

/** The `/api/plugin-catalog/updates` payload (one row per package, plan §5.6). */
export interface UpdateEntryLike {
  packageName: string
  sourceKind?: string
  currentVersion?: string | null
  latestVersion?: string | null
  source?: 'npm' | 'github' | 'link' | 'in-box' | null
  status: 'update-available' | 'up-to-date' | 'local-link' | 'in-box' | 'cannot-check' | 'unknown-version'
}

/** The `/api/plugin-catalog/updates` response envelope. */
export interface UpdatesResponse {
  checkedAt?: string
  fromCache?: boolean
  entries: UpdateEntryLike[]
}

/** One card's update-check / update-action state machine (plan §5.6). */
export type UpdateUiState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'checked'; entry: UpdateEntryLike | null; checkedAt: string }
  | { status: 'error'; message: string }
  | { status: 'command'; command: string; restart: string }

/** One card's AI-summary state machine (plan §5.5). */
export type SummaryUiState =
  | { status: 'idle' }
  | { status: 'estimating' }
  | { status: 'estimate'; estimatedTokens: number }
  | { status: 'generating'; estimatedTokens: number }
  | { status: 'success' }
  | { status: 'error'; code: string; message: string }

/** POST a JSON body to a catalog route; returns the parsed payload. */
async function apiPost(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** GET a catalog route; returns the parsed payload. */
async function apiGet(path: string): Promise<unknown> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
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
.dpc-update-badge{border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);border-radius:6px;font-size:11px;line-height:16px;padding:0 6px;flex:none;font-variant-numeric:tabular-nums}
.dpc-update-badge[data-status=cannot-check]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.dpc-update-badge[data-status=up-to-date]{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);background:transparent}
.dpc-update-badge[data-status=local-link]{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);background:transparent}
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
.dpc-actions button:disabled{opacity:.55;cursor:default}
.dpc-actions button[data-kind=primary]{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);color:var(--dsw-alias-state-business-primary)}
.dpc-actions button[data-kind=primary]:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dpc-command{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px 10px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-primary);word-break:break-all;display:flex;flex-direction:column;gap:6px}
.dpc-command code{font:inherit;white-space:pre-wrap}
.dpc-command button{align-self:flex-start;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:22px;border-radius:6px;padding:0 10px;cursor:pointer}
.dpc-command p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}
.dpc-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}
.dpc-no-result{display:flex;flex-direction:column;gap:10px;padding:4px 2px}
.dpc-no-result p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dpc-suggestions{display:flex;flex-direction:column;gap:6px}
.dpc-suggestions strong{font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:500}
.dpc-chips{display:flex;gap:8px;flex-wrap:wrap}
.dpc-chip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:26px;border-radius:999px;padding:0 12px;cursor:pointer}
.dpc-chip:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dpc-category-chips{display:flex;gap:8px;flex-wrap:wrap}
.dpc-category-chip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:26px;border-radius:999px;padding:0 12px;cursor:pointer}
.dpc-category-chip:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dpc-category-chip[data-active=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dpc-category-chip .dpc-chip-count{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-left:4px;font-variant-numeric:tabular-nums}
.dpc-mark{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 32%,transparent);border-radius:3px;padding:0 1px}
.dpc-localize-toggle{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:34px;border-radius:8px;padding:0 12px;cursor:pointer;white-space:nowrap;user-select:none}
.dpc-localize-toggle input{accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;margin:0}
.dpc-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent);backdrop-filter:blur(2px)}
.dpc-dialog{width:min(440px,calc(100vw - 48px));border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3);border-radius:12px;box-shadow:var(--dsw-shadow-lv2);padding:18px;display:flex;flex-direction:column;gap:12px}
.dpc-dialog h3{margin:0;font-size:15px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dpc-dialog p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dpc-dialog-actions{display:flex;gap:8px;flex-wrap:wrap}
.dpc-dialog-actions button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:30px;border-radius:8px;padding:0 16px;cursor:pointer}
.dpc-dialog-actions button[data-kind=primary]{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);color:var(--dsw-alias-state-business-primary)}
.dpc-dialog-actions button:hover:not(:disabled){border-color:var(--dsw-alias-border-l1)}
.dpc-dialog-cancel{color:var(--dsw-alias-label-tertiary)!important}
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
  updateState,
  summaryState,
  translateAllowed,
  localizeOn,
  onCheckUpdate,
  onUpdateOne,
  onGenerateSummary,
}: {
  entry: CatalogEntryLike
  query: string
  open: boolean
  onToggle: () => void
  updateState: UpdateUiState
  summaryState: SummaryUiState
  /** 「翻译此插件」按钮权限 (D10): 'need' → every plugin; else third-party only. */
  translateAllowed: boolean
  /** 汉化开关 (D10): on = Chinese-first rendering. */
  localizeOn: boolean
  onCheckUpdate: () => void
  onUpdateOne: () => void
  onGenerateSummary: () => void
}): JSX.Element {
  const meta = entry.meta ?? {}
  // Single source of truth for card text (D10): table > AI summary, with the
  // 「暂无中文简介」placeholder when a Chinese description is missing.
  const text = localizeCardText(entry.moduleName, meta, localizeOn)
  const shortName = text.short
  const phase = entry.fiberPhase ?? 'unobserved'
  const statusLabel = FIBER_PHASE_LABELS[phase] ?? phase
  const detailId = `dpc-details-${encodeURIComponent(entry.entryId)}`

  // Task 2: 导出 dsh.plugin 片段 — build the JSON snippet from meta + summary
  // and copy it; show the snippet while the "已复制" feedback is live.
  const [manifestCopied, setManifestCopied] = useState(false)
  const manifestSnippet = useMemo(() => stringifyPluginManifest(buildPluginManifestSnippet(entry)), [entry])
  const copyManifest = (): void => {
    navigator.clipboard?.writeText(manifestSnippet).catch(() => undefined)
    setManifestCopied(true)
    window.setTimeout(() => setManifestCopied(false), 2500)
  }

  // Update badge (plan §5.6: ↑latest when an update is available; never a
  // wrong "最新" — probe failure shows 无法检查 instead).
  const updateEntry = updateState.status === 'checked' ? updateState.entry : null
  const updateBadge =
    updateEntry === null ? null : updateEntry.status === 'update-available' ? (
      <span className="dpc-update-badge" data-status="update-available" title={`可更新到 ${updateEntry.latestVersion ?? ''}`}>
        ↑{updateEntry.latestVersion ?? ''}
      </span>
    ) : updateEntry.status === 'cannot-check' ? (
      <span className="dpc-update-badge" data-status="cannot-check" title="更新源不可达，无法检查">无法检查</span>
    ) : updateEntry.status === 'up-to-date' ? (
      <span className="dpc-update-badge" data-status="up-to-date" title="已是最新">最新</span>
    ) : updateEntry.status === 'local-link' ? (
      <span className="dpc-update-badge" data-status="local-link" title="本地链接安装，不参与更新检测">本地链接</span>
    ) : null

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
        <span className="dpc-name" title={text.name !== '' ? text.name : entry.moduleName}>
          <Highlight text={text.name} query={query} />
        </span>
        <span className="dpc-short">{shortName}</span>
        {meta.version != null && <span className="dpc-version">v{meta.version}</span>}
        {updateBadge}
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
      <p className="dpc-desc" title={text.desc !== '' ? text.desc : undefined}>
        {text.desc !== '' ? <Highlight text={text.desc} query={query} /> : shortName}
      </p>
      {open && (
        <div className="dpc-details" id={detailId}>
          {text.desc !== '' && <p>{text.desc}</p>}
          <dl>
            <div><dt>包名</dt><dd>{entry.moduleName}</dd></div>
            <div><dt>入口</dt><dd>{entry.entryId}</dd></div>
            {meta.version != null && <div><dt>版本</dt><dd>v{meta.version}</dd></div>}
            {updateEntry !== null && updateEntry.latestVersion != null && <div><dt>最新</dt><dd>v{updateEntry.latestVersion}（{updateEntry.source}）</dd></div>}
            {updateState.status === 'checked' && updateState.checkedAt !== '' && <div><dt>检查于</dt><dd>{updateState.checkedAt}</dd></div>}
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

          <div className="dpc-actions">
            <button
              type="button"
              onClick={onCheckUpdate}
              disabled={updateState.status === 'checking' || updateState.status === 'command'}
            >
              {updateState.status === 'checking' ? '检查中…' : '检查更新'}
            </button>
            {updateEntry?.status === 'update-available' && (
              <button type="button" data-kind="primary" onClick={onUpdateOne} disabled={updateState.status === 'command'}>
                更新此插件
              </button>
            )}
            {translateAllowed && (
              <button
                type="button"
                onClick={onGenerateSummary}
                disabled={summaryState.status === 'estimating' || summaryState.status === 'generating' || summaryState.status === 'success'}
              >
                {summaryState.status === 'generating'
                  ? '翻译中…'
                  : summaryState.status === 'estimating'
                    ? '估算中…'
                    : summaryState.status === 'success'
                      ? '已翻译'
                      : summaryState.status === 'estimate'
                        ? `翻译此插件（约 ${summaryState.estimatedTokens} tokens）`
                        : '翻译此插件'}
              </button>
            )}
            <button type="button" onClick={copyManifest}>
              {manifestCopied ? '已复制' : '导出 dsh.plugin 片段'}
            </button>
          </div>

          {manifestCopied && (
            <div className="dpc-command">
              <code>{manifestSnippet}</code>
              <p>已复制到剪贴板。将此片段粘贴进插件的 package.json 的 dsh.plugin 字段即可反哺公约（见 docs/dsh-plugin-convention.md）。</p>
            </div>
          )}

          {updateState.status === 'checked' && updateEntry?.status === 'update-available' && (
            <p className="dpc-hint">发现新版本 v{updateEntry.currentVersion ?? ''} → v{updateEntry.latestVersion ?? ''}，点击「更新此插件」获取命令。</p>
          )}
          {updateState.status === 'checked' && updateEntry?.status === 'cannot-check' && (
            <p className="dpc-hint">npm 与 GitHub 均不可达，无法检查更新。</p>
          )}
          {updateState.status === 'error' && <p className="dpc-hint">检查失败：{updateState.message}</p>}
          {updateState.status === 'command' && (
            <div className="dpc-command">
              <code>{updateState.command}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(updateState.command).catch(() => undefined)}>复制更新命令</button>
              <p>更新完成后请重启 DSH 生效：<code>{updateState.restart}</code>（只提示，不自动重启）</p>
            </div>
          )}

          {summaryState.status === 'estimate' && (
            <p className="dpc-hint">预计消耗约 {summaryState.estimatedTokens} tokens（README 截断后输入），再次点击生成。</p>
          )}
          {summaryState.status === 'error' && <p className="dpc-hint">摘要生成失败：{summaryState.message}</p>}
          {summaryState.status === 'success' && <p className="dpc-hint">AI 摘要已生成并缓存（pkg@版本），列表立即生效。</p>}
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
  // Task 2: 分类 chips 过滤 — one selected category id (null = no filter).
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  // Task 4: update checks + AI summary state machines, keyed by entryId.
  const [updates, setUpdates] = useState<Record<string, UpdateUiState>>({})
  const [summaries, setSummaries] = useState<Record<string, SummaryUiState>>({})
  const [bulkState, setBulkState] = useState<{ status: 'idle' | 'checking' | 'done'; count: number }>({ status: 'idle', count: 0 })
  // Task 1 (D10): 汉化开关（默认开）+ 一次性翻译授权选择（未设置=首次进入询问）。
  const [localizeOn, setLocalizeOn] = useState<boolean>(() => readLocalizeOn(window.localStorage))
  const [translateOptIn, setTranslateOptIn] = useState<TranslateOptIn | null>(() => readTranslateOptIn(window.localStorage))
  const [translateSettingsOpen, setTranslateSettingsOpen] = useState(false)

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

  // Daily auto-check on open (plan D3): the host decides from its 24h cache —
  // force=false. Manual refresh (toolbar button) passes force=true.
  const runCheckUpdates = useMemo(() => (force: boolean) => {
    setBulkState({ status: 'checking', count: 0 })
    apiGet(`/api/plugin-catalog/updates${force ? '?force=1' : ''}`)
      .then(
        (body) => {
          const payload = body as { entries?: UpdateEntryLike[]; checkedAt?: string }
          const rows = payload.entries ?? []
          const next: Record<string, UpdateUiState> = {}
          for (const row of rows) next[row.packageName] = { status: 'checked', entry: row, checkedAt: payload.checkedAt ?? '' }
          setUpdates(next)
          setBulkState({ status: 'done', count: rows.filter((row) => row.status === 'update-available').length })
        },
        (error: unknown) => {
          setBulkState({ status: 'done', count: 0 })
          const message = error instanceof Error ? error.message : String(error)
          setBulkState({ status: 'idle', count: 0 })
          console.warn('plugin-catalog update check failed:', message)
        },
      )
  }, [])

  // Initial (cache-first) check once the list is ready.
  useEffect(() => {
    if (state.status === 'ready') runCheckUpdates(false)
  }, [state.status, runCheckUpdates])

  const results = useMemo(() => {
    if (state.status !== 'ready') return []
    const hits = searchPlugins(state.entries, debounced, state.aliases)
    // 分类 chips 过滤：与搜索取交集（点 chip 过滤列表，再点取消）。
    if (selectedCategory === null) return hits
    return hits.filter((hit) => classifyEntry(hit.entry, state.aliases).includes(selectedCategory))
  }, [state, debounced, selectedCategory])
  // Per-category counts over ALL entries (chips stay honest while searching).
  const categoryCounts = useMemo(() => {
    if (state.status !== 'ready') return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const entry of state.entries) {
      for (const id of classifyEntry(entry, state.aliases)) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [state])
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

  /** 汉化开关 (D10): 默认开，localStorage 持久化。 */
  const toggleLocalize = (): void => {
    const next = !localizeOn
    setLocalizeOn(next)
    persistLocalizeOn(window.localStorage, next)
  }

  /** 一次性翻译授权选择 (D10): 持久化并关闭询问框。 */
  const chooseTranslateOptIn = (choice: TranslateOptIn): void => {
    setTranslateOptIn(choice)
    persistTranslateOptIn(window.localStorage, choice)
    setTranslateSettingsOpen(false)
  }

  // First visit (translateOptIn unset) or the 「翻译设置」 entry: show the
  // one-time 「是否需要中文翻译？」 dialog. When the choice was never made it
  // is modal (must pick); when re-opened from the toolbar a cancel is offered.
  const showTranslateDialog = state.status === 'ready' && (translateOptIn === null || translateSettingsOpen)

  /** One card: re-check (force) and read back that package's row. */
  const checkOne = (moduleName: string): void => {
    setUpdates((current): Record<string, UpdateUiState> => ({ ...current, [moduleName]: { status: 'checking' } }))
    apiGet('/api/plugin-catalog/updates?force=1').then(
      (body) => {
        const payload = body as { entries?: UpdateEntryLike[]; checkedAt?: string }
        const row = (payload.entries ?? []).find((entry) => entry.packageName === moduleName) ?? null
        setUpdates((current): Record<string, UpdateUiState> => ({ ...current, [moduleName]: { status: 'checked', entry: row, checkedAt: payload.checkedAt ?? '' } }))
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setUpdates((current): Record<string, UpdateUiState> => ({ ...current, [moduleName]: { status: 'error', message } }))
      },
    )
  }

  /** One card: ask the host for the update command (UpdateRunner never executes). */
  const updateOne = (moduleName: string): void => {
    apiPost('/api/plugin-catalog/update', { packages: [moduleName] }).then(
      (body) => {
        const payload = body as { ok?: boolean; command?: string; restart?: string; code?: string; message?: string }
        if (payload.ok !== true || payload.command === undefined) {
          setUpdates((current): Record<string, UpdateUiState> => ({ ...current, [moduleName]: { status: 'error', message: payload.message ?? `未实现（${payload.code ?? 'unknown'}）` } }))
          return
        }
        // Local const capture: property-access narrowing (payload.command)
        // does not survive into the setState closure, so read once here.
        const command: string = payload.command
        const restart: string = payload.restart ?? ''
        setUpdates((current): Record<string, UpdateUiState> => ({ ...current, [moduleName]: { status: 'command', command, restart } }))
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setUpdates((current): Record<string, UpdateUiState> => ({ ...current, [moduleName]: { status: 'error', message } }))
      },
    )
  }

  /** One card: AI summary — estimate the token cost first, then generate on the second tap. */
  const generateSummary = (entry: CatalogEntryLike): void => {
    const current = summaries[entry.entryId] ?? { status: 'idle' }
    if (current.status === 'estimate' || current.status === 'generating') return
    const meta = entry.meta ?? {}
    const repository = meta.repository ?? null
    const run = (): void => {
      setSummaries((all): Record<string, SummaryUiState> => ({ ...all, [entry.entryId]: { status: 'generating', estimatedTokens: 0 } }))
      apiPost('/api/plugin-catalog/summary', {
        packageName: entry.moduleName,
        repository,
        version: meta.version ?? null,
      }).then(
        (body) => {
          const payload = body as { ok?: boolean; code?: string; message?: string }
          if (payload.ok !== true) {
            setSummaries((all): Record<string, SummaryUiState> => ({ ...all, [entry.entryId]: { status: 'error', code: payload.code ?? 'unknown', message: payload.message ?? '生成失败' } }))
            return
          }
          setSummaries((all): Record<string, SummaryUiState> => ({ ...all, [entry.entryId]: { status: 'success' } }))
          // Refresh the list so the cached summary renders immediately.
          setRequest((value) => value + 1)
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setSummaries((all): Record<string, SummaryUiState> => ({ ...all, [entry.entryId]: { status: 'error', code: 'network', message } }))
        },
      )
    }
    if (current.status === 'idle') {
      setSummaries((all): Record<string, SummaryUiState> => ({ ...all, [entry.entryId]: { status: 'estimating' } }))
      apiPost('/api/plugin-catalog/summary/estimate', { repository }).then(
        (body) => {
          const payload = body as { estimatedTokens?: number; ok?: false; code?: string; message?: string }
          if (typeof payload.estimatedTokens === 'number') {
            // Local const capture: type-guard narrowing of the property does
            // not survive into the setState closure.
            const estimatedTokens: number = payload.estimatedTokens
            setSummaries((all): Record<string, SummaryUiState> => ({ ...all, [entry.entryId]: { status: 'estimate', estimatedTokens } }))
          } else {
            const message = payload.message ?? '无法估算成本（可能没有仓库地址）'
            setSummaries((all): Record<string, SummaryUiState> => ({ ...all, [entry.entryId]: { status: 'error', code: payload.code ?? 'estimate-failed', message } }))
          }
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setSummaries((all): Record<string, SummaryUiState> => ({ ...all, [entry.entryId]: { status: 'error', code: 'network', message } }))
        },
      )
      return
    }
    run()
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
            <button
              type="button"
              className="dpc-layout-toggle"
              onClick={() => runCheckUpdates(true)}
              disabled={bulkState.status === 'checking'}
            >
              {bulkState.status === 'checking' ? '检查中…' : '检查全部更新'}
            </button>
            {bulkState.status === 'done' && bulkState.count > 0 && (
              <span className="dpc-count" data-update-count={bulkState.count}>{bulkState.count} 个可更新</span>
            )}
            <label className="dpc-localize-toggle">
              <input
                type="checkbox"
                checked={localizeOn}
                onChange={toggleLocalize}
                aria-label="汉化"
              />
              汉化
            </label>
            <button type="button" className="dpc-layout-toggle" onClick={() => setTranslateSettingsOpen(true)}>
              翻译设置
            </button>
            <button type="button" className="dpc-layout-toggle" onClick={toggleLayout}>
              {layout === 'single' ? '双列紧凑' : '单列'}
            </button>
            <span className="dpc-count" data-plugin-count={results.length}>{results.length} 个</span>
          </div>

          {/* Task 2: 分类 chips — static classifier (remote/ui/pets/ops/design…),
              one click filters the list, click again (or 清除筛选) to reset. */}
          <div className="dpc-category-chips" role="group" aria-label="按分类筛选插件">
            {CATEGORY_DEFS.map((def) => {
              const count = categoryCounts.get(def.id) ?? 0
              if (count === 0) return null
              return (
                <button
                  key={def.id}
                  type="button"
                  className="dpc-category-chip"
                  data-active={selectedCategory === def.id ? 'true' : undefined}
                  aria-pressed={selectedCategory === def.id}
                  title={`筛选「${def.label}」分类（${count} 个）`}
                  onClick={() => setSelectedCategory((current) => (current === def.id ? null : def.id))}
                >
                  {def.label}
                  <span className="dpc-chip-count">{count}</span>
                </button>
              )
            })}
            {selectedCategory !== null && (
              <button type="button" className="dpc-chip" onClick={() => setSelectedCategory(null)}>
                清除筛选
              </button>
            )}
          </div>

          {showTranslateDialog && (
            <div className="dpc-overlay" role="dialog" aria-modal="true" aria-label={TRANSLATE_DIALOG_COPY.title}>
              <div className="dpc-dialog">
                <h3>{TRANSLATE_DIALOG_COPY.title}</h3>
                <p>{TRANSLATE_DIALOG_COPY.body}</p>
                <div className="dpc-dialog-actions">
                  <button type="button" data-kind="primary" onClick={() => chooseTranslateOptIn('need')}>
                    {TRANSLATE_DIALOG_COPY.needLabel}
                  </button>
                  <button type="button" onClick={() => chooseTranslateOptIn('no-need')}>
                    {TRANSLATE_DIALOG_COPY.noNeedLabel}
                  </button>
                  {translateOptIn !== null && (
                    <button type="button" className="dpc-dialog-cancel" onClick={() => setTranslateSettingsOpen(false)}>
                      取消
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {state.entries.length === 0 && <p className="dpc-status">暂无插件。</p>}
          {state.entries.length > 0 && results.length === 0 && (
            <div className="dpc-no-result">
              <p>
                {debounced.trim() !== ''
                  ? `没有匹配「${debounced}」的插件。`
                  : selectedCategory !== null
                    ? `「${CATEGORY_DEFS.find((def) => def.id === selectedCategory)?.label ?? selectedCategory}」分类下暂无匹配插件。`
                    : '暂无插件。'}
              </p>
              {debounced.trim() !== '' && suggestions.length > 0 && (
                <div className="dpc-suggestions">
                  <strong>最接近的建议：</strong>
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" className="dpc-chip" onClick={() => setQuery(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              {debounced.trim() !== '' && (
                <div className="dpc-chips">
                  {QUICK_CHIP_QUERIES.map((chip) => (
                    <button key={chip} type="button" className="dpc-chip" onClick={() => setQuery(chip)}>{chip}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {results.length > 0 && (
            <ul className={`dpc-cards${layout === 'dual' ? ' dpc-dual' : ''}`}>
              {results.map((hit) => {
                const entry = hit.entry
                const sourceKind = entry.meta?.sourceKind
                // 「翻译此插件」按钮权限 (D10 overrides D8): 'need' opt-in →
                // every plugin (in-box official included); otherwise only
                // third-party registry/github packages.
                const translateAllowed = canTranslate(sourceKind ?? null, translateOptIn)
                return (
                  <PluginCard
                    key={entry.entryId}
                    entry={entry}
                    query={debounced}
                    open={expanded === entry.entryId}
                    onToggle={() => setExpanded((current) => (current === entry.entryId ? null : entry.entryId))}
                    updateState={updates[entry.moduleName] ?? { status: 'idle' }}
                    summaryState={summaries[entry.entryId] ?? { status: 'idle' }}
                    translateAllowed={translateAllowed}
                    localizeOn={localizeOn}
                    onCheckUpdate={() => checkOne(entry.moduleName)}
                    onUpdateOne={() => updateOne(entry.moduleName)}
                    onGenerateSummary={() => generateSummary(entry)}
                  />
                )
              })}
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
