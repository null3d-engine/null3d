// The stats overlay's look: its style sheet, its header button, and the tabbed card of figures under
// the header. The overlay (overlay.ts) decides what shows, where and when; this file decides how it
// looks, so a new design changes this file alone.
//
// The header is a dark pill: a ring gauge of the frame rate as a share of the target, the frame
// rate, and a chevron. Under it, a card of 360 pixels wide holds four tabs, and its height follows
// the tab that shows, so a short tab leaves no empty card and a long one scrolls no page. The
// header of the card keeps the target and its interval in view on every tab. One tab shows at a
// time: Frame holds the work bars and the geometry figures, Memory the parts of the memory bar,
// Steps the add-ons and the GPU's timed passes, and Systems the memory register.
//
// The work bars are colored by who did the work: blue for the sketch's own code (its update step),
// purple for the engine (every other step), and green for the GPU. A bar stacks parts only where
// they add up to the figure beside it: a thread's steps run one after another and add up to its
// time, and the memory parts add up to the total. Threads run side by side and the GPU works beside
// them, so each has its own bar. The job workers share one bar with the slowest worker's time, since
// they share one step of the frame and the frame waits for the slowest. Amber marks the chrome: the
// active tab's underline, the header's border and the whole-page note's live dot.
//
// Above the bars, a display symbol leads the display's refresh rate and the target, which can be
// lower: the engine draws at the display's rate and defends the target. Each bar's dark mark sits at
// the target's interval, and a faint mark at the display's shorter interval. The symbols carry
// tooltips with the full words, so the header stays short.
//
// The first update builds the card, and later updates change text, bar widths and levels only. Every
// tab is updated on each refresh, so a tab shows current figures the moment it is chosen. Bar widths
// come from a table of widths made once, so a bar that moves allocates nothing. A level, ok, warn or
// bad, is a data attribute that the style sheet colors.
//
// The style sheet lives in the overlay's shadow root, so the page's styles do not reach the overlay
// and its styles do not reach the page. A style sheet made in script passes a Content Security
// Policy without 'unsafe-inline'. Browsers without one get a style element instead.

import type { FeatureStats } from '../scene/features';
import { featureLevel, type Level, rateLevel, workLevel } from './frame-target';
import {
	count,
	type FeatureFact,
	featureFacts,
	featureGpu,
	type StatsFigures,
	type StatsGpuStep,
	type StatsMemoryArea,
	type StatsThread,
} from './stats-text';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
/** The GPU time per frame under which a tab leaves a step out. */
const SHOWN_STEP_MS = 0.005;

/** The card's width in CSS pixels, which every tab shares. Its height follows the tab it shows. */
export const STATS_PANEL_WIDTH = 360;
/** The card's tabs, in reading order. */
export const STATS_TABS = ['frame', 'memory', 'steps', 'systems'] as const;
export type StatsTab = (typeof STATS_TABS)[number];
/** Each tab's label. */
export const TAB_LABELS: Readonly<Record<StatsTab, string>> = {
	frame: 'Frame',
	memory: 'Memory',
	steps: 'Steps',
	systems: 'Systems',
};

/** Which tab shows, and the rule that only one does. */
export class TabSelection {
	private index = 0;

	/** The tab that shows now. */
	get tab(): StatsTab {
		return STATS_TABS[this.index] as StatsTab;
	}

	/** True where `tab` is the one that shows. */
	visible(tab: StatsTab): boolean {
		return STATS_TABS[this.index] === tab;
	}

	/** Shows `tab`. True when that changed the tab. */
	select(tab: StatsTab): boolean {
		const index = STATS_TABS.indexOf(tab);
		if (index < 0 || index === this.index) return false;
		this.index = index;
		return true;
	}

	/** Moves by `delta` tabs, wrapping at the ends, and gives the tab that shows. */
	move(delta: number): StatsTab {
		const count = STATS_TABS.length;
		this.index = (((this.index + delta) % count) + count) % count;
		return this.tab;
	}
}

const CSS = `
.panel {
	--ok: #3ddc97;
	--warn: #f2b453;
	--bad: #ff8074;
	--ok-text: #3ddc97;
	--warn-text: #f2b453;
	--bad-text: #ff8074;
	--code: #6aa8ff;
	--engine: #a98bfa;
	--drawing: #c9b4ff;
	--gpu: #3ddc97;
	--amber: #f2b453;
	--line: rgba(255, 255, 255, 0.075);
	--line-soft: rgba(255, 255, 255, 0.045);
	--text: #e9eef7;
	--dim: #98a3b6;
	--faint: #7a8699;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 8px;
	padding: 12px;
	font: 12px/1.35 ${FONT};
	font-variant-numeric: tabular-nums;
	letter-spacing: normal;
	text-align: left;
	text-transform: none;
	color: var(--text);
	pointer-events: none;
}
[hidden] { display: none !important; }
button {
	margin: 0;
	font: inherit;
	color: inherit;
}
.header {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 4px 10px 4px 4px;
	border: 1px solid rgba(242, 180, 83, 0.34);
	border-radius: 999px;
	background:
		linear-gradient(180deg, rgba(242, 180, 83, 0.15), rgba(242, 180, 83, 0.05)),
		#0f141c;
	box-shadow:
		0 8px 20px rgba(0, 0, 0, 0.45),
		inset 0 1px 0 rgba(255, 255, 255, 0.06);
	font: 600 13px/1.35 ${FONT};
	font-variant-numeric: tabular-nums;
	cursor: pointer;
	pointer-events: auto;
}
.header:focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; }
.ring { width: 22px; height: 22px; flex: none; }
.ring circle { fill: none; stroke-width: 4; }
.ring .track { stroke: rgba(255, 255, 255, 0.13); }
.ring .arc { stroke: var(--ok); stroke-linecap: round; stroke-dasharray: 87.96; }
.ring[data-level='warn'] .arc { stroke: var(--warn); }
.ring[data-level='bad'] .arc { stroke: var(--bad); }
.fps { font-family: ${MONO}; letter-spacing: -0.02em; }
.chevron { width: 10px; height: 10px; flex: none; color: var(--amber); transition: transform 0.18s ease; }
.header[aria-expanded='true'] .chevron { transform: rotate(180deg); }
.card {
	display: flex;
	flex-direction: column;
	width: min(${STATS_PANEL_WIDTH}px, 92vw);
	box-sizing: border-box;
	border: 1px solid rgba(255, 255, 255, 0.09);
	border-radius: 14px;
	background:
		radial-gradient(130% 60% at 50% -20%, rgba(255, 255, 255, 0.05), transparent 60%),
		linear-gradient(180deg, #141924 0%, #0f141c 100%);
	box-shadow:
		0 30px 70px -20px rgba(0, 0, 0, 0.8),
		inset 0 1px 0 rgba(255, 255, 255, 0.04);
	overflow: hidden;
}
.head {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 9px 12px 8px;
	border-bottom: 1px solid var(--line);
}
.sub {
	display: flex;
	align-items: center;
	gap: 5px;
	min-width: 0;
	font: 500 9.5px/1.2 ${FONT};
	color: var(--faint);
	white-space: nowrap;
}
.sub .figure { font-family: ${MONO}; color: #c4cfdf; }
.info { position: relative; display: inline-flex; flex: none; }
.info button {
	width: 16px;
	height: 16px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	color: var(--faint);
	background: none;
	box-shadow: none;
	cursor: help;
	pointer-events: auto;
}
.info button:hover { color: var(--dim); }
.info button svg { width: 16px; height: 16px; }
.info button:focus-visible { outline: 1px solid var(--amber); outline-offset: 2px; }
.tip {
	position: absolute;
	top: 20px;
	left: 0;
	z-index: 1;
	width: 220px;
	padding: 8px 10px;
	border: 1px solid var(--line);
	border-radius: 8px;
	font: 400 11px/1.4 ${FONT};
	letter-spacing: 0;
	text-transform: none;
	white-space: normal;
	color: var(--text);
	background: #11161f;
	box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
	opacity: 0;
	visibility: hidden;
	transition: opacity 0.12s ease;
}
.info:hover .tip, .info button:focus-visible + .tip, .info[data-open='true'] .tip {
	opacity: 1;
	visibility: visible;
}
.tabs {
	display: flex;
	flex: none;
	padding: 0 8px;
	border-bottom: 1px solid var(--line);
	background: rgba(255, 255, 255, 0.012);
}
.tabs button {
	flex: 1;
	padding: 10px 4px 9px;
	border: 0;
	background: none;
	font: 600 9.5px/1 ${FONT};
	letter-spacing: 0.11em;
	text-transform: uppercase;
	color: var(--faint);
	box-shadow: inset 0 -2px 0 transparent;
	cursor: pointer;
	pointer-events: auto;
	transition: color 0.12s ease;
}
.tabs button:hover { color: var(--dim); }
.tabs button[aria-selected='true'] { color: var(--text); box-shadow: inset 0 -2px 0 var(--amber); }
.tabs button:focus-visible { outline: 1px solid var(--amber); outline-offset: -3px; border-radius: 4px; }
.panes { display: flex; flex: 1; min-height: 0; }
.pane { flex: 1; flex-direction: column; min-height: 0; padding: 12px; overflow: hidden; }
.pane:not([hidden]) { display: flex; }
.block { display: flex; flex: none; flex-direction: column; }
.block + .block { margin-top: 14px; }
.sect-head {
	display: flex;
	flex: none;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 7px;
}
.sect-label {
	font: 600 8.5px/1 ${FONT};
	letter-spacing: 0.13em;
	text-transform: uppercase;
	color: var(--faint);
}
.meta { font: 500 9px/1 ${MONO}; color: var(--faint); white-space: nowrap; }
.lanes { display: grid; flex: none; }
.lane {
	display: grid;
	grid-template-columns: 7px 62px 1fr 52px;
	align-items: center;
	gap: 8px;
	height: 26px;
}
.dot { width: 6px; height: 6px; border-radius: 2px; flex: none; }
.dot.code { background: var(--code); }
.dot.engine { background: var(--engine); }
.dot.jobs { background: rgba(169, 139, 250, 0.55); }
.dot.gpu { background: var(--gpu); }
.lane .name {
	font: 500 10.5px/1 ${FONT};
	color: #cbd4e2;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.lane .name small { font: 500 9px/1 ${MONO}; color: var(--faint); margin-left: 2px; }
.track {
	position: relative;
	height: 4px;
	border-radius: 2px;
	background: rgba(255, 255, 255, 0.055);
	overflow: hidden;
}
.part { position: absolute; top: 0; bottom: 0; left: 0; width: 0; }
.part.code { background: var(--code); }
.part.engine { background: var(--engine); }
.part.drawing { background: var(--drawing); }
.part.gpu { background: var(--gpu); }
.mark {
	position: absolute;
	top: -2px;
	bottom: -2px;
	left: 50%;
	width: 2px;
	margin-left: -1px;
	background: rgba(233, 238, 247, 0.55);
}
.mark.display { opacity: 0.35; }
.lane .val { text-align: right; font: 500 10.5px/1 ${MONO}; color: #e6ecf5; white-space: nowrap; }
.lane[data-level='ok'] .val { color: var(--ok-text); }
.lane[data-level='warn'] .val { color: var(--warn-text); }
.lane[data-level='bad'] .val { color: var(--bad-text); }
.lane.gpu .val { color: var(--gpu); }
.scale { margin-top: 6px; font: 400 9px/1.35 ${FONT}; color: var(--faint); flex: none; }
.held { font-size: 12px; font-weight: 600; color: var(--bad-text); }
.update-error-line { font-size: 11px; font-weight: 600; color: var(--bad-text); }
.figs {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	flex: none;
	gap: 8px;
	margin-top: 10px;
	padding-top: 10px;
	border-top: 1px solid var(--line-soft);
}
.fig b { display: block; font: 600 16px/1 ${MONO}; letter-spacing: -0.03em; color: #f1f5fb; }
.fig small {
	display: block;
	margin-top: 4px;
	font: 600 8px/1 ${FONT};
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--faint);
}
.heading {
	flex: none;
	margin-top: 8px;
	font: 500 9px/1.3 ${MONO};
	color: var(--faint);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.total { display: flex; flex: none; align-items: baseline; gap: 6px; margin-bottom: 10px; }
.total-value { font: 600 26px/1 ${MONO}; letter-spacing: -0.045em; color: #f1f5fb; }
.total-value .unit { margin-left: 2px; font: 500 9.5px/1 ${FONT}; letter-spacing: 0; color: var(--dim); }
.total-aside { margin-left: auto; font: 500 9px/1 ${MONO}; color: var(--faint); }
.total-aside b { font-size: 9px; letter-spacing: 0; color: var(--gpu); }
.mbar {
	position: relative;
	flex: none;
	height: 9px;
	border-radius: 3px;
	overflow: hidden;
	background: rgba(255, 255, 255, 0.05);
}
.mlegend { display: grid; flex: none; gap: 1px; margin-top: 8px; }
.mrow {
	display: grid;
	grid-template-columns: 7px 1fr auto auto;
	align-items: center;
	gap: 9px;
	height: 25px;
}
.mrow .name { font: 500 10.5px/1 ${FONT}; color: #cbd4e2; }
.mrow .share { font: 400 9px/1 ${MONO}; color: var(--faint); min-width: 34px; text-align: right; }
.mrow .val { min-width: 58px; text-align: right; font: 500 10.5px/1 ${MONO}; color: #e6ecf5; }
.mrow .val small { font-size: 8.5px; color: var(--faint); }
.footnote {
	display: flex;
	flex: none;
	align-items: baseline;
	margin: 10px 0 0;
	padding-top: 9px;
	border-top: 1px solid var(--line-soft);
	font: 400 9px/1.4 ${FONT};
	color: var(--faint);
}
.live {
	display: inline-block;
	width: 4px;
	height: 4px;
	margin-right: 5px;
	border-radius: 50%;
	background: var(--amber);
	vertical-align: 1px;
}
.feature-list { display: grid; flex: none; gap: 12px; }
.feature { display: grid; grid-template-columns: 1fr auto; align-items: baseline; column-gap: 8px; }
.feature .fname { font: 500 10.5px/1.3 ${FONT}; color: #cbd4e2; }
.feature .fgpu {
	font: 500 10.5px/1 ${MONO};
	color: var(--gpu);
	text-align: right;
	white-space: nowrap;
}
.feature .fgpu[data-level='warn'] { color: var(--warn-text); }
.feature .fgpu[data-level='bad'] { color: var(--bad-text); }
.feature .fgpu.none { font: 400 9px/1.3 ${FONT}; color: var(--faint); }
.feature .fdetails {
	grid-column: 1 / -1;
	display: flex;
	flex-wrap: wrap;
	gap: 2px 20px;
	margin-top: 3px;
}
.fcell { display: grid; gap: 1px; min-width: 0; }
.flabel { font: 400 8.5px/1.2 ${MONO}; letter-spacing: 0.01em; color: var(--faint); white-space: nowrap; }
.fvalue { font: 500 10px/1.2 ${MONO}; color: #d5deea; white-space: nowrap; }
.gsteps { display: grid; flex: none; }
.gstep {
	display: grid;
	grid-template-columns: 16px 1fr auto;
	align-items: center;
	gap: 6px;
	height: 20px;
	border-top: 1px solid var(--line-soft);
}
.gstep:first-child { border-top: 0; }
.gstep .idx { font: 400 8px/1 ${MONO}; color: var(--faint); text-align: right; }
.gstep .name {
	font: 400 10px/1 ${FONT};
	color: #b9c3d3;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.gstep .val { font: 500 10px/1 ${MONO}; color: var(--gpu); white-space: nowrap; }
.areas { display: grid; flex: none; }
.areas .head, .areas .area { display: grid; grid-template-columns: 1fr 60px 60px 52px; align-items: center; gap: 6px; }
.areas .head {
	padding-bottom: 5px;
	border-bottom: 1px solid var(--line);
	font: 600 8px/1 ${FONT};
	letter-spacing: 0.11em;
	text-transform: uppercase;
	color: var(--faint);
}
.areas .head span:not(:first-child) { text-align: right; }
.area { height: 22px; border-bottom: 1px solid var(--line-soft); }
.area .name {
	font: 400 10px/1 ${FONT};
	color: #b9c3d3;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.area span:not(.name) { text-align: right; font: 500 10px/1 ${MONO}; color: #d5deea; white-space: nowrap; }
.area.zero .name, .area.zero span { color: var(--faint); }
.empty { margin: auto 0 0; font: 400 9px/1.4 ${FONT}; color: var(--faint); }
@media (prefers-reduced-motion: reduce) {
	.chevron, .tabs button { transition: none; }
}
`;

/** The parts of the memory bar: each figure's name, label and color. */
const MEMORY_PARTS = [
	['engine-memory', 'Engine', '#a98bfa'],
	['gpu-textures', 'GPU textures', '#3ddc97'],
	['gpu-buffers', 'GPU buffers', '#2bb97f'],
	['js-heap', 'JS heap', '#6aa8ff'],
] as const;
const MIB = 1024 * 1024;

/** The steps of a bar's width, from empty to the whole bar. */
const STEPS = 200;
/** Each step's width, made once, so that a bar's change allocates nothing. */
const WIDTHS = Array.from({ length: STEPS + 1 }, (_, step) => `${(step * 100) / STEPS}%`);
/** The length of the ring gauge's circle, in the units of its view box. */
const RING_LENGTH = 87.96;
/** The ring's dash offset for each percent of the target, made once. */
const RING_OFFSETS = Array.from({ length: 101 }, (_, k) =>
	(RING_LENGTH * (1 - k / 100)).toFixed(2),
);

/** The step of a share of a whole bar, from 0 (empty) to the whole bar. */
export function widthStep(share: number): number {
	return share > 0 ? Math.round(Math.min(share, 1) * STEPS) : 0;
}

/** Milliseconds with one decimal. */
const ms = (value: number) => `${value.toFixed(1)} ms`;

/** Bytes as tenths of a MiB, the unit that the memory figures add up in. */
export function tenthsOfMib(bytes: number): number {
	return Math.round((bytes * 10) / MIB);
}

/** Tenths of a MiB as text. */
const mibText = (tenths: number) => `${(tenths / 10).toFixed(1)} MiB`;

/** A memory part in tenths of a MiB, or -1 where the page does not know it. */
const memoryPart = (bytes: number | null) => (bytes === null ? -1 : tenthsOfMib(bytes));

/** The time of a thread's frame that the sketch's own code takes: its update step. */
export function codeMs(thread: StatsThread): number {
	return Math.min(thread.phases?.update ?? 0, thread.busyMs);
}

/** The time of a thread's frame that drawing takes: its upload and replay steps. */
export function drawingMs(thread: StatsThread): number {
	const phases = thread.phases;
	const drawing = (phases?.upload ?? 0) + (phases?.replay ?? 0);
	return Math.min(drawing, thread.busyMs - codeMs(thread));
}

/** The threads that the work bars show, by the names that `engine.measure` gives them. */
export class WorkThreads {
	/** The thread that runs the sketch and then draws, in low latency and in the single build. */
	both: StatsThread | undefined;
	sketch: StatsThread | undefined;
	drawing: StatsThread | undefined;
	page: StatsThread | undefined;
	/** The slowest job worker, which the job workers' bar shows, and the count of job workers. */
	slowestJob: StatsThread | undefined;
	jobs = 0;

	/** `bothSteps` names the thread that runs the sketch and draws, where one thread does both. */
	update(threads: readonly StatsThread[], bothSteps?: string): void {
		this.both = this.sketch = this.drawing = this.page = this.slowestJob = undefined;
		this.jobs = 0;
		for (const thread of threads) {
			if (thread.name === bothSteps) this.both = thread;
			else if (thread.name === 'sketch-worker') this.sketch = thread;
			else if (thread.name === 'render-worker') this.drawing = thread;
			else if (thread.name === 'main') this.page = thread;
			else if (thread.name.startsWith('job-')) {
				this.jobs++;
				if (!this.slowestJob || thread.busyMs > this.slowestJob.busyMs) this.slowestJob = thread;
			}
		}
	}

	/**
	 * What holds the frame rate back: the bar furthest past the target's interval, or the work
	 * outside the engine when no bar passes it. `gpuMs` is null where the GPU's time is unknown.
	 */
	heldBackBy(targetMs: number, gpuMs: number | null): string {
		let by = 'outside the engine';
		let most = targetMs;
		const check = (label: string, ms: number) => {
			if (ms > most) {
				most = ms;
				by = label;
			}
		};
		if (this.both) check('Sketch + drawing', this.both.busyMs);
		if (this.sketch) check('Sketch', this.sketch.busyMs);
		if (this.drawing) check('Drawing', this.drawing.busyMs);
		if (this.slowestJob) check('Jobs', this.slowestJob.busyMs);
		if (this.page) check('Page', this.page.busyMs);
		if (gpuMs !== null) check('GPU', gpuMs);
		return by;
	}
}

let sheet: CSSStyleSheet | undefined;

/** Gives a shadow root the overlay's style sheet. */
export function addStyles(root: ShadowRoot): void {
	if ('adoptedStyleSheets' in root) {
		if (!sheet) {
			sheet = new CSSStyleSheet();
			sheet.replaceSync(CSS);
		}
		root.adoptedStyleSheets = [sheet];
		return;
	}
	const style = document.createElement('style');
	style.textContent = CSS;
	(root as ShadowRoot).append(style);
}

/** A new element with a class, added to `parent`. */
function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	parent?: Node,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	parent?.appendChild(node);
	return node;
}

/** A new element that holds a figure, which tests find by its name, and the figure's text node. */
function figure(
	tag: keyof HTMLElementTagNameMap,
	name: string,
	parent: Node,
	className = '',
): { element: HTMLElement; text: Text } {
	const node = element(tag, className, parent);
	node.dataset.figure = name;
	const text = document.createTextNode('');
	node.append(text);
	return { element: node, text };
}

/** Sets a text node's text, when it changed. */
function setText(node: Text, text: string): void {
	if (node.data !== text) node.data = text;
}

/** Shows a figure's exact bytes in its tooltip, so a rounded row still gives the figure. */
function exact(node: Text, bytes: number): void {
	const element = node.parentElement;
	const title = `${Math.round(bytes)} bytes`;
	if (element && element.title !== title) element.title = title;
}

/** Sets an element's level attribute, when it changed. */ function setLevel(
	node: HTMLElement | SVGElement,
	level: Level | undefined,
): void {
	if (node.dataset.level === level) return;
	if (level) node.dataset.level = level;
	else delete node.dataset.level;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A new SVG element with its attributes, added to `parent`. */
function svg<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attributes: Readonly<Record<string, string>>,
	parent: Node,
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG_NS, tag);
	for (const name in attributes) node.setAttribute(name, attributes[name] as string);
	parent.appendChild(node);
	return node;
}

/**
 * How the threads share a frame's work, as the card explains it: null3D's two latency modes, its
 * single-thread build, and a renderer that runs on one thread of its own, such as three.js.
 */
export type FrameMode = 'pipelined' | 'low' | 'single' | 'one-thread';

/** Each mode's symbol, its button's label and its tooltip. */
const MODE_NOTES: Readonly<
	Record<FrameMode, { symbol: 'bars' | 'clock'; label: string; tip: string }>
> = {
	pipelined: {
		symbol: 'bars',
		label: 'Pipelined mode: what it means',
		tip: 'Pipelined mode: the engine prepares one frame while it draws the one before, and the GPU works on the frame before that. More work fits in each frame, and input shows one frame later. Each thread has its own bar, and each must fit the target on its own.',
	},
	low: {
		symbol: 'clock',
		label: 'Low-latency mode: what it means',
		tip: "Low-latency mode: each frame is prepared and drawn in the same frame interval, so input shows sooner. Your code, the engine's sketch steps and the drawing run one after another, so they share one bar and must fit the target together.",
	},
	single: {
		symbol: 'clock',
		label: 'Single-thread mode: what it means',
		tip: "Single-thread mode: without shared memory, the engine runs on the page's thread alone. Each frame is prepared and drawn in the same frame interval, so your code, the engine's sketch steps and the drawing run one after another. They share one bar and must fit the target together.",
	},
	'one-thread': {
		symbol: 'clock',
		label: 'One thread: what it means',
		tip: "One thread: the renderer prepares and draws each frame on one thread, in the same frame interval. Your code, the renderer's own work and the drawing run one after another, so they share one bar and must fit the target together.",
	},
};

/**
 * A symbol button whose tooltip explains a figure. The tooltip shows while the pointer is on the
 * button or the button has the keyboard's focus, and a click or a tap shows or hides it, since
 * touch screens have no hover.
 */
class Note {
	readonly button: HTMLButtonElement;
	private readonly tip: HTMLSpanElement;

	/** `id` names the tooltip, which the button points at. */
	constructor(parent: Node, id: string) {
		const info = element('span', 'info', parent);
		const button = element('button', '', info);
		button.type = 'button';
		button.setAttribute('aria-describedby', id);
		const tip = element('span', 'tip', info);
		tip.id = id;
		tip.setAttribute('role', 'tooltip');
		button.addEventListener('click', (event) => {
			info.dataset.open = info.dataset.open === 'true' ? 'false' : 'true';
			if (event.detail > 0) button.blur();
		});
		button.addEventListener('keydown', keepKeys);
		button.addEventListener('keyup', keepKeys);
		this.button = button;
		this.tip = tip;
	}

	/** Sets the button's label and the tooltip's words. */
	words(label: string, tip: string): void {
		this.button.setAttribute('aria-label', label);
		this.tip.textContent = tip;
	}

	/** Empties the button and gives it a new icon of 16 by 16 units to draw in. */
	icon(): SVGSVGElement {
		this.button.replaceChildren();
		return svg('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, this.button);
	}
}

/** The stroke of a line icon. */
const LINE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' } as const;

/** The symbol of the engine's frame mode before the target, with words that explain the mode. */
class ModeNote {
	private readonly note: Note;
	private mode: FrameMode | undefined;

	constructor(parent: Node) {
		this.note = new Note(parent, 'mode-tip');
	}

	/** Shows the symbol and the words of a mode. */
	set(mode: FrameMode): void {
		if (mode === this.mode) return;
		this.mode = mode;
		const { symbol, label, tip } = MODE_NOTES[mode];
		const { note } = this;
		note.button.dataset.figure = `mode:${mode}`;
		note.words(label, tip);
		const icon = note.icon();
		if (symbol === 'clock') {
			svg('circle', { ...LINE, cx: '8', cy: '9', r: '5.5' }, icon);
			svg('path', { ...LINE, d: 'M8 6v3.2l2 1.3M6.5 2h3', 'stroke-linecap': 'round' }, icon);
			return;
		}
		for (const [x, y, opacity] of [
			['1.5', '3', '1'],
			['4', '6.8', '0.75'],
			['6.5', '10.6', '0.5'],
		] as const)
			svg(
				'rect',
				{ x, y, width: '8', height: '2.4', rx: '1.2', fill: 'currentColor', opacity },
				icon,
			);
	}
}

/** The words that say what the quality does below the target. */
const BELOW_TARGET =
	'The preset check and the quality governor lower the quality when frames fall below it.';

/**
 * The words of the target's symbol, for a target frame rate and the display's refresh rate, 0
 * before it is measured.
 */
export function targetTip(target: number, refreshHz: number): string {
	const fps = `${Math.round(target)} fps`;
	if (refreshHz <= 0)
		return `The display's rate is not measured yet, so the engine defends ${fps} for now.`;
	if (refreshHz <= target)
		return `The engine defends the display's full rate, ${fps}. ${BELOW_TARGET} Each bar's mark is ${ms(1000 / target)}.`;
	return `The display runs at ${Math.round(refreshHz)} Hz, and the engine draws up to that rate. It defends ${fps}. ${BELOW_TARGET} Each bar's dark mark is ${ms(1000 / target)}, and its faint mark is ${ms(1000 / refreshHz)}. The targetFps option raises the target.`;
}

/**
 * The target's symbol, a display, and its figures: the display's refresh rate where it is above
 * the target, then the target and its interval. A target below the display's rate is a floor, which
 * a sign marks. Each bar then gets a faint second mark at the display's interval.
 */
class TargetFigures {
	private readonly note: Note;
	private readonly display: { element: HTMLElement; text: Text };
	private readonly separator: HTMLElement;
	private readonly target: Text;
	/** The target and the refresh rate that the figures show, or -1 before any. */
	private shownTarget = -1;
	private shownRefresh = -1;

	constructor(parent: Node) {
		this.note = new Note(parent, 'target-tip');
		this.note.button.dataset.figure = 'target-note';
		const icon = this.note.icon();
		svg('rect', { ...LINE, x: '1.5', y: '2.5', width: '13', height: '8.5', rx: '1.5' }, icon);
		svg('path', { ...LINE, d: 'M8 11v3M5 14h6', 'stroke-linecap': 'round' }, icon);
		this.display = figure('span', 'display', parent, 'figure');
		this.separator = element('span', '', parent);
		this.separator.textContent = '·';
		this.target = figure('span', 'target', parent, 'figure').text;
	}

	/**
	 * Shows a target against the display's refresh rate, 0 before it is measured, and places the
	 * display's mark on each of `lanes`. The figures change only when either rate changes.
	 */
	update(target: number, refreshHz: number, lanes: readonly Lane[]): void {
		if (target === this.shownTarget && refreshHz === this.shownRefresh) return;
		this.shownTarget = target;
		this.shownRefresh = refreshHz;
		const above = refreshHz > target;
		this.display.element.hidden = !above;
		this.separator.hidden = !above;
		if (above) setText(this.display.text, `${Math.round(refreshHz)} Hz`);
		setText(this.target, `${above ? '≥' : ''}${Math.round(target)} fps · ${ms(1000 / target)}`);
		this.note.words('Target frame rate: what it means', targetTip(target, refreshHz));
		// Each bar spans twice the target's interval, so the display's shorter interval sits at this
		// share of it.
		const mark = above ? target / (2 * refreshHz) : 0;
		for (const lane of lanes) lane.displayMark(mark);
	}
}

/** Keeps Enter and Space on an overlay button from the sketch's keyboard input. */
export function keepKeys(event: KeyboardEvent): void {
	if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
}

/** The panel that holds the header and the card. */
export function buildPanel(): HTMLDivElement {
	return element('div', 'panel');
}

/** The header: a button with the ring gauge, the frame rate and a chevron. */
export class StatsHeader {
	readonly button: HTMLButtonElement;
	private readonly ring: SVGSVGElement;
	private readonly arc: SVGCircleElement;
	private readonly rate: Text;
	/** The whole frame rate and the ring's percent that the header shows, or -1 before any. */
	private shown = -2;
	private percent = -1;

	constructor() {
		const button = element('button', 'header');
		button.type = 'button';
		const ring = svg('svg', { class: 'ring', viewBox: '0 0 36 36', 'aria-hidden': 'true' }, button);
		const circle = { cx: '18', cy: '18', r: '14' };
		svg('circle', { ...circle, class: 'track' }, ring);
		this.arc = svg('circle', { ...circle, class: 'arc', transform: 'rotate(-90 18 18)' }, ring);
		this.rate = figure('span', 'fps', button, 'fps').text;
		const chevron = svg(
			'svg',
			{ class: 'chevron', viewBox: '0 0 10 10', 'aria-hidden': 'true' },
			button,
		);
		svg(
			'path',
			{
				d: 'M1.5 3.5 5 7l3.5-3.5',
				fill: 'none',
				stroke: 'currentColor',
				'stroke-width': '1.6',
				'stroke-linecap': 'round',
				'stroke-linejoin': 'round',
			},
			chevron,
		);
		this.ring = ring;
		this.button = button;
		this.update(0, 0, 1);
	}

	/** Shows a frame rate against the target, or no rate before the first frames (`frames` 0). */
	update(frames: number, fps: number, target: number): void {
		const shown = frames === 0 ? -1 : Math.round(fps);
		if (shown !== this.shown) {
			this.shown = shown;
			this.rate.data = shown < 0 ? '-- fps' : `${shown} fps`;
		}
		const percent = frames === 0 ? 0 : Math.round(Math.min(fps / target, 1) * 100);
		if (percent !== this.percent) {
			this.percent = percent;
			this.arc.setAttribute('stroke-dashoffset', RING_OFFSETS[percent] as string);
		}
		setLevel(this.ring, frames === 0 ? undefined : rateLevel(fps, target));
	}
}

/** One part of a bar: a colored span whose start and width follow the figures. */
class Part {
	readonly element: HTMLSpanElement;
	private left = -1;
	private width = -1;

	constructor(parent: Node, className: string, color?: string) {
		this.element = element('span', `part ${className}`, parent);
		if (color) this.element.style.background = color;
	}

	/** Places the part from `from` to `from + share` of the bar, both as shares of the whole. */
	place(from: number, share: number): void {
		const left = widthStep(from);
		const width = widthStep(from + share) - left;
		if (left !== this.left) {
			this.left = left;
			this.element.style.left = WIDTHS[left] as string;
		}
		if (width !== this.width) {
			this.width = width;
			this.element.style.width = WIDTHS[width] as string;
		}
	}
}

/** The tone of a lane's symbol: the work that its bar starts with. */
type LaneTone = 'code' | 'engine' | 'jobs' | 'gpu';

/**
 * A bar of work against the target: a name, a bar of the sketch's code then the engine's work (or
 * the GPU's), with the target's mark, and a value colored by how it stands against the target.
 */
class Lane {
	readonly element: HTMLDivElement;
	private readonly value: Text;
	private readonly code: Part | undefined;
	private readonly work: Part;
	private readonly drawing: Part | undefined;
	private readonly count: Text | undefined;
	private readonly display: HTMLSpanElement;

	constructor(
		parent: Node,
		name: string,
		label: string,
		kind: 'thread' | 'both' | 'jobs' | 'gpu',
		tone: LaneTone,
	) {
		const lane = element('div', kind === 'gpu' ? 'lane gpu' : `lane ${kind}`, parent);
		element('i', `dot ${tone}`, lane);
		const title = element('span', 'name', lane);
		title.append(label);
		if (kind === 'jobs') {
			title.append(' ');
			this.count = element('small', '', title).appendChild(document.createTextNode(''));
		}
		const track = element('span', 'track', lane);
		if (kind === 'thread' || kind === 'both') this.code = new Part(track, 'code');
		this.work = new Part(track, kind === 'gpu' ? 'gpu' : 'engine');
		if (kind === 'both') this.drawing = new Part(track, 'drawing');
		element('span', 'mark', track);
		this.display = element('span', 'mark display', track);
		this.display.hidden = true;
		this.value = figure('span', name, lane, 'val').text;
		this.element = lane;
	}

	/** Places the display's mark at a share of the bar, or hides it for 0. */
	displayMark(share: number): void {
		this.display.hidden = share <= 0;
		if (share > 0) this.display.style.left = WIDTHS[widthStep(share)] as string;
	}

	/**
	 * Shows a time of work against the target, as shares of `scale`: first `codeMs` of the sketch's
	 * own code, then the engine's work, and last `drawingMs` of drawing on a lane that has both.
	 */
	set(busyMs: number, codeMs: number, targetMs: number, scale: number, drawingMs = 0): void {
		this.element.hidden = false;
		this.code?.place(0, codeMs / scale);
		this.work.place(codeMs / scale, (busyMs - codeMs - drawingMs) / scale);
		this.drawing?.place((busyMs - drawingMs) / scale, drawingMs / scale);
		setText(this.value, ms(busyMs));
		setLevel(this.element, workLevel(busyMs, targetMs));
	}

	/** Shows text in place of a time, with an empty bar. */
	note(text: string): void {
		this.element.hidden = false;
		this.code?.place(0, 0);
		this.work.place(0, 0);
		this.drawing?.place(0, 0);
		setText(this.value, text);
		setLevel(this.element, undefined);
	}

	/** Sets the count beside a job workers' lane's name. */
	setCount(jobs: number): void {
		if (this.count) setText(this.count, `×${jobs}`);
	}

	hide(): void {
		this.element.hidden = true;
	}
}

/**
 * A feature's row in the Steps tab: its name with its GPU time beside it, then a labelled cell for
 * each figure that the feature reports. A cell that the feature stops reporting hides.
 */
class FeatureRow {
	readonly element: HTMLDivElement;
	private readonly gpu: HTMLSpanElement;
	private readonly gpuText: Text;
	private readonly details: HTMLDivElement;
	private readonly cells = new Map<string, { box: HTMLSpanElement; value: Text }>();

	constructor(parent: Node, name: string) {
		const row = element('div', 'feature', parent);
		row.dataset.figure = `feature:${name}`;
		element('span', 'fname', row).append(name, ' ');
		this.gpu = element('span', 'fgpu', row);
		this.gpuText = document.createTextNode('');
		this.gpu.append(this.gpuText, ' ');
		this.details = element('div', 'fdetails', row);
		this.element = row;
	}

	/** Shows one update's figures: the GPU time, its level, and each labelled fact. */
	set(
		gpuText: string,
		level: Level | undefined,
		unmeasured: boolean,
		facts: readonly FeatureFact[],
	): void {
		setText(this.gpuText, gpuText);
		this.gpu.classList.toggle('none', unmeasured);
		setLevel(this.gpu, level);
		const seen = new Set<string>();
		for (const fact of facts) {
			seen.add(fact.key);
			let cell = this.cells.get(fact.key);
			if (!cell) {
				const box = element('span', 'fcell', this.details);
				element('span', 'flabel', box).append(fact.label, ' ');
				const text = document.createTextNode('');
				element('span', 'fvalue', box).append(text, ' ');
				cell = { box, value: text };
				this.cells.set(fact.key, cell);
			}
			setText(cell.value, fact.value);
			cell.box.hidden = false;
		}
		for (const [key, cell] of this.cells) {
			if (!seen.has(key)) cell.box.hidden = true;
		}
		this.details.hidden = facts.length === 0;
	}
}

/** A row of the memory legend: a color, a name, its share of the total, and its figure. */
class MemoryRow {
	readonly element: HTMLDivElement;
	private readonly share: Text;
	private readonly value: Text;

	constructor(parent: Node, name: string, label: string, color: string) {
		const row = element('div', 'mrow', parent);
		element('i', 'dot', row).style.background = color;
		element('span', 'name', row).append(label);
		this.share = element('span', 'share', row).appendChild(document.createTextNode(''));
		const value = figure('span', name, row, 'val');
		this.value = value.text;
		element('small', '', value.element).append('MiB');
		this.element = row;
	}

	/** Shows the part in tenths of a MiB and its share, or hides the row for null. */
	set(tenths: number | null, share: number): void {
		this.element.hidden = tenths === null;
		if (tenths === null) return;
		setText(this.value, `${(tenths / 10).toFixed(1)} `);
		setText(this.share, `${(share * 100).toFixed(1)}%`);
	}
}

/** The figures under the header, which `update` fills. */
export class StatsCard {
	readonly element: HTMLDivElement;
	private readonly target: TargetFigures;
	private readonly mode: ModeNote;
	private readonly tabButtons: HTMLButtonElement[] = [];
	private readonly panes = new Map<StatsTab, HTMLElement>();
	private readonly selection = new TabSelection();
	private readonly both: Lane;
	private readonly sketch: Lane;
	private readonly drawing: Lane;
	private readonly jobs: Lane;
	private readonly page: Lane;
	private readonly gpu: Lane;
	private readonly lanes: readonly Lane[];
	private readonly scale: Text;
	private readonly heldBack: { element: HTMLElement; text: Text };
	private readonly updateError: { element: HTMLElement; text: Text };
	private readonly memoryTotal: Text;
	private readonly memoryAside: Text;
	private readonly memoryParts: Part[] = [];
	private readonly memoryRows: MemoryRow[] = [];
	private readonly wholePage: { element: HTMLElement; text: Text };
	private readonly draws: Text;
	private readonly triangles: Text;
	private readonly objects: Text;
	private readonly heading: Text;
	private readonly featureSection: HTMLElement;
	private readonly featureList: HTMLElement;
	/** Each feature's row, by the feature's name. */
	private readonly featureRows = new Map<string, FeatureRow>();
	private readonly stepSection: HTMLElement;
	private readonly stepList: HTMLElement;
	private readonly stepMeta: Text;
	private readonly stepsEmpty: HTMLElement;
	/** The rows of the frame's GPU steps, one for each place in its list. */
	private readonly stepRows: { row: HTMLElement; name: Text; value: Text }[] = [];
	private readonly registerSection: HTMLElement;
	private readonly registerEmpty: HTMLElement;
	private readonly areaList: HTMLElement;
	/** Each memory area's three figures, by the area's name. */
	private readonly areaRows = new Map<
		string,
		{ row: HTMLElement; used: Text; reserved: Text; peak: Text }
	>();
	private readonly threads = new WorkThreads();
	/** Each memory part in tenths of a MiB, or -1 where the page does not know it. */
	private readonly memory = new Int32Array(MEMORY_PARTS.length);

	constructor() {
		const card = element('div', 'card');
		const head = element('div', 'head', card);
		const sub = element('div', 'sub', head);
		this.mode = new ModeNote(sub);
		this.target = new TargetFigures(sub);
		element('span', '', sub).append(' budget');

		const tabstrip = element('div', 'tabs', card);
		tabstrip.setAttribute('role', 'tablist');
		tabstrip.setAttribute('aria-label', 'Stats sections');
		for (const tab of STATS_TABS) {
			const button = element('button', '', tabstrip);
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.id = `tab-${tab}`;
			button.setAttribute('aria-controls', `pane-${tab}`);
			button.append(TAB_LABELS[tab]);
			button.addEventListener('click', () => this.showTab(tab));
			button.addEventListener('keydown', this.tabKey);
			button.addEventListener('keyup', keepKeys);
			this.tabButtons.push(button);
		}
		const panes = element('div', 'panes', card);
		for (const tab of STATS_TABS) {
			const pane = element('section', 'pane', panes);
			pane.id = `pane-${tab}`;
			pane.setAttribute('role', 'tabpanel');
			pane.setAttribute('aria-labelledby', `tab-${tab}`);
			this.panes.set(tab, pane);
		}
		this.applyTabs();

		const frame = this.pane('frame');
		const work = sectionHead(frame, 'Frame work');
		this.scale = work.text;
		const lanes = element('div', 'lanes', frame);
		this.both = new Lane(lanes, 'sketch-drawing', 'Sketch + drawing', 'both', 'code');
		this.sketch = new Lane(lanes, 'sketch', 'Sketch', 'thread', 'code');
		this.drawing = new Lane(lanes, 'drawing', 'Drawing', 'thread', 'engine');
		this.jobs = new Lane(lanes, 'jobs', 'Jobs', 'jobs', 'jobs');
		this.page = new Lane(lanes, 'page', 'Page', 'thread', 'code');
		this.gpu = new Lane(lanes, 'gpu', 'GPU', 'gpu', 'gpu');
		this.lanes = [this.both, this.sketch, this.drawing, this.jobs, this.page, this.gpu];
		element('p', 'scale', frame).append(
			'Bars span twice the target’s interval; the mark is the target.',
		);
		this.heldBack = figure('div', 'held-back', frame, 'held');
		this.heldBack.element.hidden = true;
		this.updateError = figure('div', 'update-error', frame, 'update-error-line');
		this.updateError.element.hidden = true;
		const figs = element('div', 'figs', frame);
		this.draws = countCell(figs, 'draws');
		this.triangles = countCell(figs, 'triangles');
		this.objects = countCell(figs, 'objects');
		this.heading = figure('div', 'heading', frame, 'heading').text;

		const memory = this.pane('memory');
		sectionHead(memory, 'Memory').text.data = 'all parts';
		const total = element('div', 'total', memory);
		const totalValue = element('span', 'total-value', total);
		totalValue.dataset.figure = 'memory';
		this.memoryTotal = element('b', '', totalValue).appendChild(document.createTextNode(''));
		element('span', 'unit', totalValue).append(' MiB');
		const aside = element('span', 'total-aside', total);
		aside.append('GPU ');
		this.memoryAside = element('b', '', aside).appendChild(document.createTextNode(''));
		const bar = element('div', 'mbar', memory);
		const legend = element('div', 'mlegend', memory);
		for (const [name, label, color] of MEMORY_PARTS) {
			this.memoryParts.push(new Part(bar, name, color));
			this.memoryRows.push(new MemoryRow(legend, name, label, color));
		}
		const note = element('p', 'footnote', memory);
		note.dataset.figure = 'page-memory';
		element('span', 'live', note);
		this.wholePage = { element: note, text: document.createTextNode('') };
		note.append(this.wholePage.text);

		const steps = this.pane('steps');
		const features = element('div', 'block', steps);
		sectionHead(features, 'Add-ons');
		this.featureList = element('div', 'feature-list', features);
		this.featureSection = features;
		features.hidden = true;
		const stepBox = element('div', 'block', steps);
		const stepHead = sectionHead(stepBox, 'GPU steps');
		this.stepMeta = stepHead.text;
		this.stepList = element('div', 'gsteps', stepBox);
		this.stepSection = stepBox;
		stepBox.hidden = true;
		this.stepsEmpty = element('p', 'empty', steps);
		this.stepsEmpty.append('No add-ons or timed GPU passes report figures.');
		this.stepsEmpty.hidden = true;

		const systems = this.pane('systems');
		sectionHead(systems, 'Memory by system');
		this.areaList = element('div', 'areas', systems);
		const headRow = element('div', 'head', this.areaList);
		for (const label of ['System', 'Used', 'Reserved', 'Peak'])
			element('span', '', headRow).append(label);
		this.registerSection = this.areaList;
		this.registerEmpty = element('p', 'empty', systems);
		this.registerEmpty.append('No memory report in this build.');
		this.registerEmpty.hidden = true;

		this.element = card;
	}

	/** The pane of a tab. */
	private pane(tab: StatsTab): HTMLElement {
		return this.panes.get(tab) as HTMLElement;
	}

	/** Shows a tab, and hides the others. */
	private showTab(tab: StatsTab): void {
		if (!this.selection.select(tab)) return;
		this.applyTabs();
	}

	/** Gives the buttons and the panes the state of the chosen tab. */
	private applyTabs(): void {
		for (let k = 0; k < STATS_TABS.length; k++) {
			const tab = STATS_TABS[k] as StatsTab;
			const selected = this.selection.visible(tab);
			const button = this.tabButtons[k] as HTMLButtonElement;
			button.setAttribute('aria-selected', String(selected));
			button.tabIndex = selected ? 0 : -1;
			this.pane(tab).hidden = !selected;
		}
	}

	/** Moves between tabs with the arrow keys, and to the ends with Home and End. */
	private readonly tabKey = (event: KeyboardEvent): void => {
		const first = STATS_TABS[0] as StatsTab;
		const last = STATS_TABS[STATS_TABS.length - 1] as StatsTab;
		if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			event.stopPropagation();
			const index = event.key === 'Home' ? 0 : STATS_TABS.length - 1;
			this.showTab(event.key === 'Home' ? first : last);
			(this.tabButtons[index] as HTMLButtonElement).focus();
			return;
		}
		const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (delta === 0) return;
		event.preventDefault();
		event.stopPropagation();
		this.selection.move(delta);
		this.applyTabs();
		(this.tabButtons[STATS_TABS.indexOf(this.selection.tab)] as HTMLButtonElement).focus();
	};

	/**
	 * Shows a set of figures against the target frame rate, beside the display's refresh rate
	 * `refreshHz`, 0 before it is measured. `gpuTimer` is false where the GPU path cannot time its
	 * work, and the GPU's figure then says that it is not measured. `bothSteps` names the thread that
	 * runs the sketch and then draws, where one thread does both: its bar holds both steps. `mode`
	 * picks the symbol before the target that explains how the threads share a frame.
	 */
	update(
		figures: StatsFigures,
		target: number,
		refreshHz: number,
		gpuTimer: boolean,
		bothSteps: string | undefined,
		mode: FrameMode,
	): void {
		this.mode.set(mode);
		const targetMs = 1000 / target;
		// Each bar spans twice the target's interval, so the target's mark is in its middle.
		const scale = targetMs * 2;
		this.target.update(target, refreshHz, this.lanes);
		setText(this.scale, `scale 0–${ms(scale)}`);
		setText(this.heading, figures.heading);
		const waiting = figures.frames === 0;
		const gpuMs = waiting ? null : figures.gpuMs;
		const gpuText = gpuMs !== null ? ms(gpuMs) : gpuTimer ? 'measuring' : 'not measured';
		const { threads } = this;
		threads.update(figures.threads, bothSteps);
		this.showThread(this.both, threads.both, waiting, targetMs, scale, true);
		this.showThread(this.sketch, threads.sketch, waiting, targetMs, scale);
		this.showThread(this.drawing, threads.drawing, waiting, targetMs, scale);
		this.showThread(this.jobs, threads.slowestJob, waiting, targetMs, scale);
		this.jobs.setCount(threads.jobs);
		this.showThread(this.page, threads.page, waiting, targetMs, scale);
		if (gpuMs !== null) this.gpu.set(gpuMs, 0, targetMs, scale);
		else this.gpu.note(gpuText);
		// Below the share of the target that a preset must hold, a line names what holds it back.
		const held = !waiting && rateLevel(figures.presentedFps, target) !== 'ok';
		this.heldBack.element.hidden = !held;
		if (held) setText(this.heldBack.text, `Held back by: ${threads.heldBackBy(targetMs, gpuMs)}`);
		// A scene whose update threw still presents, so the rates hide it. A red line names it.
		const failed = figures.updateErrors ?? 0;
		this.updateError.element.hidden = failed <= 0;
		if (failed > 0)
			setText(
				this.updateError.text,
				`The scene's update failed in ${Math.round(failed)} of the last ${figures.frames} frames: the frames still present.`,
			);
		setText(this.draws, `${Math.round(figures.drawCalls)}`);
		setText(this.triangles, count(figures.triangles));
		setText(this.objects, count(figures.objects));
		this.updateMemory(figures);
		this.updateFeatures(figures.features ?? []);
		this.updateGpuSteps(figures.gpuSteps ?? []);
		this.stepsEmpty.hidden = !(this.featureSection.hidden && this.stepSection.hidden);
		this.updateAreas(figures.memoryAreas);
	}

	/**
	 * The frame's GPU steps: one line for each pass that the GPU timed one by one, with the step's
	 * name and its time per frame. The section hides where the GPU path times the frame alone.
	 */
	private updateGpuSteps(steps: readonly StatsGpuStep[]): void {
		const shown = steps.filter((step) => step.ms >= SHOWN_STEP_MS);
		this.stepSection.hidden = shown.length === 0;
		setText(this.stepMeta, `${shown.length} ${shown.length === 1 ? 'pass' : 'passes'} · ms`);
		for (let k = 0; k < shown.length; k++) {
			let entry = this.stepRows[k];
			if (!entry) {
				const row = element('div', 'gstep', this.stepList);
				element('span', 'idx', row).append(`${k + 1}`);
				const name = figure('span', `gpu-step:${k}`, row, 'name').text;
				const value = figure('span', `gpu-step:${k}:ms`, row, 'val').text;
				entry = { row, name, value };
				this.stepRows.push(entry);
			}
			const step = shown[k] as StatsGpuStep;
			entry.row.hidden = false;
			setText(entry.name, step.name);
			setText(entry.value, `${step.ms.toFixed(2)} ms`);
		}
		for (let k = shown.length; k < this.stepRows.length; k++)
			(this.stepRows[k] as { row: HTMLElement }).row.hidden = true;
	}

	/**
	 * The memory register's rows: one line per area with the bytes that it uses, reserves and has
	 * used at most. The table hides where no page asked for a report.
	 */
	private updateAreas(areas: readonly StatsMemoryArea[] | undefined): void {
		const shown = areas !== undefined && areas.length > 0;
		this.registerSection.hidden = !shown;
		this.registerEmpty.hidden = shown;
		if (!areas) return;
		for (const area of areas) {
			let row = this.areaRows.get(area.name);
			if (!row) {
				const line = element('div', 'area', this.areaList);
				const name = figure('span', `area:${area.name}`, line, 'name');
				setText(name.text, area.name);
				row = {
					row: line,
					used: figure('span', `area:${area.name}:used`, line).text,
					reserved: figure('span', `area:${area.name}:reserved`, line).text,
					peak: figure('span', `area:${area.name}:peak`, line).text,
				};
				this.areaRows.set(area.name, row);
			}
			setText(row.used, mibText(tenthsOfMib(area.usedBytes)));
			setText(row.reserved, mibText(tenthsOfMib(area.reservedBytes)));
			setText(row.peak, mibText(tenthsOfMib(area.peakBytes)));
			exact(row.used, area.usedBytes);
			exact(row.reserved, area.reservedBytes);
			exact(row.peak, area.peakBytes);
			const used = area.usedBytes > 0 || area.reservedBytes > 0 || area.peakBytes > 0;
			row.row.classList.toggle('zero', !used);
		}
	}

	/**
	 * The add-ons' rows: one line per feature with its GPU time, its settings, its budget and its
	 * memory. The section hides while no feature reports figures.
	 */
	private updateFeatures(features: readonly FeatureStats[]): void {
		this.featureSection.hidden = features.length === 0;
		const seen = new Set<string>();
		for (const feature of features) {
			seen.add(feature.name);
			let row = this.featureRows.get(feature.name);
			if (!row) {
				row = new FeatureRow(this.featureList, feature.name);
				this.featureRows.set(feature.name, row);
			}
			// The figure is green while the feature stays inside its allowance, and warmer past it.
			const level = featureLevel(feature.gpuMs, feature.allowedMs);
			row.set(featureGpu(feature), level, feature.gpuMs === null, featureFacts(feature));
		}
		for (const [name, row] of this.featureRows) {
			if (seen.has(name)) continue;
			row.element.remove();
			this.featureRows.delete(name);
		}
	}

	/** A thread's lane, hidden where the engine runs no such thread. */
	private showThread(
		lane: Lane,
		thread: StatsThread | undefined,
		waiting: boolean,
		targetMs: number,
		scale: number,
		drawing = false,
	): void {
		if (!thread) lane.hide();
		else if (waiting) lane.note('measuring');
		else lane.set(thread.busyMs, codeMs(thread), targetMs, scale, drawing ? drawingMs(thread) : 0);
	}

	/**
	 * The memory bar: the engine's memory, the GPU's textures and buffers, and the page's
	 * JavaScript heap, each where the page knows it, adding up to the total. The browser's
	 * whole-page figure counts a shared memory once for each thread that holds it, so it shows on
	 * its own line.
	 */
	private updateMemory(figures: StatsFigures): void {
		const { memory } = figures;
		const parts = this.memory;
		parts[0] = memoryPart(memory.wasmBytes);
		parts[1] = memoryPart(memory.gpuTextureBytes);
		parts[2] = memoryPart(memory.gpuBufferBytes);
		parts[3] = memoryPart(memory.jsHeapBytes);
		let total = 0;
		for (const part of parts) if (part > 0) total += part;
		setText(this.memoryTotal, `${(total / 10).toFixed(1)}`);
		let at = 0;
		for (let k = 0; k < parts.length; k++) {
			const part = parts[k] as number;
			const share = total > 0 && part > 0 ? part / total : 0;
			(this.memoryParts[k] as Part).place(at, share);
			(this.memoryRows[k] as MemoryRow).set(part < 0 ? null : part, share);
			at += share;
		}
		const gpu = (parts[1] > 0 ? parts[1] : 0) + (parts[2] > 0 ? parts[2] : 0);
		const share = total > 0 ? Math.round((gpu / total) * 100) : 0;
		setText(this.memoryAside, `${share}%`);
		const page = memory.page;
		this.wholePage.element.hidden = page === null;
		if (!page) return;
		let text = 'measuring';
		if (page.browserBytes !== null) {
			text = mibText(tenthsOfMib(page.browserBytes));
			if (page.bytes !== null && page.bytes !== page.browserBytes)
				text += ` (${mibText(tenthsOfMib(page.bytes))} with shared memory counted once)`;
		}
		setText(this.wholePage.text, `Whole page, as the browser counts it: ${text}`);
	}
}

/** A section's head: its label and its note on the right, whose text the caller fills. */
function sectionHead(parent: Node, label: string): { element: HTMLElement; text: Text } {
	const head = element('div', 'sect-head', parent);
	element('span', 'sect-label', head).append(label);
	const meta = element('span', 'meta', head);
	const text = document.createTextNode('');
	meta.append(text);
	return { element: meta, text };
}

/** A cell of the counts: the figure over its label. */
function countCell(parent: Node, name: string): Text {
	const cell = element('div', 'fig', parent);
	const value = figure('b', name, cell).text;
	element('small', '', cell).textContent = name;
	return value;
}
