/**
 * Post-build fix for the browser half — now a no-op safety net.
 *
 * Task 1 shipped an ESM client entry whose entire module body was the
 * `window.__ModuleLoader__.load(...)` call, and rolldown appended a bare
 * `export {};` to that ESM output (a parse-time SyntaxError when the artifact
 * is served as a CLASSIC script). Task 3 switched the client entry to the
 * dsh-web-ui family preset (CJS closure + banner/footer, see tsdown.config.ts):
 * that output never carries a top-level `export`, so there is normally
 * nothing to strip. Keep the check so a future config regression that leaks
 * `export {}` back into lib/client.js is still caught (and red on build).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = resolve(root, 'lib/client.js')
const code = readFileSync(file, 'utf8')

const stripped = code.replace(/^\s*export\s+\{\s*\}\s*;?\s*$/gm, '')
if (stripped === code) {
  console.log('[fix-client-bundle] nothing to strip (classic-script shape is clean)')
} else {
  writeFileSync(file, stripped)
  console.log('[fix-client-bundle] stripped bare `export {};` from lib/client.js')
}
