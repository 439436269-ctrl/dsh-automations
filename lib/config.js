/**
 * Loader-facing configuration.
 *
 * `@deepseek-ai/schemastery` is resolved by the *host*, not by this package:
 * some runtimes provide it through the profile's hoisted layout, others through
 * their own module map, and a few (headless SDK compositions) do not provide it
 * at all. It is therefore optional: when it is missing the plugin still loads
 * and every setting falls back to `resolveConfig`'s defaults.
 *
 * @module dsh-automations/config
 */

import { DEFAULTS, resolveConfig } from "./settings.js";

let schema;
try {
	schema = (await import("@deepseek-ai/schemastery")).default;
} catch {
	schema = undefined;
}

export const Config = schema === undefined ? undefined : schema.object({
	/** Master switch; `false` registers nothing at all. */
	enabled: schema.boolean().default(DEFAULTS.enabled),
	/** Directory for `rules.json` / `runs.json`; empty means `$DSH_HOME/storages/dsh-automations`. */
	stateDir: schema.string().default(DEFAULTS.stateDir),
	/** Retained run records (newest kept). */
	maxRunHistory: schema.natural().default(DEFAULTS.maxRunHistory),
	/** Output characters kept per run (the tail wins). */
	maxOutputChars: schema.natural().default(DEFAULTS.maxOutputChars),
	/** Default per-run timeout when the action does not set one. */
	defaultTimeoutMs: schema.natural().default(DEFAULTS.defaultTimeoutMs),
	/** Grace period after host boot before `startup` rules run. */
	startupDelayMs: schema.natural().default(DEFAULTS.startupDelayMs),
	/** Resolution of the daily / interval scheduler, in seconds. */
	tickSeconds: schema.natural().default(DEFAULTS.tickSeconds),
	/** Whether to contribute the short guide section to the system prompt. */
	promptEnabled: schema.boolean().default(DEFAULTS.promptEnabled),
	/** Ordering of that system-prompt section. */
	promptOrder: schema.natural().default(DEFAULTS.promptOrder),
});

export { DEFAULTS, resolveConfig };
