import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

// The browser half is a CLASSIC script (window.__ModuleLoader__.load +
// factory(require)), so it cannot be imported as a module — the test executes
// its source in the jsdom environment and drives the factory with a stubbed
// module-table require, exactly like the shell's loader does.
const root = process.cwd()
const clientSource = readFileSync(resolve(root, 'lib/client.js'), 'utf8')

describe('client bundle classic-script shape (task 3)', () => {
  it('is a classic script: opens with the loader handoff and has no top-level import/export', () => {
    expect(clientSource.trimStart().startsWith('window.__ModuleLoader__.load({')).toBe(true)
    // The factory closes with `return module.exports;` then `} });` (footer),
    // possibly followed by the sourcemap comment.
    const withoutMap = clientSource.replace(/\/\/# sourceMappingURL=.*$/m, '').trimEnd()
    expect(withoutMap.endsWith('});')).toBe(true)
    const topLevel = clientSource.split('\n').some((line) => /^\s*(import\s|export\s)/.test(line))
    expect(topLevel).toBe(false)
  })

  it('executes in a browser-like environment and registers apply + inject', () => {
    let captured
    window.__ModuleLoader__ = {
      load: (handoff) => {
        captured = handoff
      },
    }
    // Evaluate as a classic script (global scope), like the shell's <script> tag.
    new Function(clientSource)()
    expect(captured).not.toBeNull()
    expect(captured.id).toBe('dsh-plugin-catalog')
    const moduleExports = captured.factory((spec) => {
      if (spec === 'react') return React
      if (spec === 'react/jsx-runtime') return jsxRuntime
      throw new Error(`unexpected external require: ${spec}`)
    })
    expect(moduleExports.inject).toEqual(['slots'])
    expect(typeof moduleExports.apply).toBe('function')
    // The site stylesheet is injected exactly once.
    expect(document.querySelectorAll('style[data-plugin-css="dsh-plugin-catalog/site.css"]').length).toBe(1)
  })
})
