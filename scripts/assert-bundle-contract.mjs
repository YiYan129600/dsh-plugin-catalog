/**
 * Task-1 acceptance helper: node assertion that the bundle contract holds —
 * package.json declares `dsh.bundle.patch` and that file exists, and the
 * browser half is declared for the web platform with an inject list.
 *
 * Usage (project root):  node scripts/assert-bundle-contract.mjs
 * Exit 0 = contract holds; non-zero = broken (the reverse verification: with
 * cordis.patch.yml temporarily deleted this must fail RED, then turn GREEN
 * after restoring it).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const failures = []
const patch = pkg.dsh?.bundle?.patch
if (typeof patch !== 'string' || patch.length === 0) {
  failures.push('dsh.bundle.patch is missing in package.json')
} else if (!existsSync(resolve(root, patch))) {
  failures.push(`dsh.bundle.patch points at a missing file: ${patch}`)
}
if (pkg.dsh?.client?.platform !== 'web') failures.push('dsh.client.platform is not "web"')
if (!Array.isArray(pkg.dsh?.client?.inject) || pkg.dsh.client.inject.length === 0) {
  failures.push('dsh.client.inject is missing or empty')
}
if (pkg.main !== 'lib/index.js') failures.push(`main is not lib/index.js: ${pkg.main}`)
if (pkg.exports?.['./client']?.default !== './lib/client.js') {
  failures.push('exports["./client"] does not point at ./lib/client.js')
}

if (failures.length > 0) {
  console.error('[assert-bundle-contract] FAILED:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('[assert-bundle-contract] OK: bundle contract holds')
