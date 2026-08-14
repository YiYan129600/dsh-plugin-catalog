/**
 * dsh-plugin-catalog — browser half.
 *
 * Task 1 placeholder: registers an EMPTY tab into the settings → Plugins
 * section (slot `settings.plugins.tab`, id `plugin-catalog`). Task 3 replaces
 * the placeholder component with the real plugin-list page.
 *
 * Bundle shape (plan appendix A): the whole file is wrapped in
 * `window.__ModuleLoader__.load({ id, factory })` — the client bundle is a
 * CLASSIC script, so the module graph must live inside the factory closure,
 * external runtime deps are reached through `require(...)`, and the factory
 * returns `module.exports` carrying `{ apply, inject }`. Every official
 * client half (`dsh-client-ui-settings-plugins`, `dsh-client-ui-settings-
 * plugin-inventory`, task-board) ships exactly this shape.
 *
 * Why the tab registration lives here and not in the host half: `ctx.slots`
 * is a browser-runtime service (dsh-client-runtime/client); the host process
 * has no slots registry. The host half is an empty apply, exactly like the
 * official settings surface plugins.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings-surface slot contract
// (SlotMap['settings.plugins.tab']) and the `dsh-client-ui-slots` module
// augmentation, so `ctx.slots.register` type-checks against the real slot.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ReactNode } from 'react'

declare const window: {
  __ModuleLoader__: {
    load(options: { id: string; factory: (require: (spec: string) => unknown) => unknown }): void
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-plugin-catalog',
  factory: (require) => {
    const module = { exports: {} as Record<string, unknown> }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** Required services: the slot registry only, for the placeholder tab. */
    const inject = ['slots']

    /** Placeholder tab body — renders nothing until Task 3 lands the real list. */
    const EmptyTab = (): ReactNode => null

    /**
     * Register the plugin's own tab into the Plugins settings section
     * (`settings.plugins.tab` is a list slot; id `plugin-catalog` per the
     * task book). `order: 20` sits after the built-in inventory tab (`all`).
     */
    function apply(ctx: ClientContext): void {
      ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'plugin-catalog',
        order: 20,
        label: '插件目录',
      }, EmptyTab)
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
