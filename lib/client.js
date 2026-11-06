/**
 * dsh-automations — browser half.
 *
 * Two registrations:
 *  - `sidebar.panellist` / id `automations` — the glyph in the left rail;
 *  - `main` / key `automations` — the page that rail entry opens.
 *
 * No build step: the module loader hands us React and we create elements
 * directly. All data comes from the host half's JSON API, polled while the page
 * is visible; the panel owns no durable state of its own.
 *
 * @module dsh-automations/client
 */

window.__ModuleLoader__.load({
	id: "dsh-automations",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;
		const { useCallback, useEffect, useMemo, useRef, useState } = React;

		/** Sidebar cell id === main-panel key. */
		const PANEL_ID = "automations";
		/** Host API prefix. */
		const API = "/api/dsh-automations";
		/** Poll interval while the page is visible. */
		const POLL_MS = 4000;

		//#region labels
		/** Browser-level fallback; the host locale service overrides it when present. */
		const FALLBACK_LANG = (typeof navigator !== "undefined" ? navigator.language : "") || (typeof document !== "undefined" ? document.documentElement.lang : "") || "en";
		/** Active language flag; the panel updates it from `locale` and re-renders. */
		let ZH = /^zh/i.test(FALLBACK_LANG);

		/**
		 * @param {string} id - locale id.
		 * @returns {boolean} whether the flag changed.
		 */
		function applyLocaleId(id) {
			const next = /^zh/i.test(String(id ?? "")) || (String(id ?? "") === "" && /^zh/i.test(FALLBACK_LANG));
			const changed = next !== ZH;
			ZH = next;
			return changed;
		}

		/** Bilingual literal. */
		const T = (zh, en) => (ZH ? zh : en);

		const STATUS_LABEL = {
			ok: () => T("成功", "ok"),
			error: () => T("失败", "failed"),
			timeout: () => T("超时", "timeout"),
			skipped: () => T("跳过", "skipped"),
		};

		/** Localised catalog label with an English fallback. */
		function catalogLabel(entry) {
			if (entry === undefined) return "";
			return ZH ? entry.label : entry.labelEn ?? entry.label;
		}

		/** Localised catalog hint. */
		function catalogHint(entry) {
			if (entry === undefined) return "";
			return ZH ? entry.hint : entry.hintEn ?? entry.hint;
		}

		/** Localised field label. */
		function fieldLabel(field) {
			return ZH ? field.label : field.labelEn ?? field.label;
		}

		/** Localised option label. */
		function optionLabel(option) {
			return ZH ? option.label : option.labelEn ?? option.label;
		}
		//#endregion

		//#region styles
		const CSS = [
			".dsha_root{height:100%;box-sizing:border-box;overflow:auto;padding:22px 26px 64px;font-family:inherit;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary,#e6e8ee)}",
			".dsha_inner{max-width:920px;margin:0 auto}",
			".dsha_head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}",
			".dsha_h1{margin:0 0 3px;font-size:19px;font-weight:600;letter-spacing:.01em}",
			".dsha_sub{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary,#8a8f98)}",
			".dsha_btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:6px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));color:inherit;font:inherit;font-size:12.5px;line-height:18px;padding:5px 11px;cursor:pointer;white-space:nowrap;transition:background .15s ease,border-color .15s ease,opacity .15s ease}",
			".dsha_btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16))}",
			".dsha_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5b8def);outline-offset:1px}",
			".dsha_btn[disabled]{opacity:.5;cursor:not-allowed}",
			".dsha_btn.primary{background:var(--dsw-alias-brand-primary,#5b8def);border-color:transparent;color:#fff}",
			".dsha_btn.primary:hover{filter:brightness(1.06)}",
			".dsha_btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary,#8a8f98)}",
			".dsha_btn.ghost:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#e6e8ee)}",
			".dsha_btn.danger:hover{color:var(--dsw-alias-state-error-primary,#e5534b)}",
			".dsha_stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}",
			".dsha_stat{flex:1 1 150px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:8px;padding:9px 12px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05))}",
			".dsha_stat b{display:block;font-size:17px;font-weight:600;line-height:1.35}",
			".dsha_stat span{font-size:11.5px;color:var(--dsw-alias-label-secondary,#8a8f98)}",
			".dsha_section{margin-top:22px}",
			".dsha_h2{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#8a8f98);text-transform:none}",
			".dsha_tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));margin:0 0 16px}",
			".dsha_tab{appearance:none;display:inline-flex;align-items:center;gap:6px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#8a8f98);font:inherit;font-size:13px;padding:7px 10px;margin-bottom:-1px;cursor:pointer}",
			".dsha_tab:hover{color:var(--dsw-alias-label-primary,#e6e8ee)}",
			".dsha_tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5b8def);outline-offset:-2px}",
			".dsha_tab[aria-selected=true]{color:var(--dsw-alias-label-primary,#e6e8ee);border-bottom-color:var(--dsw-alias-brand-primary,#5b8def)}",
			".dsha_tab .dsha_badge{font-size:10px;padding:0 6px}",
			".dsha_runrow .dsha_badge{flex:none;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsha_runmeta{padding:6px 11px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));font-size:11.5px;color:var(--dsw-alias-label-secondary,#8a8f98);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dsha_runbox .dsha_pre{border-top:none}",
			".dsha_card{display:flex;align-items:flex-start;gap:12px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05));padding:12px 14px;margin-bottom:8px}",
			".dsha_card[data-off=true]{opacity:.55}",
			".dsha_glyph{flex:none;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-brand-primary,#5b8def)}",
			".dsha_cardmain{flex:1 1 auto;min-width:0}",
			".dsha_cardtitle{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px}",
			".dsha_badge{flex:none;font-size:10.5px;font-weight:500;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));color:var(--dsw-alias-label-secondary,#8a8f98);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}",
			".dsha_cardline{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary,#8a8f98);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dsha_cardmeta{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary,#8a8f98);opacity:.85}",
			".dsha_cardactions{flex:none;display:flex;align-items:center;gap:6px}",
			".dsha_dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#8a8f98);flex:none}",
			".dsha_dot[data-status=ok]{background:var(--dsw-alias-state-success-primary,#34a853)}",
			".dsha_dot[data-status=error]{background:var(--dsw-alias-state-error-primary,#e5534b)}",
			".dsha_dot[data-status=timeout]{background:var(--dsw-alias-state-warn-primary,#e0a03a)}",
			".dsha_switch{position:relative;flex:none;width:32px;height:18px;border-radius:999px;border:none;padding:0;cursor:pointer;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.28));transition:background .15s ease}",
			".dsha_switch::after{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s ease}",
			".dsha_switch[aria-checked=true]{background:var(--dsw-alias-brand-primary,#5b8def)}",
			".dsha_switch[aria-checked=true]::after{transform:translateX(14px)}",
			".dsha_empty{border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:10px;padding:18px;text-align:center;color:var(--dsw-alias-label-secondary,#8a8f98);font-size:12.5px}",
			".dsha_tpls{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:12px}",
			".dsha_tpl{box-sizing:border-box;text-align:left;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));border-radius:9px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.05));padding:11px 12px;cursor:pointer;color:inherit;font:inherit;transition:border-color .15s ease,background .15s ease}",
			".dsha_tpl:hover{border-color:var(--dsw-alias-brand-primary,#5b8def);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}",
			".dsha_tpl b{display:block;font-size:12.5px;margin-bottom:3px}",
			".dsha_tpl span{font-size:11.5px;color:var(--dsw-alias-label-secondary,#8a8f98)}",
			".dsha_runs{display:flex;flex-direction:column;gap:6px}",
			".dsha_runbox{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));overflow:hidden}",
			".dsha_runrow{display:flex;align-items:center;gap:10px;padding:7px 11px;font-size:12px;cursor:pointer}",
			".dsha_runrow:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08))}",
			".dsha_runat{flex:none;width:112px;color:var(--dsw-alias-label-secondary,#8a8f98);font-variant-numeric:tabular-nums}",
			".dsha_runname{flex:0 1 auto;max-width:45%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsha_runstatus{flex:none;width:56px;font-size:11.5px}",
			".dsha_runstatus[data-status=ok]{color:var(--dsw-alias-state-success-primary,#34a853)}",
			".dsha_runstatus[data-status=error]{color:var(--dsw-alias-state-error-primary,#e5534b)}",
			".dsha_runstatus[data-status=timeout]{color:var(--dsw-alias-state-warn-primary,#e0a03a)}",
			".dsha_rundur{flex:none;width:64px;text-align:right;color:var(--dsw-alias-label-secondary,#8a8f98);font-variant-numeric:tabular-nums}",
			".dsha_pre{margin:0;padding:9px 11px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;color:var(--dsw-alias-label-secondary,#b9bec8)}",
			".dsha_backdrop{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:26px;background:rgba(0,0,0,.45)}",
			".dsha_modal{box-sizing:border-box;width:min(760px,100%);max-height:90vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:12px;background:var(--dsw-alias-bg-overlay,#1f2430);box-shadow:0 18px 60px rgba(0,0,0,.45);padding:18px 20px 16px}",
			".dsha_modaltitle{margin:0 0 2px;font-size:15px;font-weight:600}",
			".dsha_modalsub{margin:0 0 14px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#8a8f98)}",
			".dsha_grid{display:grid;grid-template-columns:1fr 1fr;gap:11px 14px}",
			".dsha_field{display:flex;flex-direction:column;gap:4px;min-width:0}",
			".dsha_field.wide{grid-column:1/-1}",
			".dsha_label{font-size:11.5px;color:var(--dsw-alias-label-secondary,#8a8f98)}",
			".dsha_input,.dsha_select,.dsha_textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:6px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.16));color:inherit;font:inherit;font-size:12.5px;padding:6px 8px}",
			".dsha_input:focus,.dsha_select:focus,.dsha_textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#5b8def)}",
			".dsha_textarea{resize:vertical;min-height:62px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.5}",
			".dsha_hint{font-size:11px;color:var(--dsw-alias-label-secondary,#8a8f98);opacity:.85}",
			".dsha_days{display:flex;gap:5px;flex-wrap:wrap}",
			".dsha_day{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:inherit;border-radius:5px;font:inherit;font-size:11.5px;padding:3px 8px;cursor:pointer}",
			".dsha_day[aria-pressed=true]{background:var(--dsw-alias-brand-primary,#5b8def);border-color:transparent;color:#fff}",
			".dsha_footer{display:flex;align-items:center;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}",
			".dsha_grow{flex:1 1 auto}",
			".dsha_err{margin-top:10px;font-size:12px;color:var(--dsw-alias-state-error-primary,#e5534b);white-space:pre-wrap}",
			".dsha_testres{margin-top:10px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:8px;overflow:hidden}",
			".dsha_testhead{display:flex;gap:8px;align-items:center;padding:6px 10px;font-size:12px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}",
			".dsha_toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483000;max-width:min(560px,90vw);padding:8px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-overlay,#1f2430);color:var(--dsw-alias-label-primary,#e6e8ee);box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:12.5px}",
			".dsha_toast[data-kind=error]{border-color:var(--dsw-alias-state-error-primary,#e5534b)}",
			".dsha_loading{padding:40px 0;text-align:center;color:var(--dsw-alias-label-secondary,#8a8f98);font-size:12.5px}",
		].join("\n");
		const CSS_ID = "dsh-automations/panel.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-automations";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region api
		/**
		 * Read one JSON endpoint.
		 *
		 * @param {string} path - suffix under /api/dsh-automations.
		 * @returns {Promise<any>}
		 */
		async function apiGet(path) {
			const response = await fetch(API + path, { headers: { accept: "application/json" } });
			const body = await response.json().catch(() => null);
			if (!response.ok || body === null || body.ok !== true) {
				throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
			}
			return body.value;
		}

		/**
		 * Post one JSON body.
		 *
		 * @param {string} path - suffix under /api/dsh-automations.
		 * @param {object} payload - JSON body.
		 * @returns {Promise<any>}
		 */
		async function apiPost(path, payload) {
			const response = await fetch(API + path, {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify(payload ?? {}),
			});
			const body = await response.json().catch(() => null);
			if (!response.ok || body === null || body.ok !== true) {
				throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
			}
			return body.value;
		}
		//#endregion

		//#region formatting
		/**
		 * @param {string} iso - instant.
		 * @returns {string} local clock/date.
		 */
		function fmtClock(iso) {
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return "";
			const now = new Date();
			const sameDay = date.toDateString() === now.toDateString();
			return sameDay
				? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
				: date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
		}

		/**
		 * @param {string} iso - instant.
		 * @returns {string} relative time.
		 */
		function fmtRelative(iso) {
			const at = Date.parse(iso ?? "");
			if (!Number.isFinite(at)) return "";
			const diff = Date.now() - at;
			if (diff < 0) return T("即将", "soon");
			if (diff < 60_000) return T("刚刚", "just now");
			if (diff < 3_600_000) return T(`${Math.floor(diff / 60_000)} 分钟前`, `${Math.floor(diff / 60_000)}m ago`);
			if (diff < 86_400_000) return T(`${Math.floor(diff / 3_600_000)} 小时前`, `${Math.floor(diff / 3_600_000)}h ago`);
			return T(`${Math.floor(diff / 86_400_000)} 天前`, `${Math.floor(diff / 86_400_000)}d ago`);
		}

		/**
		 * @param {number} ms - duration.
		 * @returns {string} compact duration.
		 */
		function fmtDuration(ms) {
			const value = Math.max(0, Number(ms) || 0);
			if (value < 1000) return `${Math.round(value)}ms`;
			if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
			return `${Math.floor(value / 60_000)}m${String(Math.round((value % 60_000) / 1000)).padStart(2, "0")}s`;
		}

		/**
		 * @param {string} status - run status.
		 * @returns {string} localised label.
		 */
		function statusLabel(status) {
			return (STATUS_LABEL[status] ?? (() => status))();
		}
		//#endregion

		//#region icons
		/** The sidebar glyph (lightning bolt). */
		function AutomationIcon(props) {
			const size = typeof props?.size === "number" ? props.size : 18;
			return h(
				"svg",
				{ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
				h("path", { d: "M13 2 4 14h6l-1 8 10-12h-6l1-8Z" }),
			);
		}

		/** Per-trigger glyph. */
		function TriggerGlyph({ type, size = 16 }) {
			const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
			switch (type) {
				case "session-start":
					return h("svg", common, h("path", { d: "M8 5v14l11-7L8 5Z" }));
				case "session-idle":
					return h("svg", common, h("path", { d: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" }));
				case "session-end":
					return h("svg", common, h("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }), h("path", { d: "m16 17 5-5-5-5" }), h("path", { d: "M21 12H9" }));
				case "user-message":
					return h("svg", common, h("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" }));
				case "tool-after":
					return h("svg", common, h("path", { d: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6Z" }));
				case "daily":
				case "interval":
					return h("svg", common, h("circle", { cx: 12, cy: 12, r: 9 }), h("path", { d: "M12 7v5l3 2" }));
				case "manual":
					return h("svg", common, h("path", { d: "M9 11V5a2 2 0 1 1 4 0v6" }), h("path", { d: "M13 11V7a2 2 0 1 1 4 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.1L3 14.5a2 2 0 0 1 3-2.6L8 14" }));
				default:
					return h("svg", common, h("path", { d: "M13 2 4 14h6l-1 8 10-12h-6l1-8Z" }));
			}
		}

		/** Small action glyph. */
		function PlayGlyph({ size = 14 }) {
			return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true" }, h("path", { d: "M8 5v14l11-7L8 5Z" }));
		}

		/** Trash glyph. */
		function TrashGlyph({ size = 14 }) {
			return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: "M3 6h18" }), h("path", { d: "M8 6V4h8v2" }), h("path", { d: "M19 6l-1 14H6L5 6" }));
		}
		//#endregion

		//#region draft
		/**
		 * @returns {object} a blank editor draft.
		 */
		function emptyDraft() {
			return {
				id: "",
				name: "",
				enabled: true,
				cooldownSeconds: 0,
				triggerType: "startup",
				trigger: { delayMs: 1500, source: "any", idleSeconds: 600, mode: "any", match: "", tool: "*", when: "always", time: "08:30", weekdays: [], minutes: 60 },
				actionType: "shell",
				action: { command: "", cwd: "", shell: "auto", timeoutMs: 60000, url: "", method: "GET", headers: "{}", body: "", message: "" },
			};
		}

		/**
		 * @param {object} rule - stored rule.
		 * @returns {object} an editor draft bound to that rule.
		 */
		function draftFromRule(rule) {
			const base = emptyDraft();
			return {
				...base,
				id: rule.id,
				name: rule.name,
				enabled: rule.enabled !== false,
				cooldownSeconds: rule.cooldownSeconds ?? 0,
				triggerType: rule.trigger.type,
				trigger: { ...base.trigger, ...rule.trigger },
				actionType: rule.action.type,
				action: { ...base.action, ...rule.action },
			};
		}

		/**
		 * Build the server payload from a draft.
		 *
		 * @param {object} draft - editor draft.
		 * @returns {object}
		 */
		function payloadFromDraft(draft) {
			return {
				id: draft.id === "" ? undefined : draft.id,
				name: draft.name,
				enabled: draft.enabled,
				cooldownSeconds: Number(draft.cooldownSeconds) || 0,
				trigger: { ...draft.trigger, type: draft.triggerType },
				action: { ...draft.action, type: draft.actionType },
			};
		}
		//#endregion

		//#region form pieces
		/**
		 * One labelled form control.
		 *
		 * @param {{field: object, value: unknown, onChange: (value: unknown) => void}} props
		 */
		function FieldControl({ field, value, onChange }) {
			const id = `dsha-${field.key}`;
			if (field.type === "select") {
				return h(
					"select",
					{ id, className: "dsha_select", value: String(value ?? ""), onChange: (event) => onChange(event.target.value) },
					(field.options ?? []).map((option) => h("option", { key: option.value, value: option.value }, optionLabel(option))),
				);
			}
			if (field.type === "textarea") {
				return h("textarea", { id, className: "dsha_textarea", value: String(value ?? ""), placeholder: field.placeholder ?? "", spellCheck: false, onChange: (event) => onChange(event.target.value) });
			}
			if (field.type === "int") {
				return h("input", { id, className: "dsha_input", type: "number", min: field.min, max: field.max, value: String(value ?? ""), onChange: (event) => onChange(event.target.value === "" ? "" : Number(event.target.value)) });
			}
			if (field.type === "time") {
				return h("input", { id, className: "dsha_input", type: "time", value: String(value ?? ""), onChange: (event) => onChange(event.target.value) });
			}
			if (field.type === "weekdays") {
				const selected = Array.isArray(value) ? value : [];
				const names = [T("一", "Mo"), T("二", "Tu"), T("三", "We"), T("四", "Th"), T("五", "Fr"), T("六", "Sa"), T("日", "Su")];
				return h(
					"div",
					{ className: "dsha_days" },
					names.map((name, index) => {
						const day = index + 1;
						return h(
							"button",
							{
								key: day,
								type: "button",
								className: "dsha_day",
								"aria-pressed": selected.includes(day),
								onClick: () => onChange(selected.includes(day) ? selected.filter((entry) => entry !== day) : [...selected, day].sort((a, b) => a - b)),
							},
							name,
						);
					}),
				);
			}
			return h("input", { id, className: "dsha_input", type: "text", value: String(value ?? ""), placeholder: field.placeholder ?? "", onChange: (event) => onChange(event.target.value) });
		}

		/**
		 * A field row (label + control + hint).
		 *
		 * @param {{field: object, value: unknown, onChange: (value: unknown) => void, wide?: boolean}} props
		 */
		function FieldRow({ field, value, onChange, wide }) {
			return h(
				"div",
				{ className: `dsha_field${wide === true ? " wide" : ""}` },
				h("label", { className: "dsha_label", htmlFor: `dsha-${field.key}` }, fieldLabel(field)),
				h(FieldControl, { field, value, onChange }),
				field.hint ? h("span", { className: "dsha_hint" }, field.hint) : null,
			);
		}

		/** Section heading inside the editor. */
		function FormGroup({ title, children }) {
			return h("div", { className: "dsha_field wide", style: { gap: "8px" } }, h("span", { className: "dsha_label", style: { fontWeight: 600, color: "inherit" } }, title), children);
		}
		//#endregion

		//#region editor
		/**
		 * The rule editor modal.
		 *
		 * @param {{draft: object, setDraft: Function, catalog: object, saving: boolean, testResult: object|null, error: string, onClose: Function, onSave: Function, onTest: Function}} props
		 */
		function Editor(props) {
			const { draft, setDraft, catalog, saving, testResult, error, onClose, onSave, onTest } = props;
			const triggerSpec = useMemo(() => (catalog?.triggers ?? []).find((entry) => entry.type === draft.triggerType), [catalog, draft.triggerType]);
			const actionSpec = useMemo(() => (catalog?.actions ?? []).find((entry) => entry.type === draft.actionType), [catalog, draft.actionType]);

			useEffect(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);

			const patch = (changes) => setDraft({ ...draft, ...changes });
			const patchTrigger = (key, value) => setDraft({ ...draft, trigger: { ...draft.trigger, [key]: value } });
			const patchAction = (key, value) => setDraft({ ...draft, action: { ...draft.action, [key]: value } });
			const canSave = String(draft.name ?? "").trim() !== "";

			return h(
				"div",
				{
					className: "dsha_backdrop",
					role: "presentation",
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) onClose();
					},
				},
				h(
					"div",
					{ className: "dsha_modal", role: "dialog", "aria-modal": "true", "aria-label": T("编辑自动化规则", "Edit automation rule") },
					h("h3", { className: "dsha_modaltitle" }, draft.id === "" ? T("新建自动化规则", "New automation") : T("编辑自动化规则", "Edit automation")),
					h("p", { className: "dsha_modalsub" }, T("选一个时机，再选它要做的事。命令在宿主进程里以非交互方式运行。", "Pick a moment, then what it should do. Commands run non-interactively in the host process.")),

					h(
						"div",
						{ className: "dsha_grid" },
						h(FieldRow, { wide: true, field: { key: "name", label: "名称", labelEn: "Name", type: "text", placeholder: T("例如：开机预热本地模型", "e.g. Warm up the local model on boot") }, value: draft.name, onChange: (value) => patch({ name: value }) }),

						h(
							"div",
							{ className: "dsha_field" },
							h("label", { className: "dsha_label" }, T("触发时机", "Trigger")),
							h("select", { className: "dsha_select", value: draft.triggerType, onChange: (event) => patch({ triggerType: event.target.value }) }, (catalog?.triggers ?? []).map((entry) => h("option", { key: entry.type, value: entry.type }, catalogLabel(entry)))),
							triggerSpec ? h("span", { className: "dsha_hint" }, catalogHint(triggerSpec)) : null,
						),
						h(
							"div",
							{ className: "dsha_field" },
							h("label", { className: "dsha_label" }, T("动作", "Action")),
							h("select", { className: "dsha_select", value: draft.actionType, onChange: (event) => patch({ actionType: event.target.value }) }, (catalog?.actions ?? []).map((entry) => h("option", { key: entry.type, value: entry.type }, catalogLabel(entry)))),
							actionSpec ? h("span", { className: "dsha_hint" }, catalogHint(actionSpec)) : null,
						),

						(triggerSpec?.fields ?? []).map((field) => h(FieldRow, { key: `t-${field.key}`, field, value: draft.trigger[field.key], onChange: (value) => patchTrigger(field.key, value), wide: field.type === "weekdays" })),
						h("div", { className: "dsha_field wide", style: { height: 1, background: "var(--dsw-alias-border-l1, rgba(127,127,127,.22))" } }),
						(actionSpec?.fields ?? []).map((field) => h(FieldRow, {
							key: `a-${field.key}`,
							field,
							value: draft.action[field.key],
							onChange: (value) => patchAction(field.key, value),
							wide: field.type === "textarea",
						})),

						h(
							"div",
							{ className: "dsha_field" },
							h("label", { className: "dsha_label" }, T("冷却时间（秒）", "Cooldown (seconds)")),
							h("input", { className: "dsha_input", type: "number", min: 0, max: 86400, value: String(draft.cooldownSeconds ?? 0), onChange: (event) => patch({ cooldownSeconds: Number(event.target.value) || 0 }) }),
							h("span", { className: "dsha_hint" }, T("两次运行的最小间隔；0 表示不限制", "Minimum gap between runs; 0 means none")),
						),
						h(
							"div",
							{ className: "dsha_field" },
							h("label", { className: "dsha_label" }, T("启用", "Enabled")),
							h("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" } },
								h("input", { type: "checkbox", checked: draft.enabled !== false, onChange: (event) => patch({ enabled: event.target.checked }) }),
								T("保存后立即生效", "Active as soon as it is saved"),
							),
						),
					),

					error ? h("div", { className: "dsha_err", role: "alert" }, error) : null,

					testResult
						? h(
							"div",
							{ className: "dsha_testres" },
							h("div", { className: "dsha_testhead" },
								h("span", { className: "dsha_dot", "data-status": testResult.status }),
								h("b", null, T("试运行", "Test run")),
								h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, `${statusLabel(testResult.status)} · ${fmtDuration(testResult.durationMs)} · ${T("退出码", "exit")} ${testResult.exitCode ?? "-"}`),
							),
							h("pre", { className: "dsha_pre" }, testResult.output || testResult.error || T("（无输出）", "(no output)")),
						)
						: null,

					h(
						"div",
						{ className: "dsha_footer" },
						h("button", { type: "button", className: "dsha_btn ghost", onClick: onClose, disabled: saving }, T("取消", "Cancel")),
						h("button", { type: "button", className: "dsha_btn", onClick: onTest, disabled: saving || !canSave }, T("试运行", "Test")),
						h("span", { className: "dsha_grow" }),
						h("button", { type: "button", className: "dsha_btn primary", onClick: onSave, disabled: saving || !canSave }, saving ? T("保存中…", "Saving…") : T("保存", "Save")),
					),
				),
			);
		}
		//#endregion

		//#region rules list
		/**
		 * One rule card.
		 *
		 * @param {{rule: object, catalog: object, busyId: string, onRun: Function, onEdit: Function, onDelete: Function, onToggle: Function}} props
		 */
		function RuleCard({ rule, catalog, busyId, onRun, onEdit, onDelete, onToggle }) {
			const spec = (catalog?.triggers ?? []).find((entry) => entry.type === rule.trigger.type);
			const last = rule.lastRun;
			return h(
				"div",
				{ className: "dsha_card", "data-off": rule.enabled === false ? "true" : "false", "data-rule-id": rule.id },
				h("div", { className: "dsha_glyph" }, h(TriggerGlyph, { type: rule.trigger.type })),
				h(
					"div",
					{ className: "dsha_cardmain" },
					h("div", { className: "dsha_cardtitle" },
						h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, rule.name),
						h("span", { className: "dsha_badge" }, catalogLabel(spec)),
					),
					h("div", { className: "dsha_cardline", title: rule.actionSummary }, ZH ? rule.triggerSummary : rule.triggerSummaryEn, h("span", { style: { opacity: 0.5 } }, " · "), ZH ? rule.actionSummary : rule.actionSummaryEn),
					h(
						"div",
						{ className: "dsha_cardmeta" },
						last
							? h(React.Fragment, null,
								h("span", { className: "dsha_dot", "data-status": last.status, style: { display: "inline-block", marginRight: 6, verticalAlign: "middle" } }),
								`${statusLabel(last.status)} · ${fmtRelative(last.at)} · ${T("累计", "total")} ${rule.runCount ?? 0}`,
							)
							: T("尚未运行", "Never ran"),
					),
				),
				h(
					"div",
					{ className: "dsha_cardactions" },
					h("button", { type: "button", className: "dsha_switch", role: "switch", "aria-checked": rule.enabled !== false, "aria-label": T("启用或停用", "Enable or disable"), onClick: () => onToggle(rule) }),
					h("button", { type: "button", className: "dsha_btn ghost", title: T("立即运行", "Run now"), disabled: busyId === rule.id, onClick: () => onRun(rule) }, busyId === rule.id ? T("运行中…", "Running…") : h(React.Fragment, null, h(PlayGlyph), T("运行", "Run"))),
					h("button", { type: "button", className: "dsha_btn ghost", title: T("编辑", "Edit"), onClick: () => onEdit(rule) }, T("编辑", "Edit")),
					h("button", { type: "button", className: "dsha_btn ghost danger", title: T("删除", "Delete"), onClick: () => onDelete(rule) }, h(TrashGlyph)),
				),
			);
		}
		//#endregion

		//#region panel
		/** @param {object | undefined} locale - client locale service. @returns {string} active locale id. */
		function readActiveLocale(locale) {
			try {
				return String(locale?.getSnapshot?.()?.active ?? locale?.getLocale?.()?.active ?? "");
			} catch {
				return "";
			}
		}

		/** Sidebar-selected page. */
		function Panel(props) {
			const locale = props?.locale;
			const [view, setView] = useState(null);
			const [localeId, setLocaleId] = useState(() => readActiveLocale(locale) || FALLBACK_LANG);

			useEffect(() => {
				const sync = () => {
					const next = readActiveLocale(locale) || FALLBACK_LANG;
					applyLocaleId(next);
					setLocaleId(next);
				};
				sync();
				const off = typeof locale?.subscribe === "function" ? locale.subscribe(sync) : null;
				return () => {
					if (typeof off === "function") off();
				};
			}, [locale]);
			const [loadError, setLoadError] = useState("");
			const [draft, setDraft] = useState(null);
			const [saving, setSaving] = useState(false);
			const [modalError, setModalError] = useState("");
			const [testResult, setTestResult] = useState(null);
			const [busyId, setBusyId] = useState("");
			const [toast, setToast] = useState(null);
			const [openRun, setOpenRun] = useState("");
			const [tab, setTab] = useState(() => {
				try {
					return window.localStorage.getItem("dsha.tab") === "runs" ? "runs" : "rules";
				} catch {
					return "rules";
				}
			});
			const toastTimer = useRef(null);

			/** @param {"rules"|"runs"} next - tab to activate. */
			const switchTab = useCallback((next) => {
				setTab(next);
				try {
					window.localStorage.setItem("dsha.tab", next);
				} catch {
					/* storage may be unavailable */
				}
			}, []);

			/** @param {string} message - toast text. @param {string} [kind] - error|info. */
			const notify = useCallback((message, kind = "info") => {
				setToast({ message, kind });
				if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
				toastTimer.current = window.setTimeout(() => setToast(null), 2600);
			}, []);

			useEffect(() => () => {
				if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
			}, []);

			const refresh = useCallback(async (silent) => {
				try {
					const next = await apiGet("/state");
					setView(next);
					setLoadError("");
				} catch (error) {
					if (silent !== true) setLoadError(error instanceof Error ? error.message : String(error));
				}
			}, []);

			useEffect(() => {
				void refresh(false);
				const timer = window.setInterval(() => {
					if (document.hidden !== true) void refresh(true);
				}, POLL_MS);
				return () => window.clearInterval(timer);
			}, [refresh]);

			const defaultCwd = typeof view?.defaultCwd === "string" ? view.defaultCwd : "";

			const openEditor = useCallback((rule) => {
				let next;
				if (rule === null || rule === undefined) {
					next = emptyDraft();
					if (defaultCwd !== "") next = { ...next, action: { ...next.action, cwd: defaultCwd } };
				} else {
					next = draftFromRule(rule);
				}
				setDraft(next);
				setModalError("");
				setTestResult(null);
			}, [defaultCwd]);

			const saveDraft = useCallback(async () => {
				if (draft === null) return;
				setSaving(true);
				setModalError("");
				try {
					const result = await apiPost("/rules", { rule: payloadFromDraft(draft) });
					setView(result.state);
					setDraft(null);
					notify(T("规则已保存", "Rule saved"));
				} catch (error) {
					setModalError(error instanceof Error ? error.message : String(error));
				} finally {
					setSaving(false);
				}
			}, [draft, notify]);

			const testDraft = useCallback(async () => {
				if (draft === null) return;
				setSaving(true);
				setModalError("");
				try {
					const result = await apiPost("/test", { rule: payloadFromDraft(draft) });
					setTestResult(result.run);
				} catch (error) {
					setModalError(error instanceof Error ? error.message : String(error));
				} finally {
					setSaving(false);
				}
			}, [draft]);

			const toggleRule = useCallback(async (rule) => {
				try {
					const result = await apiPost("/rules/toggle", { id: rule.id, enabled: rule.enabled === false });
					setView(result.state);
				} catch (error) {
					notify(error instanceof Error ? error.message : String(error), "error");
				}
			}, [notify]);

			const runRule = useCallback(async (rule) => {
				setBusyId(rule.id);
				try {
					const result = await apiPost("/run", { id: rule.id });
					setView(result.state);
					const run = result.run;
					notify(`${rule.name}：${statusLabel(run.status)} · ${fmtDuration(run.durationMs)}`, run.status === "ok" ? "info" : "error");
					setOpenRun(run.id);
				} catch (error) {
					notify(error instanceof Error ? error.message : String(error), "error");
				} finally {
					setBusyId("");
				}
			}, [notify]);

			const deleteRule = useCallback(async (rule) => {
				const ok = window.confirm(T(`删除「${rule.name}」？`, `Delete "${rule.name}"?`));
				if (!ok) return;
				try {
					const result = await apiPost("/rules/delete", { id: rule.id });
					setView(result.state);
					notify(T("已删除", "Deleted"));
				} catch (error) {
					notify(error instanceof Error ? error.message : String(error), "error");
				}
			}, [notify]);

			const rules = view?.rules ?? [];
			const runs = view?.runs ?? [];
			const stats = view?.stats ?? { total: 0, enabled: 0, runsToday: 0, lastRunAt: null, busy: 0 };
			const catalog = view?.catalog ?? { triggers: [], actions: [] };
			/** @param {string} type - trigger type. @returns {string} localised trigger name. */
			const triggerNameOf = (type) => {
				const spec = (catalog.triggers ?? []).find((entry) => entry.type === type);
				return spec ? catalogLabel(spec) : String(type ?? "");
			};

			const templates = useMemo(() => [
				{
					key: "startup-log",
					title: T("DSH 启动时记录", "Log on DSH startup"),
					desc: T("往 ~\\dsh-boot.log 追加一行启动时间", "Append the boot time to ~\\dsh-boot.log"),
					build: () => ({
						...emptyDraft(),
						name: T("DSH 启动记录", "DSH boot log"),
						triggerType: "startup",
						trigger: { ...emptyDraft().trigger, delayMs: 2000 },
						actionType: "shell",
						action: { ...emptyDraft().action, command: 'Write-Output "DSH started $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 "$env:USERPROFILE\\dsh-boot.log"', shell: "powershell", timeoutMs: 15000 },
					}),
				},
				{
					key: "daily-health",
					title: T("每天 08:30 健康检查", "Daily 08:30 health check"),
					desc: T("GET 一个本地服务地址（改成你自己的）", "GET a local service URL (edit it)"),
					build: () => ({
						...emptyDraft(),
						name: T("本地服务探活", "Local service health"),
						triggerType: "daily",
						trigger: { ...emptyDraft().trigger, time: "08:30", weekdays: [] },
						actionType: "http",
						action: { ...emptyDraft().action, url: "http://127.0.0.1:8080/health", method: "GET", timeoutMs: 10000 },
					}),
				},
				{
					key: "idle-log",
					title: T("会话空闲 10 分钟", "Session idle for 10 min"),
					desc: T("空闲时写一条运行记录，验证时机是否命中", "Write a run-log entry to verify the timing"),
					build: () => ({
						...emptyDraft(),
						name: T("空闲记录", "Idle marker"),
						triggerType: "session-idle",
						trigger: { ...emptyDraft().trigger, idleSeconds: 600 },
						actionType: "log",
						action: { ...emptyDraft().action, message: T("会话已空闲 10 分钟", "Session idle for 10 minutes") },
					}),
				},
			], [localeId]);

			if (view === null) {
				return h("div", { className: "dsha_root" }, h("div", { className: "dsha_inner" },
					loadError
						? h("div", { className: "dsha_empty", role: "alert" }, T("无法连接自动化服务：", "Cannot reach the automation service: ") + loadError)
						: h("div", { className: "dsha_loading" }, T("正在加载自动化规则…", "Loading automations…")),
				));
			}

			return h(
				"div",
				{ className: "dsha_root", "data-panel": PANEL_ID },
				h(
					"div",
					{ className: "dsha_inner" },
					h(
						"div",
						{ className: "dsha_head" },
						h("div", null,
							h("h1", { className: "dsha_h1" }, T("生命周期自动化", "Automations")),
							h("p", { className: "dsha_sub" }, T("在 DSH 生命周期与时机点自动执行命令、HTTP 请求或记录。", "Run a command, HTTP request or log line at DSH lifecycle moments.")),
						),
						h("button", { type: "button", className: "dsha_btn primary", onClick: () => { switchTab("rules"); openEditor(null); } }, T("＋ 新建规则", "+ New rule")),
					),
					loadError ? h("div", { className: "dsha_err", role: "alert" }, loadError) : null,

					h(
						"div",
						{ className: "dsha_stats" },
						h("div", { className: "dsha_stat" }, h("b", null, String(stats.total)), h("span", null, T("规则总数", "Rules"))),
						h("div", { className: "dsha_stat" }, h("b", null, String(stats.enabled)), h("span", null, T("已启用", "Enabled"))),
						h("div", { className: "dsha_stat" }, h("b", null, String(stats.runsToday)), h("span", null, T("今日运行", "Runs today"))),
						h("div", { className: "dsha_stat" }, h("b", null, stats.lastRunAt ? fmtClock(stats.lastRunAt) : "—"), h("span", null, stats.lastRunAt ? fmtRelative(stats.lastRunAt) : T("最近运行", "Last run"))),
					),

					h(
						"div",
						{ className: "dsha_tabs", role: "tablist" },
						h("button", { type: "button", className: "dsha_tab", role: "tab", "aria-selected": tab === "rules", onClick: () => switchTab("rules") },
							T("规则", "Rules"), h("span", { className: "dsha_badge" }, String(rules.length))),
						h("button", { type: "button", className: "dsha_tab", role: "tab", "aria-selected": tab === "runs", onClick: () => switchTab("runs") },
							T("运行", "Runs"), h("span", { className: "dsha_badge" }, String(runs.length))),
					),

					tab === "rules"
						? h(
							"div",
							{ className: "dsha_section", role: "tabpanel" },
							rules.length === 0
								? h("div", { className: "dsha_empty" },
									h("div", null, T("还没有自动化规则。从一个模板开始：", "No automations yet. Start from a template:")),
									h("div", { className: "dsha_tpls" },
										templates.map((template) => h("button", { key: template.key, type: "button", className: "dsha_tpl", onClick: () => setDraft(template.build()) },
											h("b", null, template.title),
											h("span", null, template.desc),
										)),
									),
								)
								: rules.map((rule) => h(RuleCard, { key: rule.id, rule, catalog, busyId, onRun: runRule, onEdit: openEditor, onDelete: deleteRule, onToggle: toggleRule })),
						)
						: h(
							"div",
							{ className: "dsha_section", role: "tabpanel" },
							runs.length === 0
								? h("div", { className: "dsha_empty" }, T("还没有运行记录。去「规则」页点一次「运行」试试。", "No runs yet. Use “Run” on a rule to try one."))
								: h("div", { className: "dsha_runs" },
									runs.map((run) => h(
										"div",
										{ key: run.id, className: "dsha_runbox" },
										h("div", { className: "dsha_runrow", role: "button", tabIndex: 0, onClick: () => setOpenRun(openRun === run.id ? "" : run.id), onKeyDown: (event) => { if (event.key === "Enter") setOpenRun(openRun === run.id ? "" : run.id); } },
											h("span", { className: "dsha_runat" }, fmtClock(run.at)),
											h("span", { className: "dsha_runname", title: run.ruleName }, run.ruleName),
											h("span", { className: "dsha_badge" }, triggerNameOf(run.trigger)),
											h("span", { className: "dsha_grow" }),
											h("span", { className: "dsha_runstatus", "data-status": run.status }, statusLabel(run.status)),
											h("span", { className: "dsha_rundur" }, fmtDuration(run.durationMs)),
										),
										openRun === run.id
											? h(React.Fragment, null,
												h("div", { className: "dsha_runmeta" },
													T("触发：", "Trigger: ") + triggerNameOf(run.trigger)
													+ T(" · 退出码 ", " · exit ") + (run.exitCode ?? "-")
													+ (run.error ? " · " + run.error : ""),
												),
												h("pre", { className: "dsha_pre" }, run.output || T("（无输出）", "(no output)")),
											)
											: null,
									)),
								),
						),

					h("p", { className: "dsha_sub", style: { marginTop: 22, fontSize: 11.5 } },
						T("规则保存在 ", "Rules live in ") + (view.stateDir ?? "") + T("；宿主启动于 ", "; host booted ") + fmtClock(view.bootedAt) + T("。", "."),
					),
				),

				draft !== null
					? h(Editor, {
						draft,
						setDraft,
						catalog,
						saving,
						testResult,
						error: modalError,
						onClose: () => { setDraft(null); setTestResult(null); setModalError(""); },
						onSave: saveDraft,
						onTest: testDraft,
					})
					: null,

				toast !== null
					? h("div", { className: "dsha_toast", "data-kind": toast.kind, role: "status" }, toast.message)
					: null,
			);
		}
		//#endregion

		//#region apply
		const inject = ["slots", "locale"];

		/**
		 * Register the rail entry and the page it opens.
		 *
		 * @param {object} ctx - client root context.
		 */
		function apply(ctx) {
			const locale = ctx.locale;
			applyLocaleId(readActiveLocale(locale) || FALLBACK_LANG);
			ctx.slots.inject("main", () => ctx.slots.register(
				{ name: "main", key: PANEL_ID, inject: () => ({ locale }) },
				Panel,
			));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
				{ name: "sidebar.panellist", id: PANEL_ID, order: 30, label: () => T("生命周期自动化", "Automations") },
				AutomationIcon,
			));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		/** Test seam for the bundle self-check. */
		exports.__test__ = { PANEL_ID, API, emptyDraft, draftFromRule, payloadFromDraft, T };

		return module.exports;
	},
});
