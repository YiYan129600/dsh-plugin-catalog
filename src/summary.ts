/**
 * dsh-plugin-catalog — AI Chinese summary generation (plan §5.5).
 *
 * SummaryService turns a third-party plugin's GitHub README into a
 * { nameZh ≤12字, descZh ≤40字 } summary using the user's OWN configured
 * model API (D7: baseURL/apiKey/model all reused from DSH settings), caches
 * the result at `~/.dsh/cache/plugin-summaries.json` keyed `pkg@version`
 * (a version change invalidates the cache automatically), and reports an
 * input-token estimate BEFORE the model call so the UI can show the cost
 * (plan §5.5: 手动触发 + 成本预估; the generate button only appears for
 * third-party packages — in-box ones use the built-in table, D8).
 *
 * Flow (plan §5.5): meta.repository → parse owner/repo →
 * raw.githubusercontent.com/<o>/<r>/HEAD/README.md (HEAD follows the default
 * branch) → fall back to main/master → last resort
 * api.github.com/repos/<o>/<r>/readme (raw media type) → truncate to ~6k
 * chars → estimate input tokens → OpenAI-compatible /chat/completions with a
 * strict-JSON prompt → validate → write cache.
 *
 * Everything is seam-injected (fetch, api-config provider, cache path, clock)
 * so the whole surface is unit-testable without disk/network/API access.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FetchImpl } from './update.ts'
import type { PluginSummary } from './meta.ts'

/** The model-API configuration DSH already has (D7: reuse baseURL/apiKey/model). */
export interface ApiConfig {
  baseURL: string
  apiKey: string
  model: string
}

/** How long the README is truncated to before the model call (plan §5.5 ~6k chars). */
export const README_MAX_CHARS = 6_000

/** The chat-completions path appended to baseURL (OpenAI-compatible). */
const CHAT_PATH = '/chat/completions'

/** raw.githubusercontent.com base (no auth, no rate limit — plan §5.5). */
const RAW_GITHUB = 'https://raw.githubusercontent.com'

/** api.github.com base (rate-limited to 60/h — only the last-resort fallback). */
const GITHUB_API = 'https://api.github.com'

/**
 * Parse `owner/repo` from a normalized https GitHub repository URL.
 * Mirrors `parseGitHubRepository` in src/update.ts (kept separate so the
 * summary module has no dependency on the update module).
 */
export function parseGitHubRepo(repository: string): { owner: string; repo: string } | null {
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

/**
 * The raw README candidate URLs, in probe order (plan §5.5): HEAD first
 * (follows the default branch), then explicit main/master, then the
 * lowercase `readme.md` variant (GitHub paths are case-sensitive), and the
 * rate-limited API fallback with the raw media type last.
 */
export function readmeCandidateUrls(repository: string): string[] {
  const repo = parseGitHubRepo(repository)
  if (repo === null) return []
  const { owner, repo: name } = repo
  const raw = (branch: string, file: string): string => `${RAW_GITHUB}/${owner}/${name}/${branch}/${file}`
  return [
    raw('HEAD', 'README.md'),
    raw('main', 'README.md'),
    raw('master', 'README.md'),
    raw('HEAD', 'readme.md'),
    `${GITHUB_API}/repos/${owner}/${name}/readme`,
  ]
}

/**
 * Fetch the README text for a repository by trying the candidate URLs in
 * order; the first 2xx raw body wins. `api.github.com/…/readme` returns the
 * base64-encoded `content` — decoded here. Any total failure → null.
 * @param repository - the normalized https GitHub URL.
 * @param fetchImpl - injected fetch.
 * @param timeoutMs - per-URL probe timeout.
 */
export async function fetchReadme(repository: string, fetchImpl: FetchImpl, timeoutMs = 10_000): Promise<string | null> {
  for (const url of readmeCandidateUrls(repository)) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(url, { signal: controller.signal })
        if (!response.ok) continue
        const text = await response.text()
        if (url.startsWith(GITHUB_API)) {
          // api.github.com/…/readme → { content: <base64> } (raw media type
          // via Accept would avoid this; decoded here to be safe either way).
          try {
            const body = JSON.parse(text) as { content?: unknown }
            if (typeof body.content === 'string') return Buffer.from(body.content, 'base64').toString('utf8')
          } catch {
            return text
          }
        }
        return text
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // try the next candidate
    }
  }
  return null
}

/** Truncate a README to ~README_MAX_CHARS (plan §5.5: 截断至 ~6k 字符控制 token). */
export function truncateReadme(text: string, maxChars = README_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  // No newline before the marker: the bounded length contract is
  // `maxChars + '…(截断)'.length` (the tests pin this exact bound).
  return `${text.slice(0, maxChars)}…(截断)`
}

/**
 * Rough input-token estimate for the cost display (plan §5.5 成本预估).
 * Heuristic: CJK characters ≈ 1 token each, ASCII ≈ 1 token per 4 chars
 * (typical for zh-heavy prompts; over-estimates slightly on purpose).
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let ascii = 0
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)) cjk += 1
    else if (char !== '\n' && char !== '\r') ascii += 1
  }
  return Math.max(1, Math.ceil(ascii / 4) + cjk)
}

/**
 * The model prompt: strict JSON only, bounded fields (plan §5.5:
 * { name_zh: ≤12 字, desc_zh: ≤40 字 }).
 */
export function buildSummaryPrompt(readme: string): string {
  return [
    '你是 DSH 插件清单的中文本地化编辑。根据下面的插件 README，提炼：',
    '1. name_zh：≤12 个汉字的中文概括名（一眼看懂这是什么，如「SSH 远程运维」）；',
    '2. desc_zh：≤40 个汉字的一句话中文描述（说明核心功能）。',
    '只输出一个严格 JSON 对象，不要任何其他文字、不要 markdown 代码围栏：',
    '{"name_zh": "…", "desc_zh": "…"}',
    '',
    '--- README 开始 ---',
    readme,
    '--- README 结束 ---',
  ].join('\n')
}

/**
 * Validate + parse the model's response into a summary. Accepts a strict JSON
 * object or a JSON object fenced in markdown code blocks (models often add
 * fences); enforces the length bounds; anything else → null.
 */
export function parseSummaryResponse(raw: string): { nameZh: string; descZh: string } | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced !== null ? fenced[1] : raw
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate.trim())
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const nameZh = typeof record.name_zh === 'string' ? record.name_zh.trim() : ''
  const descZh = typeof record.desc_zh === 'string' ? record.desc_zh.trim() : ''
  if (nameZh === '' || descZh === '') return null
  if ([...nameZh].length > 12) return null
  if ([...descZh].length > 40) return null
  return { nameZh, descZh }
}

/** Call the OpenAI-compatible chat-completions endpoint with the user's config. */
export async function callChatCompletions(api: ApiConfig, prompt: string, fetchImpl: FetchImpl, timeoutMs = 60_000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const url = api.baseURL.replace(/\/+$/, '') + CHAT_PATH
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${api.apiKey}`,
        },
        signal: controller.signal,
      })
      if (!response.ok) return null
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
      const content = body.choices?.[0]?.message?.content
      return typeof content === 'string' ? content : null
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/** Read the summaries cache file, tolerating absence/garbage (shared with meta.ts semantics). */
export function readSummariesCacheFile(cachePath: string): Record<string, PluginSummary> {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, PluginSummary> : {}
  } catch {
    return {}
  }
}

/** Write one summary into the cache file (key = `pkg@version`), never throwing. */
export function writeSummaryCache(cachePath: string, key: string, summary: PluginSummary): void {
  const cache = readSummariesCacheFile(cachePath)
  cache[key] = summary
  const tempPath = `${cachePath}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(cache, null, 2), 'utf8')
    renameSync(tempPath, cachePath)
  } catch {
    // never throw from a cache write
  }
}

// ---------------------------------------------------------------------------
// the generation pipeline + service
// ---------------------------------------------------------------------------

/** Error codes the generation pipeline can return (UI maps each to a message). */
export type SummaryErrorCode = 'no-repository' | 'no-api-config' | 'readme-unavailable' | 'model-error' | 'invalid-response'

/** One generation attempt's outcome. */
export type GenerateSummaryResult =
  | { ok: true; summary: PluginSummary; estimatedTokens: number; readmeChars: number }
  | { ok: false; code: SummaryErrorCode; message: string }

/** Estimate-only outcome (shown BEFORE triggering, plan §5.5 成本预估). */
export interface EstimateResult {
  estimatedTokens: number
  readmeChars: number
  repository: string | null
}

/** How the host resolves the user's configured model API (D7). */
export type ApiConfigProvider = () => ApiConfig | null

/**
 * Default API-config provider: reads the DSH host process environment (the
 * same credentials the running dsh uses — `DEEPSEEK_API_KEY` is present in
 * the host env, see ~/.dsh/.credentials.yaml). Overridable with
 * DSH_API_BASE / DSH_API_KEY / DSH_API_MODEL. Returns null (→ the UI shows
 * "去设置配模型") when no key is configured.
 */
export function envApiConfigProvider(env: Record<string, string | undefined> = process.env): ApiConfig | null {
  const apiKey = env.DSH_API_KEY ?? env.DEEPSEEK_API_KEY
  if (apiKey === undefined || apiKey === '') return null
  const baseURL = env.DSH_API_BASE ?? env.DEEPSEEK_API_BASE ?? 'https://api.deepseek.com'
  const model = env.DSH_API_MODEL ?? env.DEEPSEEK_MODEL ?? 'deepseek-chat'
  return { baseURL, apiKey, model }
}

/** Constructor options for SummaryService (all injectable). */
export interface SummaryServiceOptions {
  /** Summaries cache path; defaults to `$DSH_HOME/cache/plugin-summaries.json`. */
  cachePath?: string
  fetchImpl?: FetchImpl
  apiConfig?: ApiConfigProvider
  now?: () => number
}

/** Default cache path: `$DSH_HOME/cache/plugin-summaries.json`. */
export function defaultSummariesCachePath(dshHome: string): string {
  return join(dshHome, 'cache', 'plugin-summaries.json')
}

/**
 * Pure generation pipeline (exported for tests): repository URL + README text
 * in, validated summary out.
 */
export async function generateSummaryFromReadme(deps: {
  repository: string
  readme: string
  api: ApiConfig
  fetchImpl: FetchImpl
  packageName: string
  version: string | null
  cachePath: string
  now?: () => number
}): Promise<GenerateSummaryResult> {
  const truncated = truncateReadme(deps.readme)
  const estimatedTokens = estimateTokens(truncated)
  const prompt = buildSummaryPrompt(truncated)
  const raw = await callChatCompletions(deps.api, prompt, deps.fetchImpl)
  if (raw === null) {
    return { ok: false, code: 'model-error', message: '模型调用失败（网络或 API 错误）' }
  }
  const parsed = parseSummaryResponse(raw)
  if (parsed === null) {
    return { ok: false, code: 'invalid-response', message: '模型返回无法解析，请重试或手动填写' }
  }
  const now = deps.now?.() ?? Date.now()
  const summary: PluginSummary = {
    nameZh: parsed.nameZh,
    descZh: parsed.descZh,
    source: 'ai',
    model: deps.api.model,
    generatedAt: new Date(now).toISOString(),
  }
  if (deps.version !== null) writeSummaryCache(deps.cachePath, `${deps.packageName}@${deps.version}`, summary)
  return { ok: true, summary, estimatedTokens, readmeChars: deps.readme.length }
}

/**
 * The summary host service. The host routes wrap `estimate()` (cost display
 * before triggering) and `generate()` (the actual model call + cache write).
 */
export class SummaryService {
  private options: SummaryServiceOptions

  constructor(options: SummaryServiceOptions = {}) {
    this.options = options
  }

  private fetchImpl(): FetchImpl {
    return this.options.fetchImpl ?? ((url: string) => fetch(url))
  }

  private cachePath(): string {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    return this.options.cachePath ?? defaultSummariesCachePath(home)
  }

  private apiConfig(): ApiConfig | null {
    const provider = this.options.apiConfig
    return provider === undefined ? envApiConfigProvider() : provider()
  }

  /**
   * Cost estimate WITHOUT calling the model: resolve the repository and fetch
   * the README (the only network cost — the estimate itself is free).
   * @param repository - the plugin's normalized GitHub URL.
   */
  async estimate(repository: string | null): Promise<EstimateResult | { ok: false; code: SummaryErrorCode; message: string }> {
    if (repository === null) return { ok: false, code: 'no-repository', message: '该插件没有仓库地址，无法抓取 README' }
    const readme = await fetchReadme(repository, this.fetchImpl())
    if (readme === null) return { ok: false, code: 'readme-unavailable', message: '无法读取 README（仓库可能不存在或网络不可达）' }
    const truncated = truncateReadme(readme)
    return { estimatedTokens: estimateTokens(truncated), readmeChars: readme.length, repository }
  }

  /** Generate (or regenerate) the AI summary for one package. */
  async generate(deps: {
    packageName: string
    repository: string | null
    version: string | null
  }): Promise<GenerateSummaryResult> {
    if (deps.repository === null) return { ok: false, code: 'no-repository', message: '该插件没有仓库地址，无法抓取 README' }
    const api = this.apiConfig()
    if (api === null) return { ok: false, code: 'no-api-config', message: '未配置模型 API，请先在 DSH 设置中配置模型' }
    const readme = await fetchReadme(deps.repository, this.fetchImpl())
    if (readme === null) return { ok: false, code: 'readme-unavailable', message: '无法读取 README（仓库可能不存在或网络不可达）' }
    return generateSummaryFromReadme({
      repository: deps.repository,
      readme,
      api,
      fetchImpl: this.fetchImpl(),
      packageName: deps.packageName,
      version: deps.version,
      cachePath: this.cachePath(),
      now: this.options.now,
    })
  }
}
