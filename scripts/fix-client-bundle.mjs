/**
 * Post-build fix for the browser half: rolldown/tsdown appends a bare
 * `export {};` to an ESM entry that has no module statements left after type
 * erasure. The client bundle is loaded as a CLASSIC script
 * (window.__ModuleLoader__.load via document.createElement('script')), where
 * `export` is a parse-time SyntaxError — every official client half has no
 * such statement. Strip it from lib/client.js only; the host half keeps its
 * real `export { apply }`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = resolve(root, 'lib/client.js')
const code = readFileSync(file, 'utf8')

const stripped = code.replace(/^\s*export\s+\{\s*\}\s*;?\s*$/gm, '')
if (stripped === code) {
  console.error('[fix-client-bundle] nothing to strip (no bare `export {};` found)')
  process.exit(1)
}
writeFileSync(file, stripped)
console.log('[fix-client-bundle] stripped bare `export {};` from lib/client.js')
