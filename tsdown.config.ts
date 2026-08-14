import { defineConfig } from 'tsdown'

/**
 * Two bundles, one `lib/` output directory (plan appendix A):
 *
 * 1. Host half (`src/index.ts` → lib/index.js) — plain Node ESM, external
 *    runtime deps (cordis, typert-protocol, @deepseek-ai/*) stay external so
 *    the running dsh host shares one cordis instance. `clean: true` runs
 *    first (array order) and wipes lib/ before either half is written.
 *
 * 2. Browser half (`src/client/index.tsx` → lib/client.js) — CJS closure
 *    wrapped in `window.__ModuleLoader__.load({ id, factory })` via
 *    outputOptions banner/footer/intro, exactly like the dsh-web-ui family
 *    preset (`shared/tsdown.client.ts`, whitelisted reference): externals
 *    (react) resolve through the loader's injected `require`, relative
 *    modules (src/search.ts) inline inside the factory, and the artifact is
 *    a CLASSIC script (no top-level import/export).
 */
const HOST_ID = 'dsh-plugin-catalog'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'lib',
    // Without a target (and with no `engines.node` in package.json) tsdown
    // applies NO syntax transforms — stage-3 decorators like
    // `@Remote('list')` would be emitted verbatim and Node would fail to
    // parse lib/index.js. Target node18 so rolldown/oxc lowers decorators.
    target: 'node18',
    // The bundle contract names the halves lib/index.js and lib/client.js;
    // force the .js extension regardless of pkg type defaults.
    outExtensions: () => ({ js: '.js' }),
    clean: true,
    sourcemap: true,
    deps: {
      // Runtime externals are resolved by the host process. tsdown 0.22
      // renamed `external` to `deps.neverBundle` (the old key is deprecated
      // and silently ignored): the Cordis runtime and the Typert protocol
      // MUST stay external so the running dsh host and this bundle share one
      // cordis instance (a bundled copy would break Service/instanceof
      // identity and the Remote marker tables).
      neverBundle: [/^@deepseek-ai\//, /^react$/, /^react\//, /^schemastery$/],
    },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'lib',
    dts: false,
    // Must NOT clean: the host half was just written by the first config.
    clean: false,
    sourcemap: true,
    deps: {
      // Only the loader module-table entries the bundle requires values from
      // stay external (require() inside the factory); search.ts is a
      // relative module and inlines.
      neverBundle: [/^react$/, /^react\//],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(HOST_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
