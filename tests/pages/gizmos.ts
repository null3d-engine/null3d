// Starts the engine with the gizmo tests' sketch, and answers the page's questions about it: the
// block's pose, where each handle shows on the canvas, and a change of mode or space. A test drags
// a handle from the place that this page names, so that it holds the handle itself rather than a
// guess at where it might be.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** The block's pose, and what the handles do at this moment. */
interface Pose {
	position: number[];
	rotation: number[];
	scale: number[];
	mode: string;
	axis: string | null;
	dragging: boolean;
	/** The sketch time of the frame that answered. */
	time: number;
}

declare global {
	interface Window {
		gizmoPose?: () => Promise<Pose>;
		gizmoHandles?: () => Promise<{
			points: Record<string, number[]>;
			takes: Record<string, string>;
		}>;
		gizmoMode?: (mode: string) => Promise<string>;
		gizmoSpace?: (space: string) => Promise<string>;
		captureGizmos?: () => Promise<{ width: number; height: number; pixels: string }>;
	}
}

run('gizmos', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/gizmos-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;

	/** Sends the sketch a message, and waits for its answer under the same name. */
	const ask = <T>(type: string, data?: unknown) =>
		new Promise<T>((resolve) => {
			const off = engine.onSketchMessage((name, reply) => {
				if (name !== type) return;
				off();
				resolve(reply as T);
			});
			engine.postToSketch(type, data);
		});

	window.gizmoPose = () => ask<Pose>('pose');
	window.gizmoHandles = () =>
		ask<{ points: Record<string, number[]>; takes: Record<string, string> }>('handles');
	window.gizmoMode = (mode: string) => ask<string>('mode', mode);
	window.gizmoSpace = (space: string) => ask<string>('space', space);
	window.captureGizmos = async () => {
		const captured = await engine.captureFrame();
		return {
			width: captured.width,
			height: captured.height,
			pixels: toBase64(captured.pixels),
		};
	};
	return { mode: engine.mode, capabilities: engine.capabilities };
});
