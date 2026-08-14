import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'
// Tested code comes from the BUILD OUTPUT (lib/), per the project's test
// route (BLOCKED.md): pure ESM, no TS syntax, vite never feeds it to esbuild.
import {
  PluginMetaService,
  buildPluginMeta,
  judgeSourceKind,
  normalizeRepository,
  resolveBundleDir,
} from '../lib/index.js'

// Plain-path style on purpose: `new URL(..., import.meta.url)` would trigger
// vite:asset ?url imports; vitest runs from the project root, so
// process.cwd() is the repo root.
const root = process.cwd()
const fixtures = resolve(root, 'tests/fixtures')
const installAnchor = resolve(fixtures, 'install/package.json')
const profileDir = resolve(fixtures, 'profile')
const summariesCachePath = resolve(fixtures, 'summaries.json')

/** A minimal Cordis runtime shell: the Service base needs `ctx.reflect.provide`; list() reads `ctx.loader` and `ctx.baseUrl`. */
function makeCtx(entries) {
  return {
    baseUrl: 'file:///' + profileDir.replace(/\\/g, '/') + '/',
    loader: { entries: () => entries },
    reflect: { provide() {} },
  }
}

/** A fake loader entry in the same shape Cordis Loader exposes. */
function entry(moduleName, { id = moduleName, enabled = true, state = 2, group = false } = {}) {
  return { id, options: { name: moduleName, group }, disabled: !enabled, fiber: state === null ? undefined : { state } }
}

describe('plugin meta resolution (task 2)', () => {
  it('judges registry sourceKind from a semver dependency spec', () => {
    const meta = buildPluginMeta('dsh-ssh', { installAnchor, profileDir, spec: '^0.11.0', inBox: false, summaries: {} })
    expect(meta).not.toBeNull()
    expect(meta.sourceKind).toBe('registry')
    expect(meta.version).toBe('0.11.0')
    expect(meta.description).toContain('SSH')
    expect(meta.keywords).toContain('ssh')
  })

  it('judges github sourceKind from a github: spec and normalizes git+https:// repository', () => {
    const meta = buildPluginMeta('whale-girl', { installAnchor, profileDir, spec: 'github:vlln/whale-girl#main', inBox: false, summaries: {} })
    expect(meta).not.toBeNull()
    expect(meta.sourceKind).toBe('github')
    // git+https://github.com/vlln/whale-girl.git → https://github.com/vlln/whale-girl
    expect(meta.repository).toBe('https://github.com/vlln/whale-girl')
  })

  it('judges link sourceKind from a link: spec', () => {
    const meta = buildPluginMeta('dsh-openpencil', { installAnchor, profileDir, spec: 'link:../dsh-openpencil', inBox: false, summaries: {} })
    expect(meta).not.toBeNull()
    expect(meta.sourceKind).toBe('link')
  })

  it('judges in-box sourceKind for a template bundle absent from dependencies', () => {
    // @deepseek-ai/dsh-base lives under the install anchor and is listed in
    // dsh.profile.bundles but NOT in the profile dependencies → template built-in.
    const meta = buildPluginMeta('@deepseek-ai/dsh-base', { installAnchor, profileDir, spec: undefined, inBox: true, summaries: {} })
    expect(meta).not.toBeNull()
    expect(meta.sourceKind).toBe('in-box')
    // …and it resolves from the install anchor, not the profile dir.
    expect(resolveBundleDir('@deepseek-ai/dsh-base', installAnchor, profileDir)).toBe(resolve(fixtures, 'install/node_modules/@deepseek-ai/dsh-base'))
  })

  it('normalizes git+https:// repository URLs to https:// (string and object forms)', () => {
    expect(normalizeRepository('git+https://github.com/linxin666/dsh-ssh.git')).toBe('https://github.com/linxin666/dsh-ssh')
    expect(normalizeRepository({ type: 'git', url: 'git+https://github.com/vlln/whale-girl.git' })).toBe('https://github.com/vlln/whale-girl')
    expect(normalizeRepository('github:owner/repo')).toBe('https://github.com/owner/repo')
    expect(normalizeRepository(undefined)).toBeNull()
    expect(normalizeRepository('not a url')).toBeNull()
  })

  it('returns meta:null without throwing when the package cannot resolve', () => {
    expect(buildPluginMeta('no-such-package', { installAnchor, profileDir, spec: '^1.0.0', inBox: false, summaries: {} })).toBeNull()
    expect(() => resolveBundleDir('no-such-package', installAnchor, profileDir)).not.toThrow()
  })

  it('resolves a registry package from the profile anchor', () => {
    expect(resolveBundleDir('dsh-ssh', installAnchor, profileDir)).toBe(resolve(fixtures, 'profile/node_modules/dsh-ssh'))
  })

  it('attaches a cached summary keyed by pkg@version', () => {
    const meta = buildPluginMeta('dsh-ssh', { installAnchor, profileDir, spec: '^0.11.0', inBox: false, summaries: { 'dsh-ssh@0.11.0': { nameZh: 'SSH 远程运维', descZh: '远程执行命令', source: 'builtin', generatedAt: '2026-02-23T00:00:00.000Z' } } })
    expect(meta).not.toBeNull()
    expect(meta.summary?.nameZh).toBe('SSH 远程运维')
  })
})

describe('PluginMetaService remote list (task 2)', () => {
  it('projects every non-group loader entry with resolved meta', () => {
    const service = new PluginMetaService(makeCtx([
      entry('dsh-ssh', { state: 2 }),
      entry('whale-girl', { state: 2 }),
      entry('@deepseek-ai/dsh-base', { state: 0 }),
      entry('dsh-openpencil', { enabled: false, state: null }),
      entry('a-group-row', { id: 'group-row', group: true }),
    ]), { installAnchor, profileDir, summariesCachePath })

    const { entries } = service.list()
    // group rows are skipped
    expect(entries.map((e) => e.moduleName)).toEqual(['dsh-ssh', 'whale-girl', '@deepseek-ai/dsh-base', 'dsh-openpencil'])
    const ssh = entries.find((e) => e.moduleName === 'dsh-ssh')
    expect(ssh.entryId).toBe('dsh-ssh')
    expect(ssh.enabled).toBe(true)
    expect(ssh.fiberPhase).toBe('active')
    expect(ssh.meta?.sourceKind).toBe('registry')
    expect(ssh.meta?.summary?.nameZh).toBe('SSH 远程运维')
    const whale = entries.find((e) => e.moduleName === 'whale-girl')
    expect(whale.meta?.sourceKind).toBe('github')
    expect(whale.meta?.repository).toBe('https://github.com/vlln/whale-girl')
    const base = entries.find((e) => e.moduleName === '@deepseek-ai/dsh-base')
    expect(base.fiberPhase).toBe('pending')
    expect(base.meta?.sourceKind).toBe('in-box')
    const disabled = entries.find((e) => e.moduleName === 'dsh-openpencil')
    expect(disabled.enabled).toBe(false)
    expect(disabled.fiberPhase).toBeNull()
  })

  it('degrades to meta:null without throwing for an unknown module', () => {
    const service = new PluginMetaService(makeCtx([entry('not-installed-anywhere', { state: 2 })]), { installAnchor, profileDir, summariesCachePath })
    expect(() => service.list()).not.toThrow()
    expect(service.list().entries[0].meta).toBeNull()
  })
})
