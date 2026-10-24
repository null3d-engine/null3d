// Starts a demo on a canvas. The examples page uses it, and so can any page that shows the demos
// in a layout of its own, such as the website's: the page owns the canvas, the text and the
// styles, and this module owns how a demo starts.
import { createEngine, type Engine, type StartupStage } from '@null3d/engine';
import type { Demo } from '../demos';
import type { HudGroup } from './controls';
import { createHud } from './hud';

/** The message that a demo posts to show a label, or to change its text. */
interface LabelMessage {
	/** The id that the sketch tracks the label under with ui.trackLabel. */
	id: string;
	text: string;
	/** True to highlight the label, such as for a selected object. */
	active?: boolean;
	/** The element's width in CSS pixels, for a label that is a plane of the scene. */
	width?: number;
	/** The element's height in CSS pixels, for a label that is a plane of the scene. */
	height?: number;
}

export interface StartOptions {
	canvas: HTMLCanvasElement;
	demo: Demo;
	/**
	 * The element that holds the demo's labels: it should cover the canvas and let the pointer
	 * through. Each label is a div with the class `label`, and `active` while the demo highlights
	 * it. Without a layer, the demo shows no labels.
	 */
	labels?: HTMLElement;
	/**
	 * True shows the engine's stats overlay over the canvas's top-right corner, collapsed to its
	 * frame rate, which is the default. False leaves it off. The `?stats=off` switch hides it too,
	 * and a held frame never shows it.
	 */
	stats?: boolean;
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

/** Starts the demo's sketch on the canvas, and resolves to its engine once it runs. */
export async function startDemo({
	canvas,
	demo,
	labels,
	stats = true,
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
	let engine: Engine;
	try {
		// No preset: the engine's start-up check picks one that the device holds at its frame rate.
		engine = await createEngine({
			canvas,
			sketch: demo.sketch,
			largeWorld: demo.largeWorld,
			hdr: demo.hdr,
			// Collapsed, the overlay stays small until clicked.
			stats: stats && { collapsed: true },
			onProgress: (stage) => loader.stage(stage),
		});
	} catch (error) {
		loader.fail(error instanceof Error ? error.message : String(error));
		throw error;
	}
	if (choices) showChoices(engine, demo, choices);
	// One message handler for the page: the engine gives the messages that a sketch sent before the
	// page listened to the first handler alone, so two handlers would drop the help that a showcase
	// scene posts at its start. The same handler carries the loading progress that a scene posts.
	const readers = [
		...(labels ? [labelReader(engine, labels)] : []),
		...(hud ? [hudReader(engine, hud, signal)] : []),
	];
	engine.onSketchMessage((type, data) => {
		if (type === 'loading') {
			loader.note(data);
			return;
		}
		for (const reader of readers) reader(type, data);
	});
	// The overlay leaves with the first frame, so it never covers a drawn scene.
	void engine.firstFrame.then(
		() => loader.hide(),
		() => loader.hide(),
	);
	// Browsers lock the pointer only right after the user acts, and refuse it on phones.
	if (demo.pointerLock)
		canvas.addEventListener('click', () => engine.requestPointerLock().catch(() => {}), { signal });
	return engine;
}

/** The text that a scene posts while it loads its files, for the loading overlay. */
interface LoadingMessage {
	/** What the scene is doing now, such as how many files have loaded. */
	text: string;
	/** How far the load has gone, from 0 to 1, for the bar. Without it, the bar keeps moving. */
	value?: number;
}

/** The loading overlay of a starting demo. */
export interface Loader {
	/** Shows the engine's start stage: `core`, `sketch` or `first-frame`. */
	stage(stage: StartupStage): void;
	/** Shows the progress that a scene posts while it loads its files. */
	note(data: unknown): void;
	/** Fades the overlay out; the first frame is drawn. */
	hide(): void;
	/** Shows the error text in place of the progress; the start failed. */
	fail(text: string): void;
}

/**
 * Makes the loading overlay over the canvas: a glass card that names the start's stage and any
 * progress a scene posts, in the style of the showcase HUD. It fades out when the first frame is
 * drawn, and shows the error instead when the start fails.
 */
export function createLoader(canvas: HTMLCanvasElement): Loader {
	const host = canvas.parentElement ?? document.body;
	const overlay = document.createElement('div');
	overlay.className = 'loader';
	overlay.setAttribute('role', 'status');
	overlay.setAttribute('aria-live', 'polite');
	const box = document.createElement('div');
	box.className = 'loader__box';
	const label = document.createElement('p');
	label.className = 'loader__label';
	label.textContent = 'Loading the engine';
	const bar = document.createElement('div');
	bar.className = 'loader__bar';
	const fill = document.createElement('div');
	fill.className = 'loader__fill';
	bar.append(fill);
	box.append(label, bar);
	overlay.append(box);
	host.append(overlay);
	let hidden = false;
	const hide = (): void => {
		if (hidden) return;
		hidden = true;
		overlay.classList.add('loader--done');
		const remove = () => overlay.remove();
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) remove();
		else setTimeout(remove, 320);
	};
	return {
		stage(stage) {
			if (stage === 'memory-wait') label.textContent = 'Waiting for the engine memory';
			else if (stage === 'core') label.textContent = 'Starting the sketch';
			else if (stage === 'sketch') label.textContent = 'Drawing the first frame';
			else if (stage === 'first-frame') hide();
		},
		note(data) {
			if (typeof data === 'string') {
				label.textContent = data;
				return;
			}
			const message = data as Partial<LoadingMessage> | null;
			if (!message || typeof message.text !== 'string') return;
			label.textContent = message.text;
			if (typeof message.value === 'number') {
				fill.classList.add('loader__fill--set');
				const value = Math.max(0, Math.min(1, message.value));
				fill.style.width = `${Math.round(value * 100)}%`;
			}
		},
		hide,
		fail(text) {
			hidden = true;
			overlay.classList.add('loader--error');
			label.textContent = text;
			label.classList.add('loader__label--error');
			bar.hidden = true;
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
		const { id, text, active = false, width, height } = data as LabelMessage;
		let tag = tags.get(id);
		if (!tag) {
			tag = document.createElement('div');
			// A label that is a plane of the scene is sized in CSS pixels, which are the scene's units.
			const sized = width !== undefined || height !== undefined;
			tag.className = sized ? 'label label--card' : 'label';
			if (width !== undefined) tag.style.width = `${width}px`;
			if (height !== undefined) tag.style.height = `${height}px`;
			if (sized) tag.style.boxSizing = 'border-box';
			layer.append(tag);
			tags.set(id, tag);
			engine.labels.bind(id, tag);
		}
		tag.textContent = text;
		tag.classList.toggle('active', active);
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
