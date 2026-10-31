// Starts the engine with the drag-controls test's sketch, and answers the page's questions about
// it: the crate's pose, what the drag holds, and where the crate shows on the canvas. A test
// presses the crate from the place that this page names, so that it takes hold of the crate itself.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** The crate's pose, and what the drag holds at this moment. */
interface Pose {
	position: number[];
	rotation: number[];
	/** Where the crate shows on the canvas, in CSS pixels. */
	screen: [number, number];
	dragging: boolean;
	hovered: boolean;
	action: 'pan' | 'rotate' | null;
	/** The sketch time of the frame that answered. */
	time: number;
}

declare global {
	interface Window {
		dragPose?: () => Promise<Pose>;
	}
}

run('drag-controls', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/drag-controls-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;

	/** Sends the sketch a message, and waits for its answer under the same name. */
	const ask = <T>(type: string) =>
		new Promise<T>((resolve) => {
			const off = engine.onSketchMessage((name, reply) => {
				if (name !== type) return;
				off();
				resolve(reply as T);
			});
			engine.postToSketch(type);
		});

	window.dragPose = () => ask<Pose>('pose');
	return { mode: engine.mode, capabilities: engine.capabilities };
});
