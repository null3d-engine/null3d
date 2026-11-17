// Starts the engine with the first-person controls' sketch, and puts three.js's PointerLockControls
// on the same canvas, with a camera like the sketch's. A click on the canvas asks for the pointer
// lock with engine.requestPointerLock(). Playwright's mouse moves then reach both: three.js's
// controls through their DOM listeners, and null3D's through the engine's input. The page offers
// `lockPoses()`, both cameras' rotations and whether each side sees the lock, and
// `lockRequests`, how each request ended, and `lockDetached()`, a request that the browser refuses.
// With ?noInput, the engine starts with its `input` option off, and a click also locks the canvas
// with the page's own call, as the code that records a game's input does. `lockedToCanvas()` says
// whether the canvas holds the lock, and `destroyEngine()` stops the engine.
import { createEngine } from '@null3d/engine';
import { PerspectiveCamera } from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CONTROLS_CANVAS, CONTROLS_VIEW } from './lib/controls-view';
import { run } from './lib/result';

/** A camera's rotation, whether its controls see the lock, and the sketch's frame. */
interface Pose {
	rotation: number[];
	locked: boolean;
	frame?: number;
}

declare global {
	interface Window {
		lockPoses?: () => Promise<{ null3d: Pose; three: Pose }>;
		/** How each request for the lock ended: 'locked', or the error's message. */
		lockRequests?: string[];
		/** Asks for the lock while the canvas is off the page, and returns how the request ended. */
		lockDetached?: () => Promise<string>;
		lockedToCanvas?: () => boolean;
		destroyEngine?: () => Promise<void>;
	}
}

run('pointer-lock', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/pointer-lock-sketch.ts', import.meta.url);
	const noInput = new URLSearchParams(location.search).has('noInput');
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		...(noInput ? { input: false } : {}),
	});
	await engine.firstFrame;

	const { width, height } = CONTROLS_CANVAS;
	const camera = new PerspectiveCamera(CONTROLS_VIEW.fov, width / height, 0.1, 100);
	camera.position.set(...CONTROLS_VIEW.position);
	camera.lookAt(...CONTROLS_VIEW.target);
	const controls = new PointerLockControls(camera, canvas);

	const requests: string[] = [];
	window.lockRequests = requests;
	canvas.addEventListener('click', () => {
		engine.requestPointerLock().then(
			() => requests.push('locked'),
			(error: Error) => requests.push(error.message),
		);
		// The page's own lock, which the engine with input off leaves to it.
		if (noInput) void canvas.requestPointerLock();
	});
	window.lockedToCanvas = () => document.pointerLockElement === canvas;
	window.destroyEngine = () => engine.destroy();

	const nullPose = () =>
		new Promise<Pose>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'pose') return;
				off();
				resolve(data as Pose);
			});
			engine.postToSketch('pose');
		});
	window.lockPoses = async () => ({
		null3d: await nullPose(),
		three: { rotation: camera.quaternion.toArray(), locked: controls.isLocked },
	});
	window.lockDetached = async () => {
		engine.detach();
		try {
			await engine.requestPointerLock();
			return 'locked';
		} catch (error) {
			return (error as Error).message;
		} finally {
			engine.attach(document.body);
		}
	};
	return { mode: engine.mode };
});
