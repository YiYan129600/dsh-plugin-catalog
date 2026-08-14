import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client/index.ts',
  },
  format: ['esm'],
  outDir: 'lib',
  // Without a target (and with no `engines.node` in package.json) tsdown
  // applies NO syntax transforms — stage-3 decorators like
  // `@Remote('list')` would be emitted verbatim and Node would fail to parse
  // lib/index.js. Target node18 so rolldown/oxc lowers decorators.
  target: 'node18',
  // The bundle contract (plan appendix A) names the halves lib/index.js and
  // lib/client.js; force the .js extension regardless of pkg type defaults.
  outExtensions: () => ({ js: '.js' }),
  clean: true,
  sourcemap: true,
  deps: {
    // Runtime externals are resolved by the host process / browser
    // ModuleLoader. tsdown 0.22 renamed `external` to `deps.neverBundle` (the
    // old key is deprecated and silently ignored): the Cordis runtime and the
    // Typert protocol MUST stay external so the running dsh host and this
    // bundle share one cordis instance (a bundled copy would break
    // Service/instanceof identity and the Remote marker tables).
    neverBundle: [/^@deepseek-ai\//, /^react$/, /^react\//, /^schemastery$/],
  },
})
