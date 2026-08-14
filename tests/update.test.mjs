import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// Tested code comes from the BUILD OUTPUT (lib/), per the project's test
// route (BLOCKED.md): pure ESM, no TS syntax, vite never feeds it to esbuild.
import {
  UpdateCheckService,
  buildUpdateCommand,
  checkOnePackage,
  compareVersions,
  fetchGithubLatest,
  fetchNpmLatest,
  parseGitHubRepository,
  probeIsFresh,
  statusFromLatest,
} from '../lib/index.js'

const root = process.cwd()
/** Temp cache dir INSIDE the repo (sandbox: no writes outside the workspace). */
const tmpCacheDir = resolve(root, 'tests/fixtures/.tmp-updates-cache')
mkdirSync(tmpCacheDir, { recursive: true })

afterAll(() => {
  rmSync(tmpCacheDir, { recursive: true, force: true })
})

/** A JSON response double for the injected fetch. */
function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => body, text: async () => JSON.stringify(body) }
}

/** A fetch double that records every call and routes npm/GitHub URLs. */
function makeFetch(handlers) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    for (const [prefix, handler] of handlers) {
      if (url.startsWith(prefix)) return typeof handler === 'function' ? handler(url) : handler
    }
    return jsonResponse({}, false)
  }
  return { fetchImpl, calls }
}

/** A fixed "now" seam (2026-02-23T00:00:00Z). */
const NOW = Date.parse('2026-02-23T00:00:00.000Z')

describe('semver comparison with prereleases (task 4, copied from remote-web-ui/update.js)', () => {
  it('a release outranks any of its prereleases', () => {
    expect(compareVersions('0.2.0', '0.2.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
  })

  it('orders prerelease identifiers per semver precedence', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0)
    // numeric identifiers sort below alphanumeric ones
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
    // build metadata is ignored, leading v tolerated
    expect(compareVersions('v0.1.12+sha', '0.1.12')).toBe(0)
  })

  it('a newer minor/patch beats an older one (update detection core)', () => {
    expect(compareVersions('0.2.0', '0.1.12')).toBeGreaterThan(0)
    expect(compareVersions('0.1.12', '0.2.0')).toBeLessThan(0)
  })

  it('unparseable versions sort below parseable ones', () => {
    expect(compareVersions('garbage', '0.1.0')).toBeLessThan(0)
  })
})

describe('per-package update checks (plan §5.6)', () => {
  it('link sourceKind is never probed (status local-link)', async () => {
    const { fetchImpl, calls } = makeFetch([])
    const entry = await checkOnePackage({
      packageName: 'dsh-openpencil',
      sourceKind: 'link',
      currentVersion: '0.1.0',
      repository: null,
      fetchImpl,
    })
    expect(entry.status).toBe('local-link')
    expect(entry.source).toBe('link')
    expect(entry.latestVersion).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('probes npm first and reports source npm on success', async () => {
    const { fetchImpl, calls } = makeFetch([
      ['https://registry.npmjs.org/dsh-ssh', jsonResponse({ version: '0.12.0' })],
    ])
    const entry = await checkOnePackage({
      packageName: 'dsh-ssh',
      sourceKind: 'registry',
      currentVersion: '0.11.0',
      repository: 'https://github.com/linxin666/dsh-ssh',
      fetchImpl,
    })
    expect(entry.status).toBe('update-available')
    expect(entry.source).toBe('npm')
    expect(entry.latestVersion).toBe('0.12.0')
    expect(calls).toHaveLength(1)
  })

  it('falls back to GitHub releases when npm fails (github sourceKind)', async () => {
    const { fetchImpl, calls } = makeFetch([
      ['https://registry.npmjs.org/whale-girl', jsonResponse({}, false)],
      ['https://api.github.com/repos/vlln/whale-girl/releases/latest', jsonResponse({ tag_name: 'v1.3.0' })],
    ])
    const entry = await checkOnePackage({
      packageName: 'whale-girl',
      sourceKind: 'github',
      currentVersion: '1.2.3',
      repository: 'https://github.com/vlln/whale-girl',
      fetchImpl,
    })
    expect(entry.status).toBe('update-available')
    expect(entry.source).toBe('github')
    expect(entry.latestVersion).toBe('1.3.0')
    expect(calls).toHaveLength(2)
  })

  it('falls back to GitHub tags when the repo has no releases', async () => {
    const { fetchImpl } = makeFetch([
      ['https://registry.npmjs.org/whale-girl', jsonResponse({}, false)],
      ['https://api.github.com/repos/vlln/whale-girl/releases/latest', jsonResponse({}, false)],
      ['https://api.github.com/repos/vlln/whale-girl/tags', jsonResponse([{ name: 'v1.4.0' }])],
    ])
    const entry = await checkOnePackage({
      packageName: 'whale-girl',
      sourceKind: 'github',
      currentVersion: '1.2.3',
      repository: 'https://github.com/vlln/whale-girl',
      fetchImpl,
    })
    expect(entry.status).toBe('update-available')
    expect(entry.source).toBe('github')
    expect(entry.latestVersion).toBe('1.4.0')
  })

  it('reports up-to-date only when a probe actually succeeded and versions match', async () => {
    const { fetchImpl } = makeFetch([
      ['https://registry.npmjs.org/dsh-ssh', jsonResponse({ version: '0.11.0' })],
    ])
    const entry = await checkOnePackage({
      packageName: 'dsh-ssh',
      sourceKind: 'registry',
      currentVersion: '0.11.0',
      repository: null,
      fetchImpl,
    })
    expect(entry.status).toBe('up-to-date')
    expect(entry.latestVersion).toBe('0.11.0')
  })

  it('ALL probes failing = cannot-check, NEVER a wrong up-to-date', async () => {
    const { fetchImpl, calls } = makeFetch([
      ['https://registry.npmjs.org/dsh-ssh', jsonResponse({}, false)],
      ['https://api.github.com/repos/linxin666/dsh-ssh', jsonResponse({}, false)],
    ])
    const entry = await checkOnePackage({
      packageName: 'dsh-ssh',
      sourceKind: 'registry',
      currentVersion: '0.11.0',
      repository: 'https://github.com/linxin666/dsh-ssh',
      fetchImpl,
    })
    expect(entry.status).toBe('cannot-check')
    expect(entry.status).not.toBe('up-to-date')
    expect(entry.latestVersion).toBeNull()
    expect(entry.source).toBeNull()
    expect(calls.length).toBeGreaterThan(0)
  })

  it('an injected fetch that THROWS also lands on cannot-check, not up-to-date', async () => {
    const throwingFetch = async () => { throw new Error('network down') }
    const entry = await checkOnePackage({
      packageName: 'dsh-ssh',
      sourceKind: 'registry',
      currentVersion: '0.11.0',
      repository: 'https://github.com/linxin666/dsh-ssh',
      fetchImpl: throwingFetch,
    })
    expect(entry.status).toBe('cannot-check')
    expect(entry.status).not.toBe('up-to-date')
  })
})

describe('probe helpers', () => {
  it('parses owner/repo from a normalized https GitHub URL', () => {
    expect(parseGitHubRepository('https://github.com/vlln/whale-girl')).toEqual({ owner: 'vlln', repo: 'whale-girl' })
    expect(parseGitHubRepository('https://github.com/vlln/whale-girl.git')).toEqual({ owner: 'vlln', repo: 'whale-girl' })
    expect(parseGitHubRepository('https://example.com/a/b')).toBeNull()
  })

  it('fetchNpmLatest returns the version and swallows failures', async () => {
    const ok = await fetchNpmLatest('dsh-ssh', async () => jsonResponse({ version: '0.2.0' }))
    expect(ok).toBe('0.2.0')
    const bad = await fetchNpmLatest('dsh-ssh', async () => jsonResponse({}, false))
    expect(bad).toBeUndefined()
  })

  it('fetchGithubLatest strips a leading v from the tag', async () => {
    const version = await fetchGithubLatest('https://github.com/vlln/whale-girl', async () => jsonResponse({ tag_name: 'v1.3.0' }))
    expect(version).toBe('1.3.0')
  })

  it('probe TTL: npm 1h, GitHub 24h (plan §5.6)', () => {
    const npm30m = { at: new Date(NOW - 30 * 60 * 1000).toISOString() }
    const npm2h = { at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }
    const gh2h = { at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }
    expect(probeIsFresh(npm30m, 'npm', NOW)).toBe(true)
    expect(probeIsFresh(npm2h, 'npm', NOW)).toBe(false)
    expect(probeIsFresh(gh2h, 'github', NOW)).toBe(true)
    expect(probeIsFresh(undefined, 'npm', NOW)).toBe(false)
  })
})

describe('UpdateCheckService cache (plan §5.6: 24h daily-lazy + force)', () => {
  const cachePath = resolve(tmpCacheDir, 'updates.json')
  const metaProvider = () => [
    { moduleName: 'dsh-ssh', meta: { sourceKind: 'registry', version: '0.11.0', repository: 'https://github.com/linxin666/dsh-ssh' } },
    { moduleName: 'dsh-openpencil', meta: { sourceKind: 'link', version: '0.1.0', repository: null } },
  ]

  it('writes the cache file at the injected path with lastCheckAt + entries', async () => {
    rmSync(cachePath, { force: true })
    const { fetchImpl } = makeFetch([
      ['https://registry.npmjs.org/dsh-ssh', jsonResponse({ version: '0.12.0' })],
    ])
    const service = new UpdateCheckService({ cachePath, fetchImpl, now: () => NOW, metaProvider })
    const result = await service.check()
    expect(result.fromCache).toBe(false)
    expect(result.checkedAt).toBe(new Date(NOW).toISOString())
    expect(existsSync(cachePath)).toBe(true)
    const written = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(written.lastCheckAt).toBe(new Date(NOW).toISOString())
    expect(Array.isArray(written.entries)).toBe(true)
    const ssh = written.entries.find((entry) => entry.packageName === 'dsh-ssh')
    expect(ssh.status).toBe('update-available')
    expect(written.probes['dsh-ssh'].latest).toBe('0.12.0')
  })

  it('reuses the cached result while under 24h (daily-lazy), zero new probes', async () => {
    rmSync(cachePath, { force: true })
    const { fetchImpl, calls } = makeFetch([
      ['https://registry.npmjs.org/dsh-ssh', jsonResponse({ version: '0.12.0' })],
    ])
    const service = new UpdateCheckService({ cachePath, fetchImpl, now: () => NOW, metaProvider })
    await service.check()
    const probeCountAfterFirst = calls.length
    expect(probeCountAfterFirst).toBe(1)
    // 1 hour later, still under 24h → served from cache, no network.
    const second = await service.check({})
    expect(second.fromCache).toBe(true)
    expect(calls.length).toBe(probeCountAfterFirst)
    expect(second.entries[0].status).toBe('update-available')
  })

  it('a check after 24h re-probes and rewrites the cache', async () => {
    rmSync(cachePath, { force: true })
    const { fetchImpl, calls } = makeFetch([
      ['https://registry.npmjs.org/dsh-ssh', jsonResponse({ version: '0.12.0' })],
    ])
    const service = new UpdateCheckService({ cachePath, fetchImpl, now: () => NOW, metaProvider })
    await service.check()
    const nextDay = new UpdateCheckService({ cachePath, fetchImpl, now: () => NOW + 25 * 60 * 60 * 1000, metaProvider })
    const third = await nextDay.check()
    expect(third.fromCache).toBe(false)
    expect(calls.length).toBe(2)
  })

  it('force bypasses the daily cache but reuses fresh per-source probe TTLs', async () => {
    rmSync(cachePath, { force: true })
    const { fetchImpl, calls } = makeFetch([
      ['https://registry.npmjs.org/dsh-ssh', jsonResponse({ version: '0.12.0' })],
    ])
    const service = new UpdateCheckService({ cachePath, fetchImpl, now: () => NOW, metaProvider })
    await service.check()
    const forced = await service.check({ force: true })
    expect(forced.fromCache).toBe(false)
    // npm probe is only 30min old → TTL reuse, no new fetch.
    expect(calls.length).toBe(1)
  })
})

describe('UpdateRunner — command generation only, never executes (task 4)', () => {
  it('builds the pnpm update command for one package inside the profile dir', () => {
    const command = buildUpdateCommand(['dsh-ssh'], 'D:\\work\\profiles\\web')
    expect(command).toBe('cd "D:\\\\work\\\\profiles\\\\web" && pnpm update dsh-ssh')
  })

  it('builds a batch command with de-duplicated packages', () => {
    const command = buildUpdateCommand(['dsh-ssh', 'whale-girl', 'dsh-ssh'], '/profile/web')
    expect(command).toBe('cd "/profile/web" && pnpm update dsh-ssh whale-girl')
  })

  it('returns an empty command for an empty package list', () => {
    expect(buildUpdateCommand([], '/x')).toBe('')
  })
})

describe('statusFromLatest (cached probe → status)', () => {
  it('never derives up-to-date from a failed probe', () => {
    const entry = statusFromLatest({ packageName: 'a', sourceKind: 'registry', currentVersion: '0.1.0', latest: null, source: null })
    expect(entry.status).toBe('cannot-check')
  })

  it('derives update-available / up-to-date from a successful probe', () => {
    expect(statusFromLatest({ packageName: 'a', sourceKind: 'registry', currentVersion: '0.1.0', latest: '0.2.0', source: 'npm' }).status).toBe('update-available')
    expect(statusFromLatest({ packageName: 'a', sourceKind: 'registry', currentVersion: '0.2.0', latest: '0.2.0', source: 'npm' }).status).toBe('up-to-date')
  })
})
