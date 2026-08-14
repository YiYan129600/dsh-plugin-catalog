/**
 * Postbuild step: lower stage-3 (standard) decorators in the built host half.
 *
 * WHY: `@Remote('list')` (from @deepseek-ai/dsh-typert-protocol) is a TC39
 * stage-3 decorator. tsdown 0.22 lowers TS through rolldown/oxc, and oxc does
 * NOT transform ecma (standard) decorators (oxc-project/oxc#9170 is still
 * open) — the syntax is emitted verbatim, which Node cannot parse
 * (SyntaxError: Invalid or unexpected token). The official surface plugins
 * (dsh-host-plugin-inventory etc.) are built with esbuild, which does lower
 * standard decorators (their lib output carries the `__esDecorate` helper);
 * the sandbox blocks esbuild (EPERM spawn, see BLOCKED.md). TypeScript's own
 * transpileModule lowers standard decorators to exactly the same
 * `__esDecorate` helper shape, runs in-process (no child process, sandbox
 * safe), and is already installed (typescript is a devDependency).
 *
 * The script only rewrites lib/index.js when it actually contains decorator
 * syntax, so reruns and the client half are no-ops.
 */
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const target = resolve(root, 'lib/index.js')

let source
try {
  source = readFileSync(target, 'utf8')
} catch (error) {
  // lib/index.js missing — nothing to lower (e.g. a partial build).
  process.exit(0)
}

const DECORATOR = /^\s*@[A-Za-z_$][\w$]*\s*(?:\(|\s)/m
if (!DECORATOR.test(source)) {
  console.log('[lower-decorators] no decorator syntax in lib/index.js — no-op')
  process.exit(0)
}

const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
  fileName: 'index.js',
  reportDiagnostics: true,
})

const diagnostics = result.diagnostics ?? []
if (diagnostics.length > 0) {
  const message = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')
  throw new Error(`[lower-decorators] transpileModule failed:\n${message}`)
}

if (DECORATOR.test(result.outputText)) {
  throw new Error('[lower-decorators] decorator syntax survived lowering — refusing to write a Node-invalid bundle')
}

writeFileSync(target, result.outputText, 'utf8')
console.log('[lower-decorators] lowered standard decorators in lib/index.js')
