import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Plain-path style on purpose: `new URL(..., import.meta.url)` would make
// vite:asset emit `?url` imports for project files, and the `.ts` ones get
// fed through vite:esbuild, whose service spawn is blocked by the sandbox
// (EPERM). See BLOCKED.md. Vitest runs from the project root, so
// process.cwd() is the repo root.
const root = process.cwd()
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

describe('bundle contract (task 1)', () => {
  it('declares dsh.bundle.patch pointing at an existing file', () => {
    expect(typeof pkg.dsh?.bundle?.patch).toBe('string')
    expect(existsSync(resolve(root, pkg.dsh.bundle.patch))).toBe(true)
  })

  it('declares the browser half for the web platform with an inject list', () => {
    expect(pkg.dsh?.client?.platform).toBe('web')
    expect(Array.isArray(pkg.dsh?.client?.inject)).toBe(true)
    expect(pkg.dsh.client.inject.length).toBeGreaterThan(0)
  })

  it('maps main and the ./client exports subpath to the built halves', () => {
    expect(pkg.main).toBe('lib/index.js')
    expect(pkg.exports?.['./client']?.default).toBe('./lib/client.js')
  })
})
