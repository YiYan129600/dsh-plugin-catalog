/**
 * Preload for vitest runs (node --import ./scripts/patch-exec-for-vitest.mjs).
 *
 * Why: the DSH sandbox denies child_process spawns that capture piped stdio
 * (EPERM). Vite's Windows path resolver calls `exec("net use", cb)` once to
 * map network drives before falling back to fs.realpathSync.native; that call
 * throws EPERM under the sandbox and aborts the whole test run.
 *
 * What: patch ONLY the `net use` probe — answer it with an empty listing so
 * vite concludes "no network maps" and keeps fs.realpathSync.native. Every
 * other exec() call passes through to the original implementation unchanged.
 *
 * Patching mechanics: node:child_process is CJS; its ESM namespace snapshot is
 * taken at the FIRST ESM import. This module runs first (--import) and uses
 * createRequire, so the CJS exports object is patched before vite's
 * `import { exec } from "node:child_process"` snapshots it.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')
const originalExec = childProcess.exec

/** Minimal ChildProcess stand-in; vite ignores the return value of this probe. */
const inertProcess = {
  on() { return inertProcess },
  once() { return inertProcess },
  emit() { return inertProcess },
  kill() { return true },
  stdout: null,
  stderr: null,
  stdin: null,
}

function patchedExec(command, options, callback) {
  let opts = options
  let cb = callback
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (typeof command === 'string' && /^net\s+use/i.test(command.trim())) {
    // Answer the drive-map probe with an empty listing: no network drives,
    // vite keeps fs.realpathSync.native.
    if (typeof cb === 'function') queueMicrotask(() => cb(null, '', ''))
    return inertProcess
  }
  return originalExec.call(this, command, opts, cb)
}

childProcess.exec = patchedExec
