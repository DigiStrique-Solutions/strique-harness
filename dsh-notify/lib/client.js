// dsh-notify - browser half.
//
// Notifies the user through the browser when a DeepSeek Harness run finishes
// ("done") or when the agent needs user input ("question" / plan review /
// permission approval). Each event fires a Notification (when permitted) and a
// synthesized Web-Audio chime; the two event classes use clearly different
// sounds so they can be told apart without looking at the screen.
//
// Signal source: the sessions service's live list snapshot (`ctx.sessions.list`)
// and the uiSession status snapshot (`ctx.uiSession.sessionStatus`).
//   - done:     a top-level session's `running` bit flips true -> false
//   - question: a session's `pendingInteraction` in the status snapshot
//               publishes a new request key
// Subagent sessions are excluded from the done signal - only a top-level
// session's completion ends a user-visible run.
//
// Settings (Settings > Notifications): enable/disable the whole feature,
// sound on/off, volume, one sound preset per event class, and a "background
// only" mode. A "test" button per sound and a test-notification button are
// included, plus a notification-permission request button.
//
// Persistence: preferences live in localStorage (self-contained, works on any
// browser, survives host updates). When the native settings form exposes
// this namespace (via the Harness settings service), writes
// are additionally mirrored into the Host profile configuration via
// `ctx.configForms` - best effort, never required.
window.__ModuleLoader__.load({
	id: "dsh-notify",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		function createRuntime() {
			//#region styles
			const css = ".dn_sec{display:flex;flex-direction:column;gap:16px;max-width:600px}.dn_field{display:flex;flex-direction:column;gap:6px}.dn_label{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}.dn_hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}.dn_check{display:flex;align-items:center;gap:8px;cursor:pointer}.dn_check input[type=checkbox]{width:16px;height:16px;margin:0;flex:none;accent-color:var(--dsw-alias-accent,#4d6bfe);cursor:pointer}.dn_check input[type=checkbox]:disabled{opacity:.5;cursor:default}.dn_inline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dn_select{min-width:180px;font-size:13px;line-height:20px;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-strong);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}.dn_select:disabled{opacity:.5;cursor:default}.dn_range{flex:none;width:220px;accent-color:var(--dsw-alias-accent,#4d6bfe);cursor:pointer}.dn_vol{font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);min-width:36px;font-variant-numeric:tabular-nums}.dn_actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.dn_perm{font-size:12px;line-height:18px;font-weight:600}.dn_permOk{color:var(--dsw-alias-ok,#3aa675)}.dn_permBad{color:var(--dsw-alias-danger,#e5484d)}.dn_permNeutral{color:var(--dsw-alias-label-secondary)}.dn_permValue{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.dn_tag{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}";
			const tagId = "dsh-notify/notify.css";
			function installStyle(ctx) {
				ctx.effect(() => {
					const tag = document.createElement("style");
					tag.dataset.plugin = "dsh-notify";
					tag.dataset.pluginCss = tagId;
					tag.textContent = css;
					document.head.appendChild(tag);
					return () => tag.remove();
				}, "dsh-notify: styles");
			}
			const c = {
				sec: "dn_sec", field: "dn_field", label: "dn_label", hint: "dn_hint",
				check: "dn_check", inline: "dn_inline", select: "dn_select",
				range: "dn_range", vol: "dn_vol", actions: "dn_actions",
				perm: "dn_perm", permOk: "dn_permOk", permBad: "dn_permBad",
				permNeutral: "dn_permNeutral", permValue: "dn_permValue", tag: "dn_tag"
			};
			//#endregion
			//#region constants
			const NS = "dsh-notify";
			const LOCALE_NS = "notify";
			const DEFAULT_VOLUME = 60;
			/** Coalesce back-to-back "done" transitions of the same session (goal-round edges). */
			const DONE_DEBOUNCE_MS = 2500;
			/** localStorage key holding the preference object. */
			const STORE_KEY = "dsh-notify/settings/v1";
			/** Preference defaults (mirror of the host schema defaults). */
			const DEFAULTS = {
				enabled: true,
				soundEnabled: true,
				volume: DEFAULT_VOLUME,
				doneSound: "chime",
				questionSound: "triple",
				onlyWhenHidden: false
			};
			//#endregion
			//#region locales
			const en = {
				"section.nav": "Notifications",
				"sec.enabled": "Enable notifications & chimes",
				"sec.enabled.hint": "Get a browser notification (plus a chime) when a run finishes or when your input is needed - answering a question, reviewing a plan, or approving an action.",
				"sec.sound": "Sound",
				"sec.sound.hint": "When off, only the notification is shown - no sound.",
				"sec.volume": "Volume",
				"sec.done": "Done chime",
				"sec.done.hint": "Played when a run ends (soft ascending arpeggio).",
				"sec.question": "Question chime",
				"sec.question.hint": "Played when your input is needed (urgent triple beep) - clearly distinct from the done chime.",
				"sound.chime": "Ascending arpeggio (soft)",
				"sound.cascade": "Descending arpeggio (bright)",
				"sound.triple": "Triple beep (urgent)",
				"sound.pulse": "Double pulse (bright)",
				"sec.onlyHidden": "Only alert while in another window/tab",
				"sec.onlyHidden.hint": "Stay quiet while this page is in the foreground; alert once you switch away.",
				"sec.permission": "Browser notification permission",
				"sec.permission.granted": "Granted",
				"sec.permission.denied": "Denied - re-enable notifications for this site in the browser's site settings",
				"sec.permission.default": "Not granted yet",
				"sec.permission.unsupported": "This browser does not support notifications",
				"sec.permission.request": "Request permission",
				"sec.test": "Listen & test",
				"sec.test.done": "Play done chime",
				"sec.test.question": "Play question chime",
				"sec.test.notify": "Send test notification",
				"sec.audioHint": "Browsers only allow sound after a user gesture: click anywhere on the page once, then chimes will play.",
				"notify.done.title": "DeepSeek Harness · Run finished",
				"notify.done.body": "“{title}” has finished running.",
				"notify.question.title": "DeepSeek Harness · Input needed",
				"notify.question.body": "“{title}” is waiting for your answer.",
				"notify.plan.body": "“{title}” is waiting for you to review the plan.",
				"notify.approval.body": "“{title}” is waiting for your approval.",
				"notify.test.body": "This is a test notification."
			};
			//#endregion
			//#region settings store
			/**
			* Self-contained preference store: localStorage-backed with defaults,
			* observable for React (useSyncExternalStore) and the watcher. Writes are
			* mirrored into the native settings form when it is available - best
			* effort; the store never depends on it.
			*/
			/** Normalize a raw preference object to the canonical shape (defaults fill gaps). */
			function sanitizeOptions(raw) {
				const v = raw !== null && typeof raw === "object" ? raw : {};
				return {
					enabled: v.enabled !== false,
					soundEnabled: v.soundEnabled !== false,
					volume: Number.isFinite(v.volume) ? Math.min(100, Math.max(0, v.volume)) : DEFAULT_VOLUME,
					doneSound: v.doneSound === "cascade" ? "cascade" : "chime",
					questionSound: v.questionSound === "pulse" ? "pulse" : "triple",
					onlyWhenHidden: v.onlyWhenHidden === true
				};
			}
			function readLocal() {
				if (typeof localStorage === "undefined") return null;
				try {
					const raw = localStorage.getItem(STORE_KEY);
					if (raw === null) return null;
					const parsed = JSON.parse(raw);
					return parsed !== null && typeof parsed === "object" ? parsed : null;
				} catch (error) {
					return null;
				}
			}
			function writeLocal(value) {
				if (typeof localStorage === "undefined") return;
				try {
					localStorage.setItem(STORE_KEY, JSON.stringify(value));
				} catch (error) {
					/* storage full/blocked - the in-memory store still works for this tab */
				}
			}
			let storeState = sanitizeOptions(readLocal());
			const storeListeners = new Set();
			function getStoreSnapshot() {
				return storeState;
			}
			function subscribeStore(listener) {
				storeListeners.add(listener);
				return () => {
					storeListeners.delete(listener);
				};
			}
			/** The bound native settings form (mirror target), set by apply(). */
			let mirrorScope = null;
			/** Write one field to the store, persist, notify, and mirror. */
			function setStore(field, value) {
				const next = sanitizeOptions({ ...storeState, [field]: value });
				storeState = next;
				writeLocal(next);
				for (const fn of Array.from(storeListeners)) {
					try {
						fn();
					} catch (error) {
						/* a listener must never break the store */
					}
				}
				if (mirrorScope !== null) {
					try {
						Promise.resolve(mirrorScope.set(field, value)).catch(() => { /* local preferences remain available */ });
					} catch (error) {
						/* the native transport is best-effort only */
					}
				}
			}
			//#endregion
			//#region audio
			/** Web-Audio context (created lazily; browsers gate it behind a user gesture). */
			let audioCtx = null;
			/** Note tables per event class and preset. Frequencies in Hz, times in seconds. */
			const PATTERNS = {
				done: {
					chime: [
						{ f: 523.25, at: 0, dur: 0.55, type: "sine" },
						{ f: 659.25, at: 0.16, dur: 0.55, type: "sine" },
						{ f: 783.99, at: 0.32, dur: 0.8, type: "sine" }
					],
					cascade: [
						{ f: 783.99, at: 0, dur: 0.4, type: "sine" },
						{ f: 659.25, at: 0.14, dur: 0.4, type: "sine" },
						{ f: 523.25, at: 0.28, dur: 0.7, type: "sine" }
					]
				},
				question: {
					triple: [
						{ f: 880, at: 0, dur: 0.1, type: "square" },
						{ f: 880, at: 0.18, dur: 0.1, type: "square" },
						{ f: 1174.66, at: 0.36, dur: 0.2, type: "square" }
					],
					pulse: [
						{ f: 987.77, at: 0, dur: 0.09, type: "triangle" },
						{ f: 987.77, at: 0.12, dur: 0.09, type: "triangle" },
						{ f: 1318.51, at: 0.24, dur: 0.13, type: "triangle" },
						{ f: 1318.51, at: 0.38, dur: 0.13, type: "triangle" }
					]
				}
			};
			/** Create (or resume) the shared AudioContext; null when unavailable. */
			function ensureAudioContext() {
				if (typeof window === "undefined") return null;
				const AC = window.AudioContext || (typeof window.webkitAudioContext !== "undefined" ? window.webkitAudioContext : null);
				if (AC === null || typeof AC !== "function") return null;
				if (audioCtx === null) {
					try {
						audioCtx = new AC();
					} catch (error) {
						return null;
					}
				}
				if (audioCtx.state === "suspended") {
					audioCtx.resume().catch(() => {});
				}
				return audioCtx;
			}
			/** Prime the audio context from the first user gesture (autoplay policy). */
			const PRIME_EVENTS = ["pointerdown", "keydown", "click", "touchstart"];
			let primeAttached = false;
			function primeAudio() {
				const ctx = ensureAudioContext();
				if (ctx !== null && ctx.state === "running") detachPrimeListeners();
			}
			function attachPrimeListeners() {
				if (primeAttached || typeof window === "undefined") return;
				primeAttached = true;
				for (const type of PRIME_EVENTS) window.addEventListener(type, primeAudio, { passive: true });
			}
			function detachPrimeListeners() {
				if (!primeAttached || typeof window === "undefined") return;
				primeAttached = false;
				for (const type of PRIME_EVENTS) window.removeEventListener(type, primeAudio);
			}
			/** Play one note table through the master gain (volume 0-100). */
			function playPattern(pattern, volume) {
				const ctx = ensureAudioContext();
				if (ctx === null || !Array.isArray(pattern) || pattern.length === 0) return;
				const level = (Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : DEFAULT_VOLUME) / 100;
				if (level <= 0) return;
				try {
					const master = ctx.createGain();
					master.gain.value = level;
					master.connect(ctx.destination);
					const start = ctx.currentTime + 0.02;
					for (const note of pattern) {
						if (!note || typeof note.f !== "number") continue;
						const osc = ctx.createOscillator();
						osc.type = typeof note.type === "string" ? note.type : "sine";
						osc.frequency.value = note.f;
						const gain = ctx.createGain();
						const t0 = start + (Number.isFinite(note.at) ? note.at : 0);
						const dur = Number.isFinite(note.dur) && note.dur > 0 ? note.dur : 0.3;
						gain.gain.setValueAtTime(0.0001, t0);
						gain.gain.exponentialRampToValueAtTime(0.9, t0 + 0.012);
						gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
						osc.connect(gain);
						gain.connect(master);
						osc.start(t0);
						osc.stop(t0 + dur + 0.03);
					}
				} catch (error) {
					/* never let audio failures break the UI */
				}
			}
			/** Play the chosen "done" preset. */
			function playDoneSound(sound, volume) {
				const table = PATTERNS.done;
				playPattern(table[sound] || table.chime, volume);
			}
			/** Play the chosen "question" preset. */
			function playQuestionSound(sound, volume) {
				const table = PATTERNS.question;
				playPattern(table[sound] || table.triple, volume);
			}
			//#endregion
			//#region notifications
			/** Whether the browser exposes the Notifications API. */
			function notifySupported() {
				return typeof window !== "undefined" && typeof Notification !== "undefined";
			}
			/** Current permission: "granted" | "denied" | "default" | "unsupported". */
			function notifyPermission() {
				return notifySupported() ? Notification.permission : "unsupported";
			}
			/** Ask the user for notification permission (must run from a user gesture). */
			function requestNotifyPermission() {
				if (!notifySupported()) return Promise.resolve("unsupported");
				try {
					return Promise.resolve(Notification.requestPermission());
				} catch (error) {
					return Promise.resolve("denied");
				}
			}
			/** Show a notification (silent - our chime is the sound). */
			function sendNotification(title, body, tag) {
				if (!notifySupported() || Notification.permission !== "granted") return;
				try {
					new Notification(title, { body, tag, silent: true });
				} catch (error) {
					/* older engines may reject some options - ignore */
				}
			}
			//#endregion
			//#region watcher
			/**
			* Watch the sessions list snapshot and dispatch events on transitions:
			*   done     - `running` true→false on a non-subagent session (debounced)
			*   question: a session's `pendingInteraction` publishes a new request key
			* @param sessions - the `ctx.sessions.list` observable snapshot.
			* @param interactions - the `ctx.uiSession.sessionStatus` observable
			*   (a Map of sessionId → { running, pendingInteraction, completionUnread }).
			* @param getOptions - current plugin options (fresh per event).
			* @param t - locale-bound translator for notification copy.
			* @returns disposer.
			*/
			function startWatcher(sessions, interactions, getOptions, t) {
				/** Human-readable session name for notification bodies. */
				const describe = (s) => (s && typeof s.displayTitle === "string" && s.displayTitle !== "" ? s.displayTitle
					: s && typeof s.title === "string" && s.title !== "" ? s.title
					: s && typeof s.id === "string" ? s.id : "");
				/** Localized title/body for one event kind. */
				const copy = (kind, interaction) => {
					if (kind === "done") {
						return { title: t("notify.done.title"), body: t("notify.done.body") };
					}
					if (interaction === "approval") return { title: t("notify.question.title"), body: t("notify.approval.body") };
					if (interaction === "plan-review") return { title: t("notify.question.title"), body: t("notify.plan.body") };
					return { title: t("notify.question.title"), body: t("notify.question.body") };
				};
				/** Fire one event (notification + chime) unless suppressed by options.
				* @returns whether the event was actually dispatched. */
				const dispatch = (kind, session, interaction) => {
					const opts = getOptions();
					if (!opts.enabled) return false;
					if (opts.onlyWhenHidden && typeof document !== "undefined" && document.visibilityState === "visible") return false;
					const name = describe(session);
					const { title, body } = copy(kind, interaction);
					const text = String(body).split("{title}").join(name);
					if (kind === "done") {
						if (opts.soundEnabled) playDoneSound(opts.doneSound, opts.volume);
						sendNotification(title, text, "dsh-notify-done-" + (session && session.id ? session.id : ""));
					} else {
						if (opts.soundEnabled) playQuestionSound(opts.questionSound, opts.volume);
						sendNotification(title, text, "dsh-notify-question-" + (session && session.id ? session.id : ""));
					}
					return true;
				};
				const last = new Map();
				const lastDoneAt = new Map();
				let lastPending = new Map();
				const handle = () => {
					const { byId } = sessions.getSnapshot();
					const now = Date.now();
					for (const [id, session] of Object.entries(byId)) {
						if (last.get(id) === true && !session.running && session.origin !== "subagent") {
							if (now - (lastDoneAt.get(id) || 0) > DONE_DEBOUNCE_MS && dispatch("done", session)) {
								lastDoneAt.set(id, now);
							}
						}
						last.set(id, session.running);
					}
					for (const id of last.keys()) {
						if (!(id in byId)) { last.delete(id); lastDoneAt.delete(id); }
					}
				};
				const handlePending = () => {
					const status = interactions.getSnapshot();
					const { byId } = sessions.getSnapshot();
					const next = new Map();
					for (const [id, entry] of status) {
						const interaction = entry && entry.pendingInteraction;
						if (!interaction || !["approval", "question", "plan-review"].includes(interaction.kind)) continue;
						next.set(id, interaction.key);
						if (lastPending.get(id) !== interaction.key) {
							dispatch("question", byId[id] || { id }, interaction.kind);
						}
					}
					lastPending = next;
				};
				const unsubscribe = sessions.subscribe(handle);
				const unsubscribePending = interactions.subscribe(handlePending);
				handle();
				handlePending();
				return () => {
					unsubscribe();
					unsubscribePending();
				};
			}
			//#endregion
			//#region settings section
			/** The Notifications settings page (native controls, immediate writes). */
			function NotifySection({ t }) {
				const settings = react.useSyncExternalStore(subscribeStore, getStoreSnapshot);
				const enabled = settings.enabled !== false;
				const soundEnabled = settings.soundEnabled !== false;
				const volume = Number.isFinite(settings.volume) ? Math.min(100, Math.max(0, settings.volume)) : DEFAULT_VOLUME;
				const doneSound = settings.doneSound === "cascade" ? "cascade" : "chime";
				const questionSound = settings.questionSound === "pulse" ? "pulse" : "triple";
				const onlyWhenHidden = settings.onlyWhenHidden === true;
				const [perm, setPerm] = react.useState(notifyPermission);
				const refreshPerm = () => setPerm(notifyPermission());
				const onRequestPerm = () => {
					requestNotifyPermission().then(refreshPerm, refreshPerm);
				};
				const onTestDone = () => {
					playDoneSound(doneSound, volume);
				};
				const onTestQuestion = () => {
					playQuestionSound(questionSound, volume);
				};
				const onTestNotify = () => {
					sendNotification(t("notify.done.title"), t("notify.test.body"), "dsh-notify-test");
				};
				const permClass = perm === "granted" ? c.permOk : perm === "denied" ? c.permBad : c.permNeutral;
				const permLabel = perm === "granted" ? t("sec.permission.granted")
					: perm === "denied" ? t("sec.permission.denied")
					: perm === "unsupported" ? t("sec.permission.unsupported") : t("sec.permission.default");

				return (0, react_jsx_runtime.jsxs)("div", {
					className: c.sec,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.field,
							children: [
								(0, react_jsx_runtime.jsx)("label", {
									className: c.check,
									children: [
										(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: enabled,
											onChange: (event) => setStore("enabled", event.target.checked)
										}),
										(0, react_jsx_runtime.jsx)("span", { className: c.label, children: t("sec.enabled") })
									]
								}),
								(0, react_jsx_runtime.jsx)("div", { className: c.hint, children: t("sec.enabled.hint") })
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.field,
							children: [
								(0, react_jsx_runtime.jsx)("label", {
									className: c.check,
									children: [
										(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: soundEnabled,
											onChange: (event) => setStore("soundEnabled", event.target.checked)
										}),
										(0, react_jsx_runtime.jsx)("span", { className: c.label, children: t("sec.sound") })
									]
								}),
								(0, react_jsx_runtime.jsx)("div", { className: c.hint, children: t("sec.sound.hint") })
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.field,
							children: [
								(0, react_jsx_runtime.jsx)("div", { className: c.label, children: t("sec.volume") }),
								(0, react_jsx_runtime.jsxs)("div", {
									className: c.inline,
									children: [
										(0, react_jsx_runtime.jsx)("input", {
											type: "range",
											className: c.range,
											min: 0,
											max: 100,
											step: 5,
											value: volume,
											disabled: !soundEnabled,
											onChange: (event) => setStore("volume", Number(event.target.value))
										}),
										(0, react_jsx_runtime.jsx)("span", { className: c.vol, children: String(Math.round(volume)) + "%" })
									]
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.field,
							children: [
								(0, react_jsx_runtime.jsx)("div", { className: c.label, children: t("sec.done") }),
								(0, react_jsx_runtime.jsxs)("div", {
									className: c.inline,
									children: [
										(0, react_jsx_runtime.jsx)("select", {
											className: c.select,
											value: doneSound,
											disabled: !soundEnabled,
											onChange: (event) => setStore("doneSound", event.target.value),
											children: [
												(0, react_jsx_runtime.jsx)("option", { value: "chime", children: t("sound.chime") }),
												(0, react_jsx_runtime.jsx)("option", { value: "cascade", children: t("sound.cascade") })
											]
										}),
										(0, react_jsx_runtime.jsx)("span", { className: c.hint, children: t("sec.done.hint") })
									]
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.field,
							children: [
								(0, react_jsx_runtime.jsx)("div", { className: c.label, children: t("sec.question") }),
								(0, react_jsx_runtime.jsxs)("div", {
									className: c.inline,
									children: [
										(0, react_jsx_runtime.jsx)("select", {
											className: c.select,
											value: questionSound,
											disabled: !soundEnabled,
											onChange: (event) => setStore("questionSound", event.target.value),
											children: [
												(0, react_jsx_runtime.jsx)("option", { value: "triple", children: t("sound.triple") }),
												(0, react_jsx_runtime.jsx)("option", { value: "pulse", children: t("sound.pulse") })
											]
										}),
										(0, react_jsx_runtime.jsx)("span", { className: c.hint, children: t("sec.question.hint") })
									]
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.field,
							children: [
								(0, react_jsx_runtime.jsx)("label", {
									className: c.check,
									children: [
										(0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: onlyWhenHidden,
											onChange: (event) => setStore("onlyWhenHidden", event.target.checked)
										}),
										(0, react_jsx_runtime.jsx)("span", { className: c.label, children: t("sec.onlyHidden") })
									]
								}),
								(0, react_jsx_runtime.jsx)("div", { className: c.hint, children: t("sec.onlyHidden.hint") })
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.field,
							children: [
								(0, react_jsx_runtime.jsx)("div", { className: c.label, children: t("sec.permission") }),
								(0, react_jsx_runtime.jsxs)("div", {
									className: c.inline,
									children: [
										(0, react_jsx_runtime.jsx)("span", { className: c.perm + " " + permClass, children: permLabel }),
										perm === "default" || perm === "unsupported"
											? (0, react_jsx_runtime.jsx)(_primitives.Button, { variant: "outline", size: "sm", onClick: onRequestPerm, children: t("sec.permission.request") })
											: null
									]
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: c.field,
							children: [
								(0, react_jsx_runtime.jsx)("div", { className: c.label, children: t("sec.test") }),
								(0, react_jsx_runtime.jsxs)("div", {
									className: c.actions,
									children: [
										(0, react_jsx_runtime.jsx)(_primitives.Button, { variant: "outline", size: "sm", disabled: !soundEnabled, onClick: onTestDone, children: t("sec.test.done") }),
										(0, react_jsx_runtime.jsx)(_primitives.Button, { variant: "outline", size: "sm", disabled: !soundEnabled, onClick: onTestQuestion, children: t("sec.test.question") }),
										(0, react_jsx_runtime.jsx)(_primitives.Button, { variant: "outline", size: "sm", disabled: !enabled || perm !== "granted", onClick: onTestNotify, children: t("sec.test.notify") })
									]
								}),
								(0, react_jsx_runtime.jsx)("div", { className: c.hint, children: t("sec.audioHint") })
							]
						})
					]
				});
			}
			//#endregion
			//#region index
			/** Fresh option snapshot read off the localStorage-backed store. */
			function getOptions() {
				return getStoreSnapshot();
			}
			/**
			* Register the dictionaries, bind the optional settings mirror, start the
			* session watcher, and register the settings page on the owning fiber.
			* @param ctx - client root context.
			*/
			function apply(ctx) {
				installStyle(ctx);
				ctx.effect(() => ctx.locale.register(LOCALE_NS, { en }), "dsh-notify: dictionary");
				const t = ctx.locale.bind(LOCALE_NS);
				mirrorScope = ctx.configForms.get(NS);
				ctx.effect(() => {
					attachPrimeListeners();
					return () => {
						detachPrimeListeners();
						mirrorScope = null;
						if (audioCtx !== null) { void audioCtx.close().catch(() => {}); audioCtx = null; }
					};
				}, "dsh-notify: audio");
				ctx.effect(() => startWatcher(ctx.sessions.list, ctx.uiSession.sessionStatus, getOptions, t), "dsh-notify: watcher");
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "notify",
					order: 200,
					label: () => t("section.nav"),
					locale: LOCALE_NS
				}, (props) => (0, react_jsx_runtime.jsx)(NotifySection, { ...props, t })));
			}
			//#endregion
			return { apply };
		}
		exports.inject = ["slots", "configForms", "remote", "locale", "sessions", "uiSession"];
		exports.apply = (ctx) => createRuntime().apply(ctx);
		return module.exports;
	}
});
