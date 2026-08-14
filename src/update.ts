/**
 * dsh-plugin-catalog — update detection + command generation (plan §5.6).
 *
 * UpdateCheckService probes every non-group plugin for a newer release:
 *
 *   link   → never probed (status `local-link`, "本地链接");
 *   in-box → not probed per package (status `in-box`; the UI aggregates the
 *            DSH body as a single line, plan §5.6);
 *   else   → npm `/latest` first, GitHub releases/tags API as fallback
 *            (the `github:`-spec installs and unpublished packages like
 *            whale-girl), and when BOTH fail the status is `cannot-check`
 *            ("无法检查") — never a misleading "最新".
 *
 * The semver comparison and the npm probe skeleton below are copied from
 * `@linxin666/dsh-remote-web-ui/lib/types/update.js` (a whitelisted read-only
 * reference): `parseSemver`/`compareVersions` verbatim in behavior, and the
 * fetch-with-AbortController timeout pattern from `fetchLatestVersion`.
 *
 * Cadence (plan §5.6): results are cached at `~/.dsh/cache/plugin-updates.json`
 * (injectable path). A non-forced check re-uses the cached entries while
 * `now - lastCheckAt < 24h` (daily-lazy); `force` re-probes everything and
 * rewrites the cache. Per-source probe TTLs (npm 1h / GitHub 24h, plan §5.6)
 * are honored inside the cache so a forced refresh within the TTL still
 * reuses fresh probe results.
 *
 * UpdateRunner only GENERATES the `pnpm update <pkgs...>` command — the
 * plugin never executes it (task 4: "只生成 pnpm update 命令不执行").
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SourceKind } from './meta.ts'

// ---------------------------------------------------------------------------
// semver (copied from @linxin666/dsh-remote-web-ui/lib/types/update.js)
// ---------------------------------------------------------------------------

/** Parse a semver string (leading `v` tolerated, build metadata ignored). */
export function parseSemver(value: string): { major: number; minor: number; patch: number; prerelease: string[] } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Compare two semantic versions per semver precedence (a release outranks its
 * prereleases; numeric prerelease identifiers compare numerically and sort
 * below alphanumeric ones). Unparseable sorts below parseable; two
 * unparseable compare equal.
 * @returns negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa === undefined && pb === undefined) return 0
  if (pa === undefined) return -1
  if (pb === undefined) return 1
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0
  if (pa.prerelease.length === 0) return 1
  if (pb.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(pa.prerelease.length, pb.prerelease.length); index++) {
    const ra = pa.prerelease[index]
    const rb = pb.prerelease[index]
    if (ra === undefined) return -1
    if (rb === undefined) return 1
    if (ra === rb) continue
    const numericA = /^\d+$/.test(ra)
    const numericB = /^\d+$/.test(rb)
    if (numericA && numericB) return Number(ra) < Number(rb) ? -1 : 1
    if (numericA) return -1
    if (numericB) return 1
    return ra < rb ? -1 : 1
  }
  return 0
}

// ---------------------------------------------------------------------------
// probe seams
// ---------------------------------------------------------------------------

/** The fetch surface the probes call (global fetch in the host; injected in tests). */
export type FetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}>

/** npm registry base used for `/latest` probes (same as the remote-web-ui reference). */
export const NPM_REGISTRY = 'https://registry.npmjs.org'

/** Default probe timeout, mirrored from the remote-web-ui reference. */
export const PROBE_TIMEOUT_MS = 10_000

/**
 * Probe the npm registry for a package's `latest` version. Skeleton copied
 * from `@linxin666/dsh-remote-web-ui/lib/types/update.js` `fetchLatestVersion`
 * (AbortController timeout; any failure → undefined).
 */
export async function fetchNpmLatest(packageName: string, fetchImpl: FetchImpl, timeoutMs = PROBE_TIMEOUT_MS): Promise<string | undefined> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(NPM_REGISTRY + '/' + packageName.replace('/', '%2F') + '/latest', { signal: controller.signal })
      if (!response.ok) return undefined
      const body = await response.json()
      if (typeof body !== 'object' || body === null) return undefined
      const version = (body as { version?: unknown }).version
      return typeof version === 'string' ? version : undefined
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return undefined
  }
}

/** GitHub API base used by the releases/tags fallback. */
export const GITHUB_API = 'https://api.github.com'

/**
 * Probe GitHub for a repository's newest release tag: `releases/latest`
 * first (404 when the repo has no releases), then the first `tags` entry.
 * Mirrors the remote-web-ui probe shape (timeout + swallow), extended with
 * the tags fallback (plan §5.6 "GitHub releases/tags API 回退").
 */
export async function fetchGithubLatest(repository: string, fetchImpl: FetchImpl, timeoutMs = PROBE_TIMEOUT_MS): Promise<string | undefined> {
  const repo = parseGitHubRepository(repository)
  if (repo === null) return undefined
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-plugin-catalog' }
      const release = await fetchImpl(`${GITHUB_API}/repos/${repo.owner}/${repo.repo}/releases/latest`, { headers, signal: controller.signal })
      if (release.ok) {
        const body = await release.json()
        const tag = (body as { tag_name?: unknown }).tag_name
        if (typeof tag === 'string' && tag !== '') return tag.replace(/^v/, '')
      }
      const tags = await fetchImpl(`${GITHUB_API}/repos/${repo.owner}/${repo.repo}/tags`, { headers, signal: controller.signal })
      if (tags.ok) {
        const body = await tags.json()
        if (Array.isArray(body) && body.length > 0) {
          const tag = (body[0] as { name?: unknown }).name
          if (typeof tag === 'string' && tag !== '') return tag.replace(/^v/, '')
        }
      }
      return undefined
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return undefined
  }
}

/**
 * Parse `owner/repo` out of a normalized https GitHub URL
 * (`https://github.com/<owner>/<repo>`). Anything else → null.
 */
export function parseGitHubRepository(repository: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(repository)
    if (url.hostname !== 'github.com') return null
    // pathname is '/owner/repo' → split('/') = ['', owner, repo] → the leading
    // empty entry is removed by filter, so the owner is element 0 (no leading
    // comma in the destructure — a leading comma would skip the owner).
    const [owner, repo] = url.pathname.split('/').filter(Boolean)
    if (owner === undefined || repo === undefined) return null
    return { owner, repo: repo.replace(/\.git$/, '') }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// per-package update entries
// ---------------------------------------------------------------------------

/** Public update status vocabulary (plan §5.6 — never a wrong "最新"). */
export type UpdateStatus = 'update-available' | 'up-to-date' | 'local-link' | 'in-box' | 'cannot-check' | 'unknown-version'

/** One package's update projection. */
export interface UpdateEntry {
  packageName: string
  sourceKind: SourceKind
  currentVersion: string | null
  latestVersion: string | null
  /** Where `latestVersion` came from (null when nothing could be probed). */
  source: 'npm' | 'github' | 'link' | 'in-box' | null
  status: UpdateStatus
}

/** Per-source probe TTLs (plan §5.6: npm 1h / GitHub 24h), in milliseconds. */
export const PROBE_TTL: Record<'npm' | 'github', number> = {
  npm: 60 * 60 * 1000,
  github: 24 * 60 * 60 * 1000,
}

/** Whether a stored probe result is still fresh for its source at `now`. */
export function probeIsFresh(probe: { at: string } | undefined, source: 'npm' | 'github', now: number): boolean {
  if (probe === undefined) return false
  const at = Date.parse(probe.at)
  if (Number.isNaN(at)) return false
  return now - at < PROBE_TTL[source]
}

/**
 * Judge ONE package's update status (pure; the service loops over entries).
 * @param deps - the package facts + injected fetch.
 */
export async function checkOnePackage(deps: {
  packageName: string
  sourceKind: SourceKind
  currentVersion: string | null
  repository: string | null
  fetchImpl: FetchImpl
}): Promise<UpdateEntry> {
  const { packageName, sourceKind, currentVersion, repository } = deps
  if (sourceKind === 'link') {
    return { packageName, sourceKind, currentVersion, latestVersion: null, source: 'link', status: 'local-link' }
  }
  if (sourceKind === 'in-box') {
    return { packageName, sourceKind, currentVersion, latestVersion: null, source: 'in-box', status: 'in-box' }
  }
  // npm first, GitHub releases/tags as fallback.
  let latest: string | undefined
  let source: 'npm' | 'github' | null = null
  latest = await fetchNpmLatest(packageName, deps.fetchImpl)
  if (latest !== undefined) {
    source = 'npm'
  } else if (repository !== null) {
    latest = await fetchGithubLatest(repository, deps.fetchImpl)
    if (latest !== undefined) source = 'github'
  }
  if (latest === undefined) {
    // Both probes failed — report the outage honestly, never "最新".
    return { packageName, sourceKind, currentVersion, latestVersion: null, source: null, status: 'cannot-check' }
  }
  if (currentVersion === null) {
    return { packageName, sourceKind, currentVersion, latestVersion: latest, source, status: 'unknown-version' }
  }
  const status: UpdateStatus = compareVersions(latest, currentVersion) > 0 ? 'update-available' : 'up-to-date'
  return { packageName, sourceKind, currentVersion, latestVersion: latest, source, status }
}

// ---------------------------------------------------------------------------
// cache + service
// ---------------------------------------------------------------------------

/** On-disk shape of the update cache (`~/.dsh/cache/plugin-updates.json`). */
export interface UpdatesCache {
  lastCheckAt: string
  entries: UpdateEntry[]
  /** Per-package probe results with timestamps (npm 1h / GitHub 24h TTL). */
  probes: Record<string, { latest: string | null; source: 'npm' | 'github' | null; at: string }>
}

/** Read the updates cache file, tolerating absence/garbage. */
export function readUpdatesCache(cachePath: string): UpdatesCache {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Partial<UpdatesCache>
    return {
      lastCheckAt: typeof parsed.lastCheckAt === 'string' ? parsed.lastCheckAt : '',
      entries: Array.isArray(parsed.entries) ? parsed.entries as UpdateEntry[] : [],
      probes: typeof parsed.probes === 'object' && parsed.probes !== null && !Array.isArray(parsed.probes)
        ? parsed.probes as UpdatesCache['probes']
        : {},
    }
  } catch {
    return { lastCheckAt: '', entries: [], probes: {} }
  }
}

/** Atomically write the updates cache (temp file + rename) so a crash cannot corrupt it. */
export function writeUpdatesCache(cachePath: string, cache: UpdatesCache): void {
  const tempPath = `${cachePath}.tmp`
  writeFileSync(tempPath, JSON.stringify(cache, null, 2), 'utf8')
  try {
    renameSync(tempPath, cachePath)
  } catch {
    // Never throw from a cache write — the check result still returns to the
    // caller; only the persistence is lost.
  }
}

/** Constructor options for UpdateCheckService (all injectable). */
export interface UpdateCheckServiceOptions {
  /** Updates cache path; defaults to `$DSH_HOME/cache/plugin-updates.json`. */
  cachePath?: string
  fetchImpl?: FetchImpl
  /** Current epoch ms; injectable for deterministic cadence tests. */
  now?: () => number
  /** Per-package facts (sourceKind/version/repository); defaults to reading PluginMetaService. */
  metaProvider?: () => Array<{ moduleName: string; meta: { sourceKind: SourceKind; version: string | null; repository: string | null } | null }>
}

/** Default cache path: `$DSH_HOME/cache/plugin-updates.json` (≈ `~/.dsh/cache/…`). */
export function defaultUpdatesCachePath(dshHome: string): string {
  return join(dshHome, 'cache', 'plugin-updates.json')
}

/** Resolve the DSH home directory the way the host does (env first, then home). */
export function dshHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Update detection service. `check({ force })` returns the cached entries
 * while a previous check is under 24h old (plan §5.6 daily-lazy), otherwise
 * re-probes every package and rewrites the cache. `force` always re-probes
 * (per-source TTLs still reuse fresh npm/GitHub probe results).
 */
export class UpdateCheckService {
  private options: UpdateCheckServiceOptions

  constructor(options: UpdateCheckServiceOptions = {}) {
    this.options = options
  }

  /** The service reads package facts through this seam (PluginMetaService in the host). */
  private facts(): Array<{ moduleName: string; meta: { sourceKind: SourceKind; version: string | null; repository: string | null } | null }> {
    const provider = this.options.metaProvider
    if (provider !== undefined) return provider()
    return []
  }

  /** Check updates for every provided package. */
  async check(deps: { force?: boolean } = {}): Promise<{ checkedAt: string; fromCache: boolean; entries: UpdateEntry[] }> {
    const now = this.options.now?.() ?? Date.now()
    const cachePath = this.options.cachePath ?? defaultUpdatesCachePath(dshHomeDir())
    const cache = readUpdatesCache(cachePath)
    const lastAt = Date.parse(cache.lastCheckAt)
    const fresh = !Number.isNaN(lastAt) && now - lastAt < 24 * 60 * 60 * 1000
    if (!deps.force && fresh && cache.entries.length > 0) {
      return { checkedAt: cache.lastCheckAt, fromCache: true, entries: cache.entries }
    }
    const fetchImpl = this.options.fetchImpl ?? ((url: string) => fetch(url))
    const facts = this.facts()
    const probes = { ...cache.probes }
    const entries: UpdateEntry[] = []
    for (const fact of facts) {
      if (fact.meta === null) continue
      const packageName = fact.moduleName
      const { sourceKind, version, repository } = fact.meta
      // Reuse a fresh probe result (npm 1h / GitHub 24h) instead of re-fetching.
      const cachedProbe = probes[packageName]
      const probeSource = cachedProbe?.source
      if (
        (sourceKind === 'registry' && probeSource === 'npm' && probeIsFresh(cachedProbe, 'npm', now))
        || (sourceKind === 'github' && probeSource === 'github' && probeIsFresh(cachedProbe, 'github', now))
      ) {
        const latest = cachedProbe.latest
        entries.push(statusFromLatest({ packageName, sourceKind, currentVersion: version, latest, source: cachedProbe.source }))
        continue
      }
      const entry = await checkOnePackage({ packageName, sourceKind, currentVersion: version, repository, fetchImpl })
      if (entry.source !== 'link' && entry.source !== 'in-box' && entry.source !== null) {
        probes[packageName] = { latest: entry.latestVersion, source: entry.source, at: new Date(now).toISOString() }
      }
      entries.push(entry)
    }
    const checkedAt = new Date(now).toISOString()
    writeUpdatesCache(cachePath, { lastCheckAt: checkedAt, entries, probes })
    return { checkedAt, fromCache: false, entries }
  }
}

/** Derive the status from a (possibly cached) latest value. */
export function statusFromLatest(deps: {
  packageName: string
  sourceKind: SourceKind
  currentVersion: string | null
  latest: string | null
  source: 'npm' | 'github' | null
}): UpdateEntry {
  const { packageName, sourceKind, currentVersion, latest, source } = deps
  if (latest === null) return { packageName, sourceKind, currentVersion, latestVersion: null, source: null, status: 'cannot-check' }
  if (currentVersion === null) return { packageName, sourceKind, currentVersion, latestVersion: latest, source, status: 'unknown-version' }
  const status: UpdateStatus = compareVersions(latest, currentVersion) > 0 ? 'update-available' : 'up-to-date'
  return { packageName, sourceKind, currentVersion, latestVersion: latest, source, status }
}

// ---------------------------------------------------------------------------
// UpdateRunner — command generation ONLY (never executes)
// ---------------------------------------------------------------------------

/**
 * Build the `pnpm update` command the user runs in the profile directory.
 * The runner deliberately performs no spawn: task 4 "只生成 pnpm update
 * 命令不执行"; the client shows the command + the restart hint (plan D9).
 */
export function buildUpdateCommand(packages: readonly string[], profileDir: string): string {
  const unique = [...new Set(packages)]
  if (unique.length === 0) return ''
  const target = `pnpm update ${unique.join(' ')}`
  return `cd ${JSON.stringify(profileDir)} && ${target}`
}

/** The restart hint shown after an update (plan D9: only prompt, never restart). */
export function restartCommand(profileName: string): string {
  return `dsh restart --profile ${profileName}`
}
