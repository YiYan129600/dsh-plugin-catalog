/**
 * dsh-plugin-catalog — `dsh.plugin` metadata convention: hand-written,
 * dependency-free validator + the exportable snippet builder (plan §5.4 /
 * v0.2.0 task 2).
 *
 * The convention (see docs/dsh-plugin-convention.md) lets a plugin author
 * declare Chinese-first metadata in package.json:
 *
 *   { "dsh": { "plugin": {
 *       "displayName": { "zh": "SSH 远程运维", "en": "SSH Remote Ops" },
 *       "description": { "zh": "…", "en": "…" },
 *       "categories": ["remote", "ops"],
 *       "aliases": ["ssh", "远程", "服务器"]
 *   } } }
 *
 * Every field is optional; missing fields fall back to the package.json
 * top-level fields (name → displayName.en, description → description.en).
 *
 * Pure, dependency-free module shared by BOTH halves (and the vitest suite),
 * exactly like `src/search.ts` / `src/localize.ts` / `src/pinyin.ts` /
 * `src/categories.ts`. It performs no I/O and touches no DOM.
 */

import { classifyEntry } from './categories.ts'
import { NO_ZH_DESC, zhDescFor, zhNameFor } from './localize.ts'
import { aliasesFor, moduleShortName, type BuiltinAliasEntry, type CatalogEntryLike } from './search.ts'

/** The validated / exported `dsh.plugin` manifest (all fields optional). */
export interface DshPluginManifest {
  displayName?: { zh?: string; en?: string }
  description?: { zh?: string; en?: string }
  categories?: string[]
  aliases?: string[]
}

/** Validator outcome: normalized value on success, field-level errors otherwise. */
export type ManifestValidationResult =
  | { ok: true; value: DshPluginManifest }
  | { ok: false; errors: string[] }

/** Optional top-level fallbacks a package.json provides (name / description). */
export interface ManifestFallback {
  name?: unknown
  description?: unknown
}

/** True when `value` is a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Collect one error; helper keeps the messages uniform. */
function pushError(errors: string[], path: string, why: string): void {
  errors.push(`${path}: ${why}`)
}

/** Validate one optional `{ zh?, en? }` bilingual object at `path`. */
function validateBilingual(
  raw: unknown,
  path: string,
  errors: string[],
  out: { zh?: string; en?: string },
): void {
  if (raw === undefined) return
  if (!isPlainObject(raw)) {
    pushError(errors, path, '必须是对象 { zh?, en? }')
    return
  }
  for (const key of ['zh', 'en'] as const) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim() === '') {
      pushError(errors, `${path}.${key}`, '必须是非空字符串')
    } else {
      out[key] = value
    }
  }
}

/** Validate one optional string array at `path`. */
function validateStringArray(raw: unknown, path: string, errors: string[], out: string[]): void {
  if (raw === undefined) return
  if (!Array.isArray(raw)) {
    pushError(errors, path, '必须是字符串数组')
    return
  }
  raw.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      pushError(errors, `${path}[${index}]`, '必须是非空字符串')
    } else {
      out.push(item)
    }
  })
}

/**
 * Validate an unknown value (already parsed from JSON) as a `dsh.plugin`
 * manifest. Missing bilingual fields fall back to the package.json top-level
 * fields (fallback.name → displayName.en, fallback.description →
 * description.en), per the convention. Unknown extra keys are tolerated —
 * the convention is additive.
 */
export function validateDshPluginManifest(raw: unknown, fallback: ManifestFallback = {}): ManifestValidationResult {
  const errors: string[] = []
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [`dsh.plugin 必须是对象，实际为 ${raw === null ? 'null' : Array.isArray(raw) ? '数组' : typeof raw}`] }
  }
  const value: DshPluginManifest = {}

  // displayName (optional bilingual object).
  const displayName: { zh?: string; en?: string } = {}
  validateBilingual(raw.displayName, 'displayName', errors, displayName)
  if (displayName.en === undefined && typeof fallback.name === 'string' && fallback.name.trim() !== '') {
    displayName.en = fallback.name
  }
  if (displayName.zh !== undefined || displayName.en !== undefined) value.displayName = displayName

  // description (optional bilingual object).
  const description: { zh?: string; en?: string } = {}
  validateBilingual(raw.description, 'description', errors, description)
  if (description.en === undefined && typeof fallback.description === 'string' && fallback.description.trim() !== '') {
    description.en = fallback.description
  }
  if (description.zh !== undefined || description.en !== undefined) value.description = description

  // categories / aliases (optional string arrays).
  const categories: string[] = []
  validateStringArray(raw.categories, 'categories', errors, categories)
  if (categories.length > 0) value.categories = categories
  const aliases: string[] = []
  validateStringArray(raw.aliases, 'aliases', errors, aliases)
  if (aliases.length > 0) value.aliases = aliases

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value }
}

/**
 * Validate a whole package.json-shaped object: reads `dsh.plugin` and falls
 * back to the top-level `name` / `description`.
 */
export function validateDshPluginField(pkg: unknown): ManifestValidationResult {
  if (!isPlainObject(pkg)) {
    return { ok: false, errors: ['package.json 必须是对象'] }
  }
  const dsh = pkg.dsh
  const plugin = isPlainObject(dsh) ? (dsh as Record<string, unknown>).plugin : undefined
  return validateDshPluginManifest(plugin, { name: pkg.name, description: pkg.description })
}

/**
 * Build the exportable `dsh.plugin` JSON snippet for one catalog entry,
 * 取自 meta + summary (+ the built-in zh table): zh display name/description
 * from the built-in table (zero cost) or the AI summary, en from the short
 * name / raw description, categories from the static classifier, aliases
 * from the alias table. All optional per the convention.
 */
export function buildPluginManifestSnippet(
  entry: CatalogEntryLike,
  aliasTable?: readonly BuiltinAliasEntry[],
): DshPluginManifest {
  const meta = entry.meta ?? {}
  const summary = meta.summary ?? {}
  const nameZh = zhNameFor(entry.moduleName, summary)
  const descZhRaw = zhDescFor(entry.moduleName, summary)
  // The 「暂无中文简介」 placeholder is UI copy, not a manifest value.
  const descZh = descZhRaw === NO_ZH_DESC ? '' : descZhRaw
  const enName = moduleShortName(entry.moduleName) || entry.moduleName
  const enDesc = meta.description ?? ''

  const manifest: DshPluginManifest = {}
  if (nameZh !== '' || enName !== '') {
    manifest.displayName = { ...(nameZh !== '' ? { zh: nameZh } : {}), en: enName }
  }
  if (descZh !== '' || enDesc !== '') {
    manifest.description = { ...(descZh !== '' ? { zh: descZh } : {}), en: enDesc }
  }
  const categories = classifyEntry(entry, aliasTable)
  if (categories.length > 0) manifest.categories = categories
  const aliases = aliasesFor(entry.moduleName, aliasTable)
  if (aliases.length > 0) manifest.aliases = aliases
  return manifest
}

/** JSON.stringify the snippet for the copy-to-clipboard 导出 flow. */
export function stringifyPluginManifest(manifest: DshPluginManifest): string {
  return JSON.stringify(manifest, null, 2)
}
