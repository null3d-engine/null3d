// Starts a demo on a canvas. The examples page uses it, and so can any page that shows the demos
// in a layout of its own, such as the website's: the page owns the canvas, the text and the
// styles, and this module owns how a demo starts.
import { createEngine, type Engine } from '@null3d/engine';
import type { Demo } from '../demos';

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
	if (labels) showLabels(engine, labels);
	if (choices) showChoices(engine, demo, choices);
	if (hud) showHud(engine, hud);
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

/** Shows the labels that the demo posts, each in an element that follows the label's object. */
function showLabels(engine: Engine, layer: HTMLElement): void {
	const tags = new Map<string, HTMLElement>();
	engine.onSketchMessage((type, data) => {
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
	});
}

/** The message that a showcase scene posts to show or hide its help. */
interface HudMessage {
	/** A line for each key: the key, and what it does with its state. */
	rows: readonly { key: string; text: string }[];
	/** False hides the help, from the `h` key. */
	visible: boolean;
}

/**
 * Shows the help that a showcase scene posts: one line for each key, with the camera's mode. The `h`
 * key hides it; the scene says so. A held frame posts none.
 */
function showHud(engine: Engine, element: HTMLElement): void {
	engine.onSketchMessage((type, data) => {
		if (type !== 'hud') return;
		const { rows, visible } = data as HudMessage;
		element.hidden = !visible;
		element.replaceChildren(
			...rows.map((row) => {
				const line = document.createElement('div');
				line.className = 'hud-row';
				const key = document.createElement('span');
				key.className = 'hud-key';
				key.textContent = row.key;
				const text = document.createElement('span');
				text.textContent = row.text;
				line.append(key, text);
				return line;
			}),
		);
	});
}
