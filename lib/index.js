/**
 * dsh-automations — host half.
 *
 * DSH's built-in scheduler fires prompts at clock times. This plugin covers the
 * other half: things that should happen because *something happened* — DSH
 * booted, a session started / went idle / ended, a user message arrived, a tool
 * finished — plus a daily/interval clock, all running a local command, an HTTP
 * request or a log line.
 *
 * Wiring only: configuration in `./config.js`, rule model in `./model.js`,
 * storage in `./store.js`, execution in `./actions.js` + `./engine.js`, event
 * subscription in `./triggers.js`, the panel API in `./http.js`, and the model
 * tools in `./tools.js`.
 *
 * @module dsh-automations
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { defineTool } from "@deepseek-ai/dsh-tools";

import { createActions } from "./actions.js";
import { Config, resolveConfig } from "./config.js";
import { createEngine } from "./engine.js";
import { registerRoutes } from "./http.js";
import { guideText } from "./prompt.js";
import { createStore } from "./store.js";
import { createToolSpecs } from "./tools.js";
import { createTriggerHub } from "./triggers.js";

export const name = "dsh-automations";

/** Tools are the only hard requirement; prompt and Web API are optional. */
export const inject = ["tools"];

export { Config };

/**
 * `$DSH_HOME`, from the host service, the environment, then `~/.dsh`.
 *
 * @param {object} ctx - host plugin context.
 * @returns {string} the absolute DSH home path.
 */
function dshHome(ctx) {
	try {
		const service = ctx.get?.("dshHomePath");
		if (typeof service === "function") {
			const resolved = service();
			if (typeof resolved === "string" && resolved.length > 0) return resolved;
		}
	} catch {
		/* fall through */
	}
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
	return join(homedir(), ".dsh");
}

/**
 * Mount the plugin.
 *
 * @param {object} ctx - host plugin context.
 * @param {object} [config] - loader config (defaults are re-resolved here).
 */
export function apply(ctx, config) {
	const settings = resolveConfig(config);
	if (!settings.enabled) return;

	const log = {
		warn: (message) => console.warn(String(message)),
	};
	const dir = settings.stateDir !== "" ? settings.stateDir : join(dshHome(ctx), "storages", "dsh-automations");

	let store;
	try {
		store = createStore({ dir, maxRuns: settings.maxRunHistory, log });
	} catch (error) {
		log.warn(`[dsh-automations] cannot open ${dir}: ${error instanceof Error ? error.message : String(error)}`);
		throw error;
	}
	const actions = createActions({ settings });
	const engine = createEngine({ settings, store, actions, log });
	const hub = createTriggerHub({ ctx, settings, store, engine, log });

	ctx.effect(() => {
		hub.start();
		return () => {
			hub.stop();
			store.flush();
		};
	}, "dsh-automations: triggers");

	// The panel API needs the authenticated connection bridge; mounting the
	// route plugin lazily keeps headless compositions (no bridge) loadable.
	ctx.inject(["connection"], (routeCtx) => {
		routeCtx.effect(() => registerRoutes({ ctx: routeCtx, store, engine, hub, log }), "dsh-automations: panel api");
	});

	if (settings.promptEnabled) {
		ctx.inject(["systemPrompt"], (promptCtx) => {
			promptCtx.systemPrompt.section({ name: "dsh-automations:guide", order: settings.promptOrder, text: () => guideText() });
		});
	}

	for (const spec of createToolSpecs({ store, engine })) {
		ctx.tools.register(
			defineTool({
				name: spec.name,
				description: spec.description,
				parameters: spec.parameters,
				output: {
					schema: spec.outputSchema,
					render: spec.render,
				},
				execute: spec.execute,
			}),
		);
	}
}
