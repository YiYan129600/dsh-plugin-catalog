import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// Tested code comes from the BUILD OUTPUT (lib/), per the project's test
// route (BLOCKED.md): pure ESM, no TS syntax, vite never feeds it to esbuild.
import {
  SummaryService,
  buildSummaryPrompt,
  estimateTokens,
  fetchReadme,
  generateSummaryFromReadme,
  parseGitHubRepo,
  parseSummaryResponse,
  readmeCandidateUrls,
  truncateReadme,
  writeSummaryCache,
} from '../lib/index.js'

const root = process.cwd()
/** Temp cache dir INSIDE the repo (sandbox: no writes outside the workspace). */
const tmpCacheDir = resolve(root, 'tests/fixtures/.tmp-summary-cache')
mkdirSync(tmpCacheDir, { recursive: true })

afterAll(() => {
  rmSync(tmpCacheDir, { recursive: true, force: true })
})

/** A JSON/text response double for the injected fetch. */
function response(body, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }
}

const REPO = 'https://github.com/vlln/whale-girl'

describe('README fetching (plan §5.5: raw HEAD → main/master → api fallback)', () => {
  it('tries raw.githubusercontent HEAD/README.md first', async () => {
    const calls = []
    const text = await fetchReadme(REPO, async (url) => {
      calls.push(url)
      return response('# Whale Girl\nA desktop pet.', true)
    })
    expect(text).toBe('# Whale Girl\nA desktop pet.')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe('https://raw.githubusercontent.com/vlln/whale-girl/HEAD/README.md')
  })

  it('falls back to main then master when HEAD 404s', async () => {
    const calls = []
    const text = await fetchReadme(REPO, async (url) => {
      calls.push(url)
      return url.includes('/HEAD/') ? response('', false) : response('# From main', true)
    })
    expect(text).toBe('# From main')
    expect(calls[0]).toContain('/HEAD/README.md')
    expect(calls[1]).toContain('/main/README.md')
  })

  it('decodes the base64 api.github.com readme fallback as a last resort', async () => {
    const payload = Buffer.from('# API fallback').toString('base64')
    const text = await fetchReadme(REPO, async (url) => {
      if (url.startsWith('https://raw.githubusercontent.com')) return response('', false)
      return response({ content: payload }, true)
    })
    expect(text).toBe('# API fallback')
  })

  it('returns null when every candidate fails', async () => {
    const text = await fetchReadme(REPO, async () => { throw new Error('offline') })
    expect(text).toBeNull()
  })

  it('returns null for a non-GitHub repository', async () => {
    const calls = []
    const text = await fetchReadme('https://example.com/x/y', async (url) => { calls.push(url); return response('x') })
    expect(text).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('repository parsing', () => {
  it('parses owner/repo from https GitHub URLs', () => {
    expect(parseGitHubRepo(REPO)).toEqual({ owner: 'vlln', repo: 'whale-girl' })
    expect(parseGitHubRepo('https://github.com/vlln/whale-girl.git')).toEqual({ owner: 'vlln', repo: 'whale-girl' })
    expect(parseGitHubRepo('git+https://github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' })
    expect(parseGitHubRepo('https://gitlab.com/a/b')).toBeNull()
  })

  it('builds candidate URLs in the raw-first order', () => {
    const urls = readmeCandidateUrls(REPO)
    expect(urls[0]).toBe('https://raw.githubusercontent.com/vlln/whale-girl/HEAD/README.md')
    expect(urls[urls.length - 1]).toBe('https://api.github.com/repos/vlln/whale-girl/readme')
  })
})

describe('token control (plan §5.5: 截断 + 成本预估)', () => {
  it('truncates a long README to ~6k chars with a truncation marker', () => {
    const long = 'x'.repeat(10_000)
    const truncated = truncateReadme(long)
    expect(truncated.length).toBeLessThanOrEqual(6000 + '…(截断)'.length)
    expect(truncated.endsWith('…(截断)')).toBe(true)
    const short = 'tiny'
    expect(truncateReadme(short)).toBe(short)
  })

  it('estimates input tokens: CJK ≈ 1/char, ASCII ≈ 1/4 chars', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('SSH 远程运维远程执行命令')).toBeGreaterThan(10)
    expect(estimateTokens('')).toBe(1)
  })

  it('the prompt demands strict JSON with bounded fields', () => {
    const prompt = buildSummaryPrompt('# readme')
    expect(prompt).toContain('name_zh')
    expect(prompt).toContain('desc_zh')
    expect(prompt).toContain('严格 JSON')
    expect(prompt).toContain('# readme')
  })
})

describe('model response validation (plan §5.5)', () => {
  it('parses a strict JSON response', () => {
    expect(parseSummaryResponse('{"name_zh": "鲸鱼女孩", "desc_zh": "桌面宠物摆件"}')).toEqual({ nameZh: '鲸鱼女孩', descZh: '桌面宠物摆件' })
  })

  it('parses a JSON response fenced in markdown code blocks', () => {
    const fenced = '```json\n{"name_zh": "鲸鱼女孩", "desc_zh": "桌面宠物摆件"}\n```'
    expect(parseSummaryResponse(fenced)).toEqual({ nameZh: '鲸鱼女孩', descZh: '桌面宠物摆件' })
  })

  it('rejects garbage and non-JSON', () => {
    expect(parseSummaryResponse('no json here')).toBeNull()
    expect(parseSummaryResponse('{"name_zh": "只有名字"}')).toBeNull()
  })

  it('enforces the length bounds (name_zh ≤12 字, desc_zh ≤40 字)', () => {
    const tooLongName = { name_zh: '一二三四五六七八九十一二三四', desc_zh: 'ok' }
    expect(parseSummaryResponse(JSON.stringify(tooLongName))).toBeNull()
    const tooLongDesc = { name_zh: '名字', desc_zh: '长'.repeat(41) }
    expect(parseSummaryResponse(JSON.stringify(tooLongDesc))).toBeNull()
  })
})

describe('generation pipeline (plan §5.5: 调模型 → 校验 → 缓存 key=pkg@version)', () => {
  const cachePath = resolve(tmpCacheDir, 'summaries.json')

  it('writes the AI summary to the cache keyed pkg@version', async () => {
    rmSync(cachePath, { force: true })
    const chatCalls = []
    const result = await generateSummaryFromReadme({
      repository: REPO,
      readme: '# Whale Girl\nA desktop pet.',
      api: { baseURL: 'https://api.deepseek.com', apiKey: 'sk-test', model: 'deepseek-v4-flash' },
      fetchImpl: async (url) => {
        if (url.includes('/chat/completions')) {
          chatCalls.push(url)
          return response({ choices: [{ message: { content: '{"name_zh": "鲸鱼女孩", "desc_zh": "桌面宠物摆件"}' } }] })
        }
        return response('')
      },
      packageName: 'whale-girl',
      version: '1.2.3',
      cachePath,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.nameZh).toBe('鲸鱼女孩')
      expect(result.summary.descZh).toBe('桌面宠物摆件')
      expect(result.summary.source).toBe('ai')
      expect(result.summary.model).toBe('deepseek-v4-flash')
      expect(result.estimatedTokens).toBeGreaterThan(0)
    }
    expect(chatCalls).toHaveLength(1)
    expect(chatCalls[0]).toBe('https://api.deepseek.com/chat/completions')
    // cache written at the injected path, key = pkg@version
    expect(existsSync(cachePath)).toBe(true)
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(cache['whale-girl@1.2.3'].nameZh).toBe('鲸鱼女孩')
  })

  it('does not write the cache when the version is unknown', async () => {
    rmSync(cachePath, { force: true })
    const result = await generateSummaryFromReadme({
      repository: REPO,
      readme: 'readme',
      api: { baseURL: 'https://api.deepseek.com', apiKey: 'k', model: 'm' },
      fetchImpl: async () => response({ choices: [{ message: { content: '{"name_zh": "x", "desc_zh": "y"}' } }] }),
      packageName: 'pkg',
      version: null,
      cachePath,
    })
    expect(result.ok).toBe(true)
    expect(existsSync(cachePath)).toBe(false)
  })

  it('maps a model-call failure to model-error', async () => {
    const result = await generateSummaryFromReadme({
      repository: REPO,
      readme: 'readme',
      api: { baseURL: 'https://api.deepseek.com', apiKey: 'k', model: 'm' },
      fetchImpl: async () => { throw new Error('offline') },
      packageName: 'pkg',
      version: '1.0.0',
      cachePath,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('model-error')
  })

  it('maps an unparseable model response to invalid-response', async () => {
    const result = await generateSummaryFromReadme({
      repository: REPO,
      readme: 'readme',
      api: { baseURL: 'https://api.deepseek.com', apiKey: 'k', model: 'm' },
      fetchImpl: async () => response({ choices: [{ message: { content: 'sorry, no json' } }] }),
      packageName: 'pkg',
      version: '1.0.0',
      cachePath,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('invalid-response')
  })

  it('writeSummaryCache appends without clobbering existing keys', () => {
    rmSync(cachePath, { force: true })
    writeSummaryCache(cachePath, 'a@1', { nameZh: '甲', descZh: '一', source: 'ai', generatedAt: 'now' })
    writeSummaryCache(cachePath, 'b@1', { nameZh: '乙', descZh: '二', source: 'manual', generatedAt: 'now' })
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(cache['a@1'].nameZh).toBe('甲')
    expect(cache['b@1'].nameZh).toBe('乙')
  })
})

describe('SummaryService (plan §5.5: 手动触发 + 无 API 降级)', () => {
  it('estimate returns the token cost without calling the model', async () => {
    const service = new SummaryService({
      fetchImpl: async () => response('# readme\n'.repeat(200)),
      apiConfig: () => null,
      cachePath: resolve(tmpCacheDir, 'estimate.json'),
    })
    const estimate = await service.estimate(REPO)
    expect(estimate.ok !== false && 'estimatedTokens' in estimate).toBe(true)
    if ('estimatedTokens' in estimate) expect(estimate.estimatedTokens).toBeGreaterThan(0)
  })

  it('estimate without a repository → no-repository', async () => {
    const service = new SummaryService({ fetchImpl: async () => response('x') })
    const estimate = await service.estimate(null)
    expect(estimate).toEqual({ ok: false, code: 'no-repository', message: expect.any(String) })
  })

  it('generate without API config → no-api-config (UI shows "去设置配模型")', async () => {
    const service = new SummaryService({
      fetchImpl: async () => response('# readme'),
      apiConfig: () => null,
      cachePath: resolve(tmpCacheDir, 'noapi.json'),
    })
    const result = await service.generate({ packageName: 'whale-girl', repository: REPO, version: '1.2.3' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('no-api-config')
  })

  it('generate with an unreadable README → readme-unavailable', async () => {
    const service = new SummaryService({
      fetchImpl: async () => { throw new Error('offline') },
      apiConfig: () => ({ baseURL: 'https://api.deepseek.com', apiKey: 'k', model: 'm' }),
      cachePath: resolve(tmpCacheDir, 'unreadable.json'),
    })
    const result = await service.generate({ packageName: 'whale-girl', repository: REPO, version: '1.2.3' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('readme-unavailable')
  })

  it('generate end-to-end writes the pkg@version cache key', async () => {
    const cachePath = resolve(tmpCacheDir, 'service-e2e.json')
    rmSync(cachePath, { force: true })
    const service = new SummaryService({
      fetchImpl: async (url) => {
        if (url.includes('/chat/completions')) {
          return response({ choices: [{ message: { content: '{"name_zh": "鲸鱼女孩", "desc_zh": "桌面宠物摆件"}' } }] })
        }
        return response('# Whale Girl readme')
      },
      apiConfig: () => ({ baseURL: 'https://api.deepseek.com', apiKey: 'sk-test', model: 'deepseek-v4-flash' }),
      cachePath,
    })
    const result = await service.generate({ packageName: 'whale-girl', repository: REPO, version: '1.2.3' })
    expect(result.ok).toBe(true)
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(cache['whale-girl@1.2.3'].source).toBe('ai')
  })
})
