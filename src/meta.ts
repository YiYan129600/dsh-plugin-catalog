/**
 * dsh-plugin-catalog — host-side plugin metadata.
 *
 * Task 2: PluginMetaService builds `meta` for every inventory entry the way
 * the `dsh plugin` CLI would: locate the bundle's package directory with the
 * same two-anchor rule as `@deepseek-ai/dsh-app-boot`'s `resolveBundleDir`
 * (installation anchor first, then the profile directory), read its
 * package.json, and project the fields the client list page needs. Any
 * resolution/read failure degrades to `meta: null` — never a throw — exactly
 * as the plan (§5.1) and the task book require.
 *
 * Pure, seam-free logic lives here as plain exported functions so vitest can
 * exercise the real resolution rules against fixture packages under
 * `tests/fixtures/` without a live host process; the Typert service class in
 * `src/index.ts` is a thin shell over them.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** How a plugin was installed; decides whether update checks apply (plan §5.1). */
export type SourceKind = 'registry' | 'github' | 'link' | 'in-box' | 'unknown'

/** Cached AI/builtin summary attached to a plugin (plan §5.5, §5.1). */
export interface PluginSummary {
  nameZh: string
  descZh: string
  source: 'builtin' | 'ai' | 'manual'
  model?: string
  generatedAt: string
}

/** The metadata projection served to the client list (plan §5.1). */
export interface PluginMeta {
  packageName: string
  version: string | null
  description: string | null
  keywords: string[]
  /** Normalized https URL (git+ prefix and trailing .git stripped). */
  repository: string | null
  homepage: string | null
  license: string | null
  sourceKind: SourceKind
  /** Cached summary for `pkg@version`, when one exists (read-only here). */
  summary: PluginSummary | null
}

/** The inventory row shape the client consumes: loader projection + meta. */
export interface PluginInventoryEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
  meta: PluginMeta | null
}

/**
 * Resolve one package's root directory from a single anchor by probing the
 * Node resolution paths, exactly like `dsh-app-boot`'s `packageDirFromAnchor`
 * (lib/types/profile.js): `createRequire(anchor).resolve.paths(pkg)` yields
 * every node_modules directory Node would search from the anchor file, and
 * the first one holding a `package.json` for `pkg` wins.
 * @param anchor - absolute path of a file whose directory roots the search.
 * @param packageName - the bundle's package name.
 * @returns the package's absolute directory, or undefined.
 */
export function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Resolve a bundle package's directory with the `dsh plugin` CLI's rule
 * (dsh-app-boot `resolveBundleDir`): the installation anchor is tried first,
 * then the profile directory. Unlike the CLI this never throws — the caller
 * maps "cannot resolve" to `meta: null`.
 * @param packageName - the bundle's package name.
 * @param installAnchor - absolute path of a file inside the dsh installation
 *   (its package.json); optional — when undefined only the profile anchor is
 *   probed (a profile's parent node_modules chain includes the flat module
 *   fallback the installation heals, so in-box bundles still resolve).
 * @param profileDir - the profile directory (second anchor).
 * @returns the bundle's absolute directory, or undefined.
 */
export function resolveBundleDir(packageName: string, installAnchor: string | undefined, profileDir: string): string | undefined {
  if (installAnchor !== undefined) {
    const fromInstall = packageDirFromAnchor(installAnchor, packageName)
    if (fromInstall !== undefined) return fromInstall
  }
  return packageDirFromAnchor(join(profileDir, 'package.json'), packageName)
}

/** Read and parse a package.json, tolerating any IO/parse failure. */
export function readPackageJson(dir: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** True when a dependency spec is a local link/file/dev-mode install (update-ineligible). */
export function isLinkedSpec(spec: string | undefined): boolean {
  if (typeof spec !== 'string') return false
  return /^(?:link|file):/i.test(spec) || /^\.{1,2}(?:[/\\]|$)/.test(spec) || /^[A-Za-z]:[\\/]/.test(spec)
}

/** True when a dependency spec points at a git host (github:/git+https/git+ssh). */
export function isGitSpec(spec: string | undefined): boolean {
  if (typeof spec !== 'string') return false
  return /^(?:github|gitlab|bitbucket):/i.test(spec)
    || /^git(?:\+https|\+ssh|):/i.test(spec)
    || /^git@/.test(spec)
    || /\.git(?:#|$)/.test(spec)
}

/**
 * Judge a plugin's install kind from its dependency spec (plan §5.1):
 * registry = semver range, github = github:/git+https spec, link = link:/file:/
 * relative path, in-box = template bundle (no spec; ships with the dsh
 * installation). Anything else is unknown.
 * @param spec - the profile manifest's `dependencies[packageName]` value.
 * @param inBox - true when the package is a template-built-in bundle (present
 *   in the profile's `dsh.profile.bundles` but absent from dependencies).
 * @returns the judged source kind.
 */
export function judgeSourceKind(spec: string | undefined, inBox: boolean): SourceKind {
  if (inBox) return 'in-box'
  if (isLinkedSpec(spec)) return 'link'
  if (isGitSpec(spec)) return 'github'
  if (typeof spec === 'string' && spec.trim().length > 0) return 'registry'
  return 'unknown'
}

/**
 * Normalize a package.json `repository` value to a plain https URL (plan §5.1:
 * "归一化 https URL（去 git+ 前缀）"). Accepts the string form or the npm
 * object form `{ type, url }`. `git+https://…` and `git@…` are rewritten to
 * `https://…`, a trailing `.git` is stripped, and `github:owner/repo` shorthands
 * expand to their https URL. Unparseable values return null.
 * @param value - the raw `repository` field.
 * @returns the normalized URL, or null.
 */
export function normalizeRepository(value: unknown): string | null {
  let raw: unknown = value
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.url === 'string') raw = record.url
    else return null
  }
  if (typeof raw !== 'string') return null
  let url = raw.trim()
  if (url === '') return null
  // git+https://github.com/a/b.git → https://github.com/a/b
  url = url.replace(/^git\+/, '')
  // git@github.com:owner/repo(.git) → https://github.com/owner/repo
  url = url.replace(/^git@([^:]+):/, 'https://$1/')
  // github:owner/repo → https://github.com/owner/repo (spec shorthand)
  url = url.replace(/^github:([^/]+\/[^/]+?)(?:#.*)?$/, 'https://github.com/$1')
  // Strip a single trailing .git (only when the URL still looks like a git repo).
  url = url.replace(/\.git$/, '')
  if (!/^https?:\/\//.test(url)) return null
  return url
}

/** Load the summaries cache file (`~/.dsh/cache/plugin-summaries.json`), tolerating absence/garbage. */
export function readSummariesCache(cachePath: string): Record<string, PluginSummary> {
  try {
    if (!existsSync(cachePath)) return {}
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, PluginSummary> : {}
  } catch {
    return {}
  }
}

/**
 * Build the metadata projection for one bundle package. Never throws: any
 * resolution/read failure returns null (plan §5.1 "失败即 meta: null").
 * @param packageName - the bundle's package name (loader moduleName).
 * @param options - anchors, dependency spec, template-bundle membership, and
 *   the summaries cache (key = `pkg@version`).
 * @returns the PluginMeta, or null when the package directory or manifest is unavailable.
 */
export function buildPluginMeta(packageName: string, options: {
  installAnchor?: string
  profileDir: string
  spec?: string
  inBox: boolean
  summaries: Record<string, PluginSummary>
}): PluginMeta | null {
  const dir = resolveBundleDir(packageName, options.installAnchor, options.profileDir)
  if (dir === undefined) return null
  const manifest = readPackageJson(dir)
  if (manifest === undefined) return null
  const version = typeof manifest.version === 'string' ? manifest.version : null
  const keywords = Array.isArray(manifest.keywords)
    ? manifest.keywords.filter((value): value is string => typeof value === 'string')
    : []
  return {
    packageName,
    version,
    description: typeof manifest.description === 'string' ? manifest.description : null,
    keywords,
    repository: normalizeRepository(manifest.repository) ?? normalizeRepository(options.spec),
    homepage: typeof manifest.homepage === 'string' ? manifest.homepage : null,
    license: typeof manifest.license === 'string' ? manifest.license : null,
    sourceKind: judgeSourceKind(options.spec, options.inBox),
    summary: version !== null ? options.summaries[`${packageName}@${version}`] ?? null : null,
  }
}
