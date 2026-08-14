import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client/index.ts',
  },
  format: ['esm'],
  outDir: 'lib',
  // The bundle contract (plan appendix A) names the halves lib/index.js and
  // lib/client.js; force the .js extension regardless of pkg type defaults.
  outExtensions: () => ({ js: '.js' }),
  clean: true,
  sourcemap: true,
  deps: {
    // Runtime externals are resolved by the host process / browser
    // ModuleLoader; nothing imports them at the top level today, but keep
    // them external for the tasks that follow (task 3 client UI, task 4
    // services).
    external: [/^@deepseek-ai\//, /^react$/, /^react\//, /^schemastery$/],
  },
})
