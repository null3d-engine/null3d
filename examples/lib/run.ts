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
}

/** Starts the demo's sketch on the canvas, and resolves to its engine once it runs. */
export async function startDemo({ canvas, demo, labels }: StartOptions): Promise<Engine> {
	// The demos zoom with the wheel and a trackpad pinch, which would otherwise scroll or zoom the page.
	canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
	// The demos ask for the High preset on every device. The engine caps it on the GPU paths that
	// run at most Medium, and the frame-budget governor of every preset lowers the render scale
	// and the shadows when a device cannot hold the frame rate.
	const engine = await createEngine({
		canvas,
		sketch: demo.sketch,
		largeWorld: demo.largeWorld,
		preset: 'high',
	});
	if (labels) showLabels(engine, labels);
	return engine;
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
