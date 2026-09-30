// Starts the engine with the camera controls' sketch, and puts three.js's own controls on the same
// canvas, with a camera like the sketch's. Playwright's drags then reach both: three.js's controls
// through their DOM listeners, and null3D's through the engine's input. The page offers
// `controlsPoses()`, both cameras' positions and targets, and `captureControls()`, the engine's
// frame. ?map uses map controls on both sides.
import { createEngine } from '@null3d/engine';
import { PerspectiveCamera } from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONTROLS_CANVAS, CONTROLS_VIEW } from './lib/controls-view';
import { run, toBase64 } from './lib/result';

/** A camera's position and the point its controls orbit; and the sketch's fingers and frame. */
interface Pose {
	position: number[];
	target: number[];
	fingers?: number;
	frame?: number;
}

declare global {
	interface Window {
		controlsPoses?: () => Promise<{ null3d: Pose; three: Pose }>;
		captureControls?: () => Promise<{ width: number; height: number; pixels: string }>;
	}
}

run('controls', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const map = new URLSearchParams(location.search).has('map');
	// Vite rewrites an address it can read whole, so the query goes on afterwards.
	const sketch = new URL('./sketches/controls-sketch.ts', import.meta.url);
	if (map) sketch.searchParams.set('map', '');
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	await engine.firstFrame;

	const { width, height } = CONTROLS_CANVAS;
	const camera = new PerspectiveCamera(CONTROLS_VIEW.fov, width / height, 0.1, 100);
	camera.position.set(...CONTROLS_VIEW.position);
	const controls = map ? new MapControls(camera, canvas) : new OrbitControls(camera, canvas);
	controls.target.set(...CONTROLS_VIEW.target);
	controls.update();
	// As an app does: update the controls and draw once per display frame.
	const frame = () => {
		controls.update();
		camera.updateMatrixWorld();
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);

	const nullPose = () =>
		new Promise<Pose>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'pose') return;
				off();
				resolve(data as Pose);
			});
			engine.postToSketch('pose');
		});
	window.controlsPoses = async () => ({
		null3d: await nullPose(),
		three: { position: camera.position.toArray(), target: controls.target.toArray() },
	});
	window.captureControls = async () => {
		const captured = await engine.captureFrame();
		return {
			width: captured.width,
			height: captured.height,
			pixels: toBase64(captured.pixels),
		};
	};
	return { mode: engine.mode, capabilities: engine.capabilities };
});
