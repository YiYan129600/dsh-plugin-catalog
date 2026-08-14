/**
 * dsh-plugin-catalog — host half (node).
 *
 * Task 1 placeholder became the Task 2 host: a Typert Remote service
 * (`pluginMeta/list`) that projects every non-group Loader entry together
 * with its metadata (`PluginMeta`), resolved the way the `dsh plugin` CLI
 * resolves bundles (dsh-app-boot `resolveBundleDir` semantics, see
 * `src/meta.ts`). The service never throws: an unresolvable or unreadable
 * bundle degrades to `meta: null` (plan §5.1), so a broken plugin row still
 * renders with the current fallback style.
 *
 * Task 4 adds SummaryService / UpdateCheckService / UpdateRunner here.
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildPluginMeta, readPackageJson, readSummariesCache, type PluginInventoryEntry, type PluginMeta, type PluginSummary } from './meta.ts'
import { normalizeUserAliases, type BuiltinAliasEntry } from './search.ts'
import { isTrustedApiRequest, makeCatalogRoutes, type ApiRequestLike } from './routes.ts'

// Re-export the pure helpers: the vitest suite asserts search/route behavior
// (task 3 acceptance) against the built bundle, and the client-facing
// services (task 4) reuse them.
export * from './meta.ts'
export * from './search.ts'
export * from './routes.ts'

/**
 * Minimal structural view of the Cordis Loader surface this service reads.
 * The full `@deepseek-ai/cordis-plugin-loader` types come from the host
 * runtime (peer); declaring only the consumed shape here keeps the package
 * buildable and typecheckable without shipping loader types.
 */
interface LoaderEntryLike {
  id: string
  options: {
    name: string
    group?: boolean
  }
  disabled: boolean
  fiber?: { state: number } | undefined
}
interface LoaderLike {
  entries(): Iterable<LoaderEntryLike>
}
interface LoaderContext {
  loader: LoaderLike
}

/** Brand an existing Loader-tree entry id at the owning boundary (mirrors official gateway). */
function pluginEntryId(value: string): string {
  return value
}

/** Runtime mirror: FiberState is a cross-package const enum (official gateway, same values). */
const FIBER_STATE = {
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5,
} as const

/** Complete public projection of Cordis Fiber states (official gateway). */
const FIBER_PHASE: Record<number, PluginInventoryEntry['fiberPhase']> = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
}

/** Constructor options for PluginMetaService (test seams + runtime anchors). */
export interface PluginMetaServiceOptions {
  /** Absolute path of a file inside the dsh installation (its package.json). */
  installAnchor?: string
  /** The profile directory; defaults to `ctx.baseUrl`. */
  profileDir?: string
  /** Summaries cache path; defaults to `$DSH_HOME/cache/plugin-summaries.json`. */
  summariesCachePath?: string
}

/**
 * Remote-only service exposing the Loader's current non-group entries with
 * their resolved `PluginMeta`. Mirrors `@deepseek-ai/dsh-host-plugin-inventory`
 * `PluginInventoryGateway` (service key `pluginInventory`, remote `list`);
 * this one registers under `pluginMeta` and adds the `meta` projection.
 */
export class PluginMetaService extends TypertRemoteService {
  static inject = ['loader']

  private options: PluginMetaServiceOptions

  constructor(ctx: import('@deepseek-ai/cordis').Context, options: PluginMetaServiceOptions = {}) {
    super(ctx, 'pluginMeta')
    this.options = options
  }

  /** The profile directory this service resolves bundles against. */
  private profileDir(): string | undefined {
    if (this.options.profileDir !== undefined) return this.options.profileDir
    const baseUrl = this.ctx.baseUrl
    if (typeof baseUrl === 'string' && baseUrl !== '') {
      try {
        return fileURLToPath(new URL(baseUrl))
      } catch {
        // fall through to undefined → meta: null rows, never a throw
      }
    }
    return undefined
  }

  /** The dsh installation anchor: resolved once via the installed dsh-app-boot package. */
  private installAnchor(): string | undefined {
    if (this.options.installAnchor !== undefined) return this.options.installAnchor
    try {
      const manifestPath = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-app-boot/package.json')
      return dirname(manifestPath)
    } catch {
      return undefined
    }
  }

  /**
   * Read the profile manifest's dependency spec + template-bundle membership
   * for one module name. A bundle listed in `dsh.profile.bundles` but absent
   * from `dependencies` is a template-built-in (in-box) package.
   */
  private profileFacts(profileDir: string): { dependencies: Record<string, unknown>; bundles: string[] } {
    const manifest = readPackageJson(profileDir) ?? {}
    const dependencies = (manifest as { dependencies?: Record<string, unknown> }).dependencies ?? {}
    const dsh = (manifest as { dsh?: { profile?: { bundles?: unknown } } }).dsh
    const rawBundles = dsh?.profile?.bundles
    const bundles = Array.isArray(rawBundles) ? rawBundles.filter((value): value is string => typeof value === 'string') : []
    return { dependencies, bundles }
  }

  /**
   * Build the metadata projection for one Loader entry's module name.
   * @returns the PluginMeta, or null on any resolution/read failure.
   */
  private metaFor(moduleName: string, summaries: Record<string, PluginSummary>): PluginMeta | null {
    const profileDir = this.profileDir()
    if (profileDir === undefined) return null
    const { dependencies, bundles } = this.profileFacts(profileDir)
    const spec = typeof dependencies[moduleName] === 'string' ? String(dependencies[moduleName]) : undefined
    const inBox = bundles.includes(moduleName) && spec === undefined
    return buildPluginMeta(moduleName, {
      installAnchor: this.installAnchor(),
      profileDir,
      spec,
      inBox,
      summaries,
    })
  }

  /**
   * Read the Loader directly on every call (entry state is already live),
   * and project each non-group entry with its metadata.
   * @returns Current non-group Loader entries in Loader order, each with `meta`.
   */
  @Remote('list')
  list(): { entries: PluginInventoryEntry[] } {
    const summaries = readSummariesCache(this.options.summariesCachePath ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cache', 'plugin-summaries.json'))
    const entries: PluginInventoryEntry[] = []
    for (const entry of (this.ctx as unknown as LoaderContext).loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state] ?? null,
        meta: this.metaFor(entry.options.name, summaries),
      })
    }
    return { entries }
  }
}

/**
 * Read the user-custom alias file `~/.dsh/plugin-aliases.json` (plan §5.3
 * third sourcing level). Any read/parse failure degrades to an empty table —
 * the feature must never take the list page down.
 */
function readUserAliases(): BuiltinAliasEntry[] {
  try {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const raw: unknown = JSON.parse(readFileSync(join(home, 'plugin-aliases.json'), 'utf8'))
    return normalizeUserAliases(raw)
  } catch {
    return []
  }
}

/** Host plugin body: register the metadata service and the loopback-fenced list route. */
export function apply(ctx: import('@deepseek-ai/cordis').Context): void {
  ctx.plugin(PluginMetaService)

  // The list route is a thin HTTP seam over the Typert service: the browser
  // half fetches `/api/plugin-catalog/list` (same-origin, loopback-fenced)
  // and receives the same `{ entries }` projection plus any user aliases.
  // Copied route-registration shape from @linxin666/dsh-remote-web-ui
  // (whitelisted reference); guarded so a late-starting service or an
  // unavailable webServer never crashes the host.
  const webServer = (ctx as unknown as { webServer?: { register(route: unknown): () => void } }).webServer
  if (webServer === undefined) return
  const getService = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
  ctx.effect(() => {
    const disposers = makeCatalogRoutes({
      fence: (request: ApiRequestLike) => isTrustedApiRequest(request, []),
      list: async () => {
        const service = getService('pluginMeta') as PluginMetaService | undefined
        if (service === undefined) return { entries: [] }
        return { entries: service.list().entries, aliases: readUserAliases() }
      },
    }).map((route) => webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-plugin-catalog: list route')
}

/** Services required before the list route can mount (dsh-host-webserver). */
export const inject = ['webServer']
