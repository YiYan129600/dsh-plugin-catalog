/**
 * dsh-plugin-catalog — host half (node).
 *
 * Task 1 placeholder: no host-side behavior yet. This mirrors the official
 * surface plugins `@deepseek-ai/dsh-client-ui-settings-plugins` and
 * `@deepseek-ai/dsh-client-ui-settings-plugin-inventory`, whose host bodies
 * are empty `apply`: the browser half owns the settings tab, and the host
 * half exists so the bundle row is a valid Cordis plugin (plan appendix A
 * failure point ③: a non-plugin host body shows up as a failed fiber).
 *
 * Task 2 adds PluginMetaService and its Typert Remote here; task 4 adds
 * SummaryService / UpdateCheckService / UpdateRunner.
 */

/** Host plugin body — nothing to register yet. */
export function apply(): void {}
