// The stats overlay's look: its style sheet, its header button, and the card of figures under the
// header. The overlay (overlay.ts) decides what shows, where and when; this file decides how it
// looks, so a new design changes this file alone.
//
// The header is a light pill: a ring gauge of the frame rate as a share of the target, the frame
// rate, and a chevron. The card holds one bar of work per frame for each engine thread and one for
// the GPU, all against the target, then memory as a bar of parts with a legend, and the counts of
// draws, triangles and objects. The work bars are colored by who did the work: the sketch's own
// code (its update step), the engine (every other step), or the GPU. A bar stacks parts only where
// they add up to the figure beside it: a thread's steps run one after another and add up to its
// time, and the memory parts add up to the total. Threads run side by side and the GPU works
// beside them, so each has its own bar. The job workers share one bar with the slowest worker's
// time, since they share one step of the frame and the frame waits for the slowest.
//
// Above the bars, a display symbol leads the display's refresh rate and the target, which can be
// lower: the engine draws at the display's rate and defends the target. Each bar's dark mark sits
// at the target's interval, and a faint mark at the display's shorter interval. The symbols carry
// tooltips with the full words, so the card stays short.
//
// The first update builds the card, and later updates change text, bar widths and levels only.
// Bar widths come from a table of widths made once, so a bar that moves allocates nothing. A
// level, ok, warn or bad, is a data attribute that the style sheet colors.
//
// The style sheet lives in the overlay's shadow root, so the page's styles do not reach the
// overlay and its styles do not reach the page. A style sheet made in script passes a Content
// Security Policy without 'unsafe-inline'. Browsers without one get a style element instead.

import { type Level, rateLevel, workLevel } from './frame-target';
import { count, type StatsFigures, type StatsThread } from './stats-text';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const CSS = `
.panel {
	--ok: #23a862;
	--warn: #e09a17;
	--bad: #e04a3c;
	--ok-text: #15703f;
	--warn-text: #875400;
	--bad-text: #b3302a;
	--code: #2f6fde;
	--engine: #8a5cf0;
	--gpu: #14a39a;
	--drawing: #b79cf5;
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
	color: #10141a;
	pointer-events: none;
}
[hidden] { display: none !important; }
button {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	padding: 4px 10px 4px 4px;
	border: 0;
	border-radius: 999px;
	font: 600 13px/1.35 ${FONT};
	font-variant-numeric: tabular-nums;
	color: #10141a;
	background: rgba(250, 251, 253, 0.94);
	box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
	cursor: pointer;
	pointer-events: auto;
}
button:focus-visible { outline: 2px solid #2f6fde; outline-offset: 3px; }
.ring { width: 26px; height: 26px; flex: none; }
.ring circle { fill: none; stroke-width: 4; }
.ring .track { stroke: #dfe3e8; }
.ring .arc { stroke: transparent; stroke-linecap: round; stroke-dasharray: 87.96; }
.ring[data-level='ok'] .arc { stroke: var(--ok); }
.ring[data-level='warn'] .arc { stroke: var(--warn); }
.ring[data-level='bad'] .arc { stroke: var(--bad); }
.chevron { width: 10px; height: 10px; flex: none; transition: transform 0.18s ease; }
button[aria-expanded='true'] .chevron { transform: rotate(180deg); }
.card {
	display: grid;
	gap: 12px;
	width: min(320px, 78vw);
	box-sizing: border-box;
	padding: 14px;
	border-radius: 16px;
	background: rgba(250, 251, 253, 0.95);
	box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
}
h3 {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	margin: 0;
	font: 600 10px/1.35 ${FONT};
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: #5b6573;
}
h3 span { text-transform: none; letter-spacing: 0; font-weight: 500; }
.work { display: grid; gap: 7px; }
.lanes { display: grid; grid-template-columns: auto 1fr auto; gap: 7px 8px; align-items: center; }
.lane { display: contents; }
.name { font-weight: 600; white-space: nowrap; }
.name small { font-weight: 500; color: #5b6573; }
.value { text-align: right; font-weight: 600; white-space: nowrap; }
.lane[data-level='ok'] .value { color: var(--ok-text); }
.lane[data-level='warn'] .value { color: var(--warn-text); }
.lane[data-level='bad'] .value { color: var(--bad-text); }
.bar { position: relative; height: 8px; border-radius: 4px; background: #e6eaef; overflow: hidden; }
.part { position: absolute; top: 0; bottom: 0; left: 0; width: 0; }
.mark { position: absolute; top: -2px; bottom: -2px; left: 50%; width: 2px; margin-left: -1px; background: #10141a; }
.mark.display { opacity: 0.3; }
.key { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: #3b4450; }
.key > span { display: inline-flex; align-items: center; }
.swatch { display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 2px; }
.code { background: var(--code); }
.engine { background: var(--engine); }
.gpu { background: var(--gpu); }
.drawing { background: var(--drawing); }
.aside { display: inline-flex; align-items: center; gap: 6px; }
.note { position: relative; display: inline-flex; }
.note button {
	width: 16px;
	height: 16px;
	padding: 0;
	border-radius: 50%;
	color: #2f6fde;
	background: none;
	box-shadow: none;
	cursor: help;
}
.note button svg { width: 16px; height: 16px; }
.note button:focus-visible { outline-offset: 2px; }
.tip {
	position: absolute;
	top: 22px;
	right: -6px;
	z-index: 1;
	width: 220px;
	padding: 8px 10px;
	border-radius: 8px;
	font: 400 11px/1.4 ${FONT};
	letter-spacing: 0;
	text-transform: none;
	color: #f2f4f7;
	background: #10141a;
	box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
	opacity: 0;
	visibility: hidden;
	transition: opacity 0.12s ease;
}
.note:hover .tip, .note button:focus-visible + .tip, .note[data-open='true'] .tip { opacity: 1; visibility: visible; }
.stack { position: relative; height: 10px; margin-top: 6px; border-radius: 5px; overflow: hidden; background: #e3e7ec; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; color: #3b4450; }
.legend > span { display: inline-flex; align-items: center; gap: 5px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.muted { color: #5b6573; }
.counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding-top: 10px; border-top: 1px solid #dfe3e8; }
.counts b { display: block; font-size: 14px; }
.counts small { font-size: 11px; color: #5b6573; }
.heading { font-size: 11px; }
.held { font-size: 12px; font-weight: 600; color: var(--bad-text); }
@media (prefers-reduced-motion: reduce) { .chevron, .tip { transition: none; } }
`;

/** The parts of the memory bar: each figure's name, label and color. */
const MEMORY_PARTS = [
	['engine-memory', 'Engine', '#2f6fde'],
	['gpu-textures', 'GPU textures', '#8e6cf0'],
	['gpu-buffers', 'GPU buffers', '#b79cf5'],
	['js-heap', 'JS heap', '#23a862'],
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

/** Sets an element's level attribute, when it changed. */
function setLevel(node: HTMLElement | SVGElement, level: Level | undefined): void {
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

/** How the engine's threads share a frame's work, as the card explains it. */
export type FrameMode = 'pipelined' | 'low' | 'single';

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
		const note = element('span', 'note', parent);
		const button = element('button', '', note);
		button.type = 'button';
		button.setAttribute('aria-describedby', id);
		const tip = element('span', 'tip', note);
		tip.id = id;
		tip.setAttribute('role', 'tooltip');
		button.addEventListener('click', (event) => {
			note.dataset.open = note.dataset.open === 'true' ? 'false' : 'true';
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
		this.display = figure('span', 'display', parent, 'muted');
		this.target = figure('span', 'target', parent).text;
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
		const button = element('button', '');
		button.type = 'button';
		const ring = svg('svg', { class: 'ring', viewBox: '0 0 36 36', 'aria-hidden': 'true' }, button);
		const circle = { cx: '18', cy: '18', r: '14' };
		svg('circle', { ...circle, class: 'track' }, ring);
		this.arc = svg('circle', { ...circle, class: 'arc', transform: 'rotate(-90 18 18)' }, ring);
		this.rate = figure('span', 'fps', button).text;
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
		this.element = element('span', className, parent);
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

	constructor(parent: Node, name: string, label: string, kind: 'thread' | 'both' | 'jobs' | 'gpu') {
		const lane = element('div', 'lane', parent);
		const title = element('span', 'name', lane);
		title.append(label);
		if (kind === 'jobs') {
			title.append(' ');
			this.count = element('small', '', title).appendChild(document.createTextNode(''));
		}
		const bar = element('div', 'bar', lane);
		if (kind === 'thread' || kind === 'both') this.code = new Part(bar, 'part code');
		this.work = new Part(bar, kind === 'gpu' ? 'part gpu' : 'part engine');
		if (kind === 'both') this.drawing = new Part(bar, 'part drawing');
		element('span', 'mark', bar);
		this.display = element('span', 'mark display', bar);
		this.display.hidden = true;
		this.value = figure('span', name, lane, 'value').text;
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

/** An item of a legend: a color, a name, and a value. */
class LegendItem {
	readonly element: HTMLSpanElement;
	private readonly value: Text;

	constructor(parent: Node, name: string, label: string, color: string) {
		const item = element('span', '', parent);
		element('i', 'dot', item).style.background = color;
		item.append(`${label} `);
		this.value = figure('b', name, item).text;
		this.element = item;
	}

	/** Shows the value, or hides the item for null. */
	set(text: string | null): void {
		this.element.hidden = text === null;
		if (text !== null) setText(this.value, text);
	}
}

/** The figures under the header, which `update` fills. */
export class StatsCard {
	readonly element: HTMLDivElement;
	private readonly target: TargetFigures;
	private readonly mode: ModeNote;
	private readonly both: Lane;
	private readonly sketch: Lane;
	private readonly drawing: Lane;
	private readonly jobs: Lane;
	private readonly page: Lane;
	private readonly gpu: Lane;
	private readonly lanes: readonly Lane[];
	private readonly heldBack: { element: HTMLElement; text: Text };
	private readonly memoryTotal: Text;
	private readonly memoryParts: Part[] = [];
	private readonly memoryKeys: LegendItem[] = [];
	private readonly wholePage: { element: HTMLElement; text: Text };
	private readonly draws: Text;
	private readonly triangles: Text;
	private readonly objects: Text;
	private readonly heading: Text;
	private readonly threads = new WorkThreads();
	/** Each memory part in tenths of a MiB, or -1 where the page does not know it. */
	private readonly memory = new Int32Array(MEMORY_PARTS.length);

	constructor() {
		const card = element('div', 'card');
		const work = element('div', 'work', card);
		const title = element('h3', '', work);
		title.append('Frame work');
		const aside = element('span', 'aside', title);
		this.mode = new ModeNote(aside);
		this.target = new TargetFigures(aside);
		const key = element('div', 'key', work);
		for (const [className, label] of [
			['code', 'Your code'],
			['engine', 'Engine'],
			['gpu', 'GPU'],
		]) {
			const item = element('span', '', key);
			element('i', `swatch ${className}`, item);
			item.append(label as string);
		}
		const lanes = element('div', 'lanes', work);
		this.both = new Lane(lanes, 'sketch-drawing', 'Sketch + drawing', 'both');
		this.sketch = new Lane(lanes, 'sketch', 'Sketch', 'thread');
		this.drawing = new Lane(lanes, 'drawing', 'Drawing', 'thread');
		this.jobs = new Lane(lanes, 'jobs', 'Jobs', 'jobs');
		this.page = new Lane(lanes, 'page', 'Page', 'thread');
		this.gpu = new Lane(lanes, 'gpu', 'GPU', 'gpu');
		this.lanes = [this.both, this.sketch, this.drawing, this.jobs, this.page, this.gpu];
		this.heldBack = figure('div', 'held-back', work, 'held');
		const memory = element('div', '', card);
		const heading = element('h3', '', memory);
		heading.append('Memory');
		this.memoryTotal = figure('span', 'memory', heading).text;
		const stack = element('div', 'stack', memory);
		const legend = element('div', 'legend', card);
		for (const [name, label, color] of MEMORY_PARTS) {
			this.memoryParts.push(new Part(stack, 'part', color));
			this.memoryKeys.push(new LegendItem(legend, name, label, color));
		}
		this.wholePage = figure('div', 'page-memory', card, 'muted');
		const counts = element('div', 'counts', card);
		this.draws = countCell(counts, 'draws');
		this.triangles = countCell(counts, 'triangles');
		this.objects = countCell(counts, 'objects');
		this.heading = figure('div', 'heading', card, 'muted heading').text;
		this.element = card;
	}

	/**
	 * Shows a set of figures against the target frame rate, beside the display's refresh rate
	 * `refreshHz`, 0 before it is measured. `gpuTimer` is false where the GPU path cannot time its
	 * work, and the GPU lane then says that it is not measured. `bothSteps` names the thread that
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
		setText(this.heading, figures.heading);
		const waiting = figures.frames === 0;
		const { threads } = this;
		threads.update(figures.threads, bothSteps);
		this.showThread(this.both, threads.both, waiting, targetMs, scale, true);
		this.showThread(this.sketch, threads.sketch, waiting, targetMs, scale);
		this.showThread(this.drawing, threads.drawing, waiting, targetMs, scale);
		this.showThread(this.jobs, threads.slowestJob, waiting, targetMs, scale);
		this.jobs.setCount(threads.jobs);
		this.showThread(this.page, threads.page, waiting, targetMs, scale);
		const gpuMs = waiting ? null : figures.gpuMs;
		if (gpuMs !== null) this.gpu.set(gpuMs, 0, targetMs, scale);
		else this.gpu.note(gpuTimer ? 'measuring' : 'not measured');
		// Below the share of the target that a preset must hold, a line names what holds it back.
		const held = !waiting && rateLevel(figures.presentedFps, target) !== 'ok';
		this.heldBack.element.hidden = !held;
		if (held) setText(this.heldBack.text, `Held back by: ${threads.heldBackBy(targetMs, gpuMs)}`);
		this.updateMemory(figures);
		setText(this.draws, `${Math.round(figures.drawCalls)}`);
		setText(this.triangles, count(figures.triangles));
		setText(this.objects, count(figures.objects));
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
		setText(this.memoryTotal, mibText(total));
		let at = 0;
		for (let k = 0; k < parts.length; k++) {
			const part = parts[k] as number;
			const share = total > 0 && part > 0 ? part / total : 0;
			(this.memoryParts[k] as Part).place(at, share);
			(this.memoryKeys[k] as LegendItem).set(part < 0 ? null : mibText(part));
			at += share;
		}
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

/** A cell of the counts: the figure over its label. */
function countCell(parent: Node, name: string): Text {
	const cell = element('div', '', parent);
	const value = figure('b', name, cell).text;
	element('small', '', cell).textContent = name;
	return value;
}
