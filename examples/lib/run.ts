// Starts a demo on a canvas. The examples page uses it, and so can any page that shows the demos
// in a layout of its own, such as the website's: the page owns the canvas, the text and the
// styles, and this module owns how a demo starts.
import { createEngine, type Engine } from '@null3d/engine';
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
}

/** Starts the demo's sketch on the canvas, and resolves to its engine once it runs. */
export async function startDemo({
	canvas,
	demo,
	labels,
	stats = true,
	choices,
	hud,
}: StartOptions): Promise<Engine> {
	// The demos zoom with the wheel and a trackpad pinch, which would otherwise scroll or zoom the page.
	canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
	// No preset: the engine's start-up check picks one that the device holds at its frame rate.
	const engine = await createEngine({
		canvas,
		sketch: demo.sketch,
		largeWorld: demo.largeWorld,
		// Collapsed, the overlay stays small until clicked.
		stats: stats && { collapsed: true },
	});
	if (choices) showChoices(engine, demo, choices);
	// One message handler for the page: the engine gives the messages that a sketch sent before the
	// page listened to the first handler alone, so two handlers would drop the help that a showcase
	// scene posts at its start.
	const readers = [
		...(labels ? [labelReader(engine, labels)] : []),
		...(hud ? [hudReader(engine, hud)] : []),
	];
	if (readers.length > 0)
		engine.onSketchMessage((type, data) => {
			for (const reader of readers) reader(type, data);
		});
	// Browsers lock the pointer only right after the user acts, and refuse it on phones.
	if (demo.pointerLock)
		canvas.addEventListener('click', () => engine.requestPointerLock().catch(() => {}));
	return engine;
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
		const { id, text, active = false } = data as LabelMessage;
		let tag = tags.get(id);
		if (!tag) {
			tag = document.createElement('div');
			tag.className = 'label';
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
function hudReader(engine: Engine, element: HTMLElement): (type: string, data: unknown) => void {
	const stage = element.parentElement ?? element;
	const hud = createHud(element, stage, (name, value) => engine.postToSketch(name, value));
	return (type, data) => {
		if (type !== 'hud') return;
		const { groups, visible } = data as HudMessage;
		hud.render({ groups }, visible);
	};
}
