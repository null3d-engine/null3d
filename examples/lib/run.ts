// Starts a demo on a canvas. The examples page uses it, and so can any page that shows the demos
// in a layout of its own, such as the website's: the page owns the canvas, the text and the
// styles, and this module owns how a demo starts.
import {
	createEngine,
	type Engine,
	type QualityPreset,
	type StartupProgress,
	type StartupStage,
} from '@null3d/engine';
import type { Demo } from '../demos';
import type { HudGroup } from './controls';
import { createDrivePad } from './drive-pad';
import { createHud } from './hud';
import { bytesOf, LoadMeter, type LoadPhase } from './progress';

/** The message that a demo posts to show a label, or to change its text. */
interface LabelMessage {
	/** The id that the sketch tracks the label under with ui.trackLabel. */
	id: string;
	text: string;
	/** A line under the text, for a `'page'` element. */
	detail?: string;
	/** True to highlight the label, such as for a selected object. */
	active?: boolean;
	/** The element's width in CSS pixels, for a label that is a plane of the scene. */
	width?: number;
	/**
	 * The element's height in CSS pixels, for a label that is a plane of the scene. A label with
	 * `kind: 'page'` is a page of its own, with a title bar and the text and detail on it.
	 */
	height?: number;
	/** `'page'` shows the element as a small embedded page; the default is plain text. */
	kind?: 'text' | 'page';
}

export interface StartOptions {
	canvas: HTMLCanvasElement;
	demo: Demo;
	/**
	 * The element that holds the demo's labels: it should cover the canvas and let the pointer
	 * through. Each label is a div with the class `label`, and `active` while the demo highlights
	 * it. Without a layer, the demo shows no labels. A demo with `backdrop` puts the layer below
	 * its canvas instead.
	 */
	labels?: HTMLElement;
	/**
	 * True shows the engine's stats overlay over the canvas's top-right corner, collapsed to its
	 * frame rate, which is the default. False leaves it off. The `?stats=off` switch hides it too,
	 * and a held frame never shows it.
	 */
	stats?: boolean;
	/**
	 * The quality preset that the page's address names. A production build reads no URL switches,
	 * so the page reads `?preset=` itself and passes it here. `createEngine`'s own switch wins in a
	 * development build.
	 */
	preset?: QualityPreset;
	/**
	 * The element that holds the buttons of the demo's choices, such as a time of day, for a demo
	 * that has some. Without it, the demo runs with its own first options.
	 */
	choices?: HTMLElement;
	/**
	 * The element that holds the demo's on-screen help, which a showcase scene posts: its keys and
	 * the camera mode. Without it, the demo shows no help. A held frame has none.
	 */
	hud?: HTMLElement;
	/**
	 * Aborting it removes the listeners, the loading overlay and the controls HUD that this demo
	 * added, so a page that starts a second demo in the same document leaves nothing of the first.
	 * The page still owns the canvas, its own elements and the engine.
	 */
	signal?: AbortSignal;
}

/** How long the loading overlay waits after the last loading message before it hides, in ms. */
const LOADER_QUIET_MS = 400;
/** The most of the sketch's early messages that the page keeps, as the engine keeps its own. */
const MAX_EARLY_MESSAGES = 256;

/** Starts the demo's sketch on the canvas, and resolves to its engine once it runs. */
export async function startDemo({
	canvas,
	demo,
	labels,
	stats = true,
	preset,
	choices,
	hud,
	signal,
}: StartOptions): Promise<Engine> {
	// The demos zoom with the wheel and a trackpad pinch, which would otherwise scroll or zoom the page.
	canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false, signal });
	// The loading overlay covers the canvas from before the engine starts until the first frame draws.
	const loader = createLoader(canvas);
	// A stopped demo takes its loading overlay away with it; the controls HUD follows below.
	signal?.addEventListener('abort', () => loader.hide());
	// A demo with a backdrop draws over a page: the backdrop and the labels' layer go behind the
	// canvas, and the engine draws on a see-through canvas above them.
	const behind = demo.backdrop === true;
	if (behind) {
		const parent = canvas.parentElement;
		if (parent) {
			const page = createBackdrop();
			parent.insertBefore(page, canvas);
			// The canvas paints over the backdrop and the labels. A canvas in the page's flow keeps
			// its place with a relative position, which changes no layout.
			if (getComputedStyle(canvas).position === 'static') canvas.style.position = 'relative';
			if (labels) parent.insertBefore(labels, canvas);
			// A stopped demo takes its backdrop away with it, as it takes its overlay.
			signal?.addEventListener('abort', () => page.remove());
		}
	}
	// A scene that builds in stages posts its own loading messages, and its worker can outlive the
	// engine's first frame. The overlay then waits for a quiet gap after the last message or the
	// frame, so it fades once at the end of the build rather than twice over a drawn scene.
	let firstFrame = false;
	let firstFrameAt = 0;
	let lastLoadingAt = 0;
	const hideWhenQuiet = (): void => {
		if (!firstFrame) return;
		// A scene that posts nothing hides at the first frame. One that reports its own stages waits
		// for a quiet gap after the frame or its last message, so a stage that arrives late never
		// changes a card that is already going.
		const from = lastLoadingAt === 0 ? 0 : Math.max(lastLoadingAt, firstFrameAt);
		const wait = from + LOADER_QUIET_MS - performance.now();
		if (wait > 0) window.setTimeout(hideWhenQuiet, wait);
		else loader.hide();
	};
	const reachedFirstFrame = (): void => {
		firstFrame = true;
		firstFrameAt = performance.now();
		hideWhenQuiet();
	};
	let engine: Engine | undefined;
	/** The sketch's messages that needed the engine, before it existed. */
	const early: [string, unknown][] = [];
	/** The handlers of the messages that carry the demo's labels, controls and help. */
	let readers: ((type: string, data: unknown) => void)[] = [];
	// The page passes this handler at the start, so the sketch's loading messages arrive as its
	// setup runs rather than all at once at the end: the overlay follows the scene's own progress.
	const handleMessage = (type: string, data: unknown): void => {
		if (type === 'loading') {
			lastLoadingAt = performance.now();
			loader.note(data);
			hideWhenQuiet();
			return;
		}
		if (!engine) {
			if (early.push([type, data]) > MAX_EARLY_MESSAGES) early.shift();
			return;
		}
		for (const reader of readers) reader(type, data);
	};
	try {
		// Without a preset: the engine's start-up check picks one that the device holds at its frame
		// rate. A production build reads no URL switches, so the page passes the address's preset.
		engine = await createEngine({
			canvas,
			sketch: demo.sketch,
			largeWorld: demo.largeWorld,
			hdr: demo.hdr,
			momentTransparency: demo.momentTransparency,
			transparent: behind,
			preset,
			// Collapsed, the overlay stays small until clicked.
			stats: stats && { collapsed: true },
			onProgress: (stage: StartupStage, progress?: StartupProgress) => {
				// The loader hears of the first frame through `hideWhenQuiet`, with any last message.
				if (stage === 'first-frame') {
					reachedFirstFrame();
					return;
				}
				loader.stage(stage, progress);
			},
			onSketchMessage: handleMessage,
		});
	} catch (error) {
		loader.fail(error instanceof Error ? error.message : String(error));
		throw error;
	}
	if (choices) showChoices(engine, demo, choices);
	// One message handler for the page: the engine gives the messages that a sketch sent before the
	// page listened to the first handler alone, so two handlers would drop the help that a showcase
	// scene posts at its start. The same handler carries the loading progress that a scene posts.
	readers = [
		...(labels ? [labelReader(engine, labels)] : []),
		...(hud
			? [hudReader(engine, hud, signal), padReader(engine, hud, signal), pressReader(engine)]
			: []),
	];
	// The engine's start handler stays the sketch's one handler, so the messages that arrived before
	// the readers existed now reach them in the order that the sketch sent them.
	for (const [type, data] of early.splice(0)) handleMessage(type, data);
	// The overlay leaves once the first frame is drawn and the scene's own loading has gone quiet,
	// so a stage that reports after the frame never changes a card that is already going.
	void engine.firstFrame.then(reachedFirstFrame, reachedFirstFrame);
	// Browsers lock the pointer only right after the user acts, and refuse it on phones.
	if (demo.pointerLock)
		canvas.addEventListener('click', () => engine.requestPointerLock().catch(() => {}), { signal });
	return engine;
}

/** The text that a scene posts while it loads its files, for the loading overlay. */
interface LoadingMessage {
	/** What the scene is doing now, such as how many files have loaded. */
	text: string;
	/** A second line with the count, such as the bytes that arrived of a total. */
	detail?: string;
	/** How far the load has gone, from 0 to 1, for the bar. Without it, the bar keeps moving. */
	value?: number;
}

/** The loading overlay of a starting demo. */
export interface Loader {
	/** Shows the engine's start stage and the stage's figures, when it has some. */
	stage(stage: StartupStage, progress?: StartupProgress): void;
	/** Shows the progress that a scene posts while it loads its files. */
	note(data: unknown): void;
	/** Fades the overlay out; the first frame is drawn. */
	hide(): void;
	/** Shows the error text in place of the progress; the start failed. */
	fail(text: string): void;
}

/**
 * Makes the loading overlay over the canvas: a glass card that names the start's stage and any
 * progress a scene posts, in the style of the showcase HUD. A stage whose work is counted shows its
 * percentage over the bar, and one without a total leaves the bar moving. It fades out when the
 * first frame is drawn, and shows the error instead when the start fails.
 */
export function createLoader(canvas: HTMLCanvasElement): Loader {
	const host = canvas.parentElement ?? document.body;
	const overlay = document.createElement('div');
	overlay.className = 'loader';
	overlay.setAttribute('role', 'status');
	overlay.setAttribute('aria-live', 'polite');
	const box = document.createElement('div');
	box.className = 'loader__box';
	const head = document.createElement('div');
	head.className = 'loader__head';
	const label = document.createElement('p');
	label.className = 'loader__label';
	label.textContent = 'Loading the engine';
	// The visuals stay out of the live region: the hidden line below carries the text that a screen
	// reader announces, so a percentage that moves with every chunk never queues an announcement.
	label.setAttribute('aria-hidden', 'true');
	const percent = document.createElement('span');
	percent.className = 'loader__percent';
	percent.hidden = true;
	percent.setAttribute('aria-hidden', 'true');
	head.append(label, percent);
	const bar = document.createElement('div');
	bar.className = 'loader__bar';
	bar.setAttribute('aria-hidden', 'true');
	const fill = document.createElement('div');
	fill.className = 'loader__fill';
	bar.append(fill);
	const detail = document.createElement('p');
	detail.className = 'loader__detail';
	detail.setAttribute('aria-hidden', 'true');
	const say = document.createElement('p');
	say.className = 'loader__say';
	say.textContent = 'Loading the engine';
	box.append(head, bar, detail, say);
	overlay.append(box);
	host.append(overlay);
	const meter = new LoadMeter();
	let shown: LoadPhase | undefined;
	/** The phase that the engine's start named last, which a finished scene phase falls back to. */
	let enginePhase: LoadPhase = { key: 'loading', text: 'Loading the engine' };
	let painted = 0;
	let hidden = false;
	/** The last text that the live region holds, and the tenth of the percentage it names. */
	let said = 'Loading the engine';
	let saidTenth = -1;
	const paint = (): void => {
		painted = 0;
		const phase = shown;
		if (!phase || hidden) return;
		label.textContent = phase.text;
		detail.textContent = phase.detail ?? '';
		const value = phase.value;
		const whole = value === undefined ? undefined : Math.round(value * 100);
		percent.textContent = whole === undefined ? '' : `${whole}%`;
		percent.hidden = whole === undefined;
		fill.classList.toggle('loader__fill--set', whole !== undefined);
		// A width of none leaves the bar its travelling band, which a phase without a total shows.
		fill.style.width = whole === undefined ? '' : `${whole}%`;
		const tenth = whole === undefined ? -1 : Math.floor(whole / 10);
		if (phase.text !== said || tenth !== saidTenth) {
			said = phase.text;
			saidTenth = tenth;
			say.textContent = tenth < 0 ? phase.text : `${phase.text}, ${tenth * 10} per cent`;
		}
	};
	const show = (phase: LoadPhase): void => {
		shown = meter.show(phase);
		if (!painted && !hidden) painted = requestAnimationFrame(paint);
	};
	/** True when a figure is whole, as the card's whole-percent measure shows it. */
	const atEnd = (value?: number): boolean =>
		value !== undefined && Math.round(Math.min(1, Math.max(0, value)) * 100) >= 100;
	const hide = (): void => {
		if (hidden) return;
		hidden = true;
		if (painted) cancelAnimationFrame(painted);
		painted = 0;
		overlay.classList.add('loader--done');
		const remove = () => overlay.remove();
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) remove();
		else setTimeout(remove, 320);
	};
	return {
		stage(stage, progress) {
			if (stage === 'first-frame') {
				hide();
				return;
			}
			let phase: LoadPhase;
			if (stage === 'memory-wait') phase = { key: stage, text: 'Waiting for the engine memory' };
			else if (stage === 'core') phase = { key: stage, text: 'Starting the sketch' };
			else if (stage === 'sketch') phase = { key: stage, text: 'Drawing the first frame' };
			else {
				const done = progress?.done ?? 0;
				const total = progress?.total ?? 0;
				// A body that arrives larger than its announced length, as a compressed response can,
				// leaves no fraction to show: the bytes that arrived still count.
				const measured = total > 0 && done <= total;
				phase = {
					key: stage,
					text: 'Downloading the engine',
					detail: measured ? `${bytesOf(done)} of ${bytesOf(total)}` : bytesOf(done),
					value: measured ? done / total : undefined,
				};
			}
			enginePhase = phase;
			show(phase);
		},
		note(data) {
			if (typeof data === 'string') {
				show({ key: `note:${data}`, text: data });
				return;
			}
			const message = data as Partial<LoadingMessage> | null;
			if (!message || typeof message.text !== 'string') return;
			const phase: LoadPhase = {
				key: `note:${message.text}`,
				text: message.text,
				detail: typeof message.detail === 'string' ? message.detail : undefined,
				value: typeof message.value === 'number' ? message.value : undefined,
			};
			// A counted scene phase that reaches its total names its own end. The start then waits for
			// the scene to build, which the engine's own stage names, so a full bar never sits over a
			// scene that is still starting.
			show(atEnd(phase.value) ? enginePhase : phase);
		},
		hide,
		fail(text) {
			hidden = true;
			if (painted) cancelAnimationFrame(painted);
			painted = 0;
			overlay.classList.add('loader--error');
			label.textContent = text;
			label.classList.add('loader__label--error');
			percent.hidden = true;
			detail.hidden = true;
			bar.hidden = true;
			say.textContent = text;
		},
	};
}

/**
 * Shows each of the demo's choices as a group of buttons, and sends each pick to the sketch as a
 * message named by the choice. Each group is a `div` with the class `choice`, which holds a label
 * and a button for each option. The picked button has `aria-pressed="true"`, and the first option
 * starts picked, as the sketch starts with it.
 */
function showChoices(engine: Engine, demo: Demo, element: HTMLElement): void {
	for (const choice of demo.choices ?? []) {
		const group = document.createElement('div');
		group.className = 'choice';
		group.setAttribute('role', 'group');
		const label = document.createElement('span');
		label.textContent = choice.label;
		group.append(label);
		const buttons = choice.options.map((option, index) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = option;
			button.setAttribute('aria-pressed', String(index === 0));
			button.addEventListener('click', () => {
				for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
				engine.postToSketch(choice.name, option);
			});
			return button;
		});
		group.setAttribute('aria-label', choice.label);
		group.append(...buttons);
		element.append(group);
	}
}

/** Reads the labels that the demo posts, each into a tag that follows the label's object. */
function labelReader(engine: Engine, layer: HTMLElement): (type: string, data: unknown) => void {
	const tags = new Map<string, HTMLElement>();
	return (type, data) => {
		if (type !== 'label') return;
		const { id, text, detail, active = false, width, height, kind = 'text' } = data as LabelMessage;
		let tag = tags.get(id);
		if (!tag) {
			tag = kind === 'page' ? pageCard(width, height) : document.createElement('div');
			if (kind !== 'page') {
				// A label that is a plane of the scene is sized in CSS pixels, which are the scene's units.
				const sized = width !== undefined || height !== undefined;
				tag.className = sized ? 'label label--card' : 'label';
				if (width !== undefined) tag.style.width = `${width}px`;
				if (height !== undefined) tag.style.height = `${height}px`;
				if (sized) tag.style.boxSizing = 'border-box';
			}
			layer.append(tag);
			tags.set(id, tag);
			engine.labels.bind(id, tag);
		}
		const parts = pageParts.get(tag);
		if (parts) {
			parts.title.textContent = text;
			parts.detail.textContent = detail ?? '';
			return;
		}
		tag.textContent = text;
		tag.classList.toggle('active', active);
	};
}

/** The title and the detail of a page card, which the label's messages update. */
interface PageParts {
	title: HTMLElement;
	detail: HTMLElement;
}

/** The parts of each page card that a label's messages update. */
const pageParts = new WeakMap<HTMLElement, PageParts>();

/**
 * A label shown as a small embedded page: a title bar, a heading and a line of detail, sized in
 * CSS pixels. The page is styled through the DOM so it looks the same in any page's layout.
 */
function pageCard(width?: number, height?: number): HTMLElement {
	const card = document.createElement('div');
	card.className = 'label-page';
	Object.assign(card.style, {
		boxSizing: 'border-box',
		overflow: 'hidden',
		display: 'flex',
		flexDirection: 'column',
		borderRadius: '12px',
		border: '1px solid rgb(255 255 255 / 0.14)',
		background: 'linear-gradient(165deg, #141c29 0%, #0a0f18 60%, #0c1726 100%)',
		boxShadow: '0 30px 90px rgb(0 0 0 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.08)',
		color: '#e8f1ff',
		fontFamily: 'Helvetica, Arial, sans-serif',
		pointerEvents: 'none',
	});
	if (width !== undefined) card.style.width = `${width}px`;
	if (height !== undefined) card.style.height = `${height}px`;
	const bar = document.createElement('div');
	Object.assign(bar.style, {
		height: '26px',
		flex: '0 0 auto',
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
		padding: '0 12px',
		background: 'rgb(255 255 255 / 0.05)',
	});
	for (const tone of ['#ff6b5f', '#ffc94d', '#5fd48a']) {
		const dot = document.createElement('span');
		Object.assign(dot.style, {
			width: '7px',
			height: '7px',
			borderRadius: '50%',
			background: tone,
		});
		bar.append(dot);
	}
	const body = document.createElement('div');
	Object.assign(body.style, {
		flex: '1 1 auto',
		display: 'flex',
		flexDirection: 'column',
		justifyContent: 'center',
		alignItems: 'center',
		gap: '10px',
		padding: '0 26px',
		textAlign: 'center',
	});
	const title = document.createElement('div');
	Object.assign(title.style, { fontSize: '26px', fontWeight: '700', letterSpacing: '0.18em' });
	const detail = document.createElement('div');
	Object.assign(detail.style, {
		fontSize: '13px',
		lineHeight: '1.45',
		color: '#9fb6d4',
		maxWidth: '300px',
	});
	const action = document.createElement('div');
	action.textContent = 'Open the hall';
	Object.assign(action.style, {
		marginTop: '4px',
		padding: '7px 16px',
		borderRadius: '999px',
		fontSize: '12px',
		letterSpacing: '0.08em',
		background: 'rgb(126 180 255 / 0.18)',
		border: '1px solid rgb(126 180 255 / 0.35)',
		color: '#cfe4ff',
	});
	body.append(title, detail, action);
	card.append(bar, body);
	pageParts.set(card, { title, detail });
	return card;
}

/**
 * The page that a demo with `backdrop` draws over: a light surface behind the canvas, so the
 * see-through parts of the scene show the page rather than the layout's background.
 */
function createBackdrop(): HTMLElement {
	const page = document.createElement('div');
	page.className = 'demo-backdrop';
	page.setAttribute('aria-hidden', 'true');
	Object.assign(page.style, {
		position: 'absolute',
		inset: '0',
		pointerEvents: 'none',
		// A ruled page, so the see-through canvas reads as a layer over a document.
		background:
			'repeating-linear-gradient(0deg, rgb(32 42 62 / 0.05) 0 1px, transparent 1px 44px), ' +
			'repeating-linear-gradient(90deg, rgb(32 42 62 / 0.05) 0 1px, transparent 1px 44px), ' +
			'radial-gradient(120% 90% at 50% 0%, #ffffff 0%, #f2eee6 38%, #dfe6f0 100%)',
	});
	return page;
}

/**
 * Sends on a press that a scene's controls took in the world, such as on a vehicle's console, as
 * the page's own controls panel sends a press: the scene answers both alike.
 */
function pressReader(engine: Engine): (type: string, data: unknown) => void {
	return (type, data) => {
		if (type !== 'hud-press') return;
		const { name, value } = data as { name: string; value: string };
		engine.postToSketch(name, value);
	};
}

/**
 * Shows the on-screen driving pad while a scene that the user drives asks for it, with a
 * `drive-pad` message. The pad sits under the controls panel, which stays above it.
 */
function padReader(
	engine: Engine,
	hud: HTMLElement,
	signal?: AbortSignal,
): (type: string, data: unknown) => void {
	let pad: ReturnType<typeof createDrivePad> | undefined;
	signal?.addEventListener('abort', () => pad?.dispose());
	return (type, data) => {
		if (type !== 'drive-pad') return;
		const on = (data as { visible: boolean }).visible;
		// A scene that never drives makes no pad.
		if (!pad && !on) return;
		pad ??= createDrivePad(hud.parentElement ?? hud, hud, (name, value) =>
			engine.postToSketch(name, value),
		);
		pad.show(on);
	};
}

/** The message that a showcase scene posts with its controls. */
interface HudMessage {
	/** The groups of buttons: modes and effects, with the camera group first. */
	groups: HudGroup[];
	/** False hides the whole control. */
	visible: boolean;
}

/**
 * Draws the controls that a showcase scene posts: a chevron that opens a glass panel of grouped
 * buttons. A row with an action is a button, which sends the action's message to the sketch, so a
 * touch screen with no keyboard can press it. A held frame posts none.
 */
function hudReader(
	engine: Engine,
	element: HTMLElement,
	signal?: AbortSignal,
): (type: string, data: unknown) => void {
	const stage = element.parentElement ?? element;
	const hud = createHud(element, stage, (name, value) => engine.postToSketch(name, value));
	// The page may start another demo here: the HUD leaves with the demo's own signal.
	signal?.addEventListener('abort', () => hud.dispose());
	return (type, data) => {
		if (type !== 'hud') return;
		const { groups, visible } = data as HudMessage;
		hud.render({ groups }, visible);
	};
}
