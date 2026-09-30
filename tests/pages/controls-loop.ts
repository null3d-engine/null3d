// Runs orbit and map controls over scripted input in a loop, for the test that checks that their
// update allocates nothing. The input goes through the engine's input ring and reader, as the
// page writes it, and stand-in cameras keep their poses as the engine's cameras do: two
// perspective cameras and an orthographic one. The script
// cycles through every gesture: each mouse button's drag, the wheel, a trackpad's pinch, one
// finger and two fingers. The page publishes its loop on the window, and the test runs it.
import { createMapControls, createOrbitControls } from '@null3d/controls';
import type { PerspectiveCamera, SketchContext } from '@null3d/engine';
import { InputRing } from '../../packages/engine/src/page/input-ring';
import {
	controlViews,
	createControlBuffer,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_WHEEL,
	FLAG_CONTROL,
	FLAG_PRIMARY,
	FLAG_TOUCH,
	Slot,
} from '../../packages/engine/src/shared/control';
import { KEY_CODES } from '../../packages/engine/src/shared/key-codes';
import { InputReader } from '../../packages/engine/src/sketch/input';
import { run } from './lib/result';
import { StandInCamera, StandInOrthographic } from './lib/stand-in-cameras';

declare global {
	interface Window {
		/** Runs this many frames of the script through each set of controls. */
		__null3dControlsRun?: (frames: number) => void;
	}
}

const WIDTH = 320;
const HEIGHT = 180;

const buffer = createControlBuffer(false);
const views = controlViews(buffer);
views.slotFloats[Slot.CanvasCssWidth] = WIDTH;
views.slotFloats[Slot.CanvasCssHeight] = HEIGHT;
const ring = new InputRing(buffer);
const reader = new InputReader(views, KEY_CODES);
const viewport = { width: WIDTH, height: HEIGHT, pixelRatio: 1 };
const context = (input: InputReader) =>
	({
		input,
		engine: { viewport },
		preferences: { reducedMotion: false },
	}) as unknown as SketchContext;
/** A camera above the target and in front of it. */
function standIn(camera: StandInCamera): PerspectiveCamera {
	camera.setPosition(0, 4, 9);
	return camera as unknown as PerspectiveCamera;
}
const perspective = () => standIn(new StandInCamera());
const orbit = createOrbitControls(context(reader), perspective(), {
	enableDamping: true,
	autoRotate: true,
	minDistance: 2,
	maxDistance: 30,
});
const map = createMapControls(context(reader), perspective(), { enableDamping: true });
const orthographic = createMapControls(context(reader), standIn(new StandInOrthographic()), {
	enableDamping: true,
	minZoom: 0.5,
	maxZoom: 4,
});

/** The main, middle and right buttons, as `PointerEvent.button` and `.buttons` give them. */
const BUTTONS = [
	[0, 1],
	[1, 4],
	[2, 2],
] as const;
const MOUSE = 1;
const FINGER_A = 101;
const FINGER_B = 102;

/** Writes one frame of the script into the ring: a cycle of 60 frames through every gesture. */
function script(frame: number): void {
	const step = frame % 60;
	const phase = step % 10;
	// Wobbles back and forth, so the camera stays near where it started.
	const wobble = phase < 5 ? phase : 10 - phase;
	// Fractions of a pixel, as touch screens and trackpads give them.
	const x = 150.25 + 6.5 * wobble;
	const y = 90.5 + 3.25 * wobble;
	if (step < 30) {
		const [button, buttons] = BUTTONS[Math.floor(step / 10)] as readonly [number, number];
		if (phase === 0) ring.write(EVENT_POINTER_DOWN, x, y, button, MOUSE, buttons, FLAG_PRIMARY);
		else if (phase === 9) ring.write(EVENT_POINTER_UP, x, y, button, MOUSE, 0, FLAG_PRIMARY);
		else ring.write(EVENT_POINTER_MOVE, x, y, -1, MOUSE, buttons, FLAG_PRIMARY);
	} else if (step < 40) {
		// Wheel scroll, then a trackpad's pinch: each zooms out, then back in.
		const scroll = phase < 5 ? 12.5 : -12.5;
		ring.write(EVENT_WHEEL, 0, scroll, 0, 0, 0, step >= 35 ? FLAG_CONTROL : 0);
	} else if (step < 50) {
		const flags = FLAG_TOUCH | FLAG_PRIMARY;
		if (phase === 0) ring.write(EVENT_POINTER_DOWN, x, y, 0, FINGER_A, 1, flags);
		else if (phase === 9) ring.write(EVENT_POINTER_UP, x, y, 0, FINGER_A, 0, flags);
		else ring.write(EVENT_POINTER_MOVE, x, y, -1, FINGER_A, 1, flags);
	} else {
		const primary = FLAG_TOUCH | FLAG_PRIMARY;
		const type =
			phase === 0 ? EVENT_POINTER_DOWN : phase === 9 ? EVENT_POINTER_UP : EVENT_POINTER_MOVE;
		const buttons = phase === 9 ? 0 : 1;
		ring.write(type, x, y, 0, FINGER_A, buttons, primary);
		ring.write(type, x + 60 + 4.75 * wobble, y, 0, FINGER_B, buttons, FLAG_TOUCH);
	}
}

(globalThis as unknown as { __controls: unknown }).__controls = { orbit, map, orthographic };
let frame = 0;
window.__null3dControlsRun = (frames) => {
	for (let k = 0; k < frames; k++) {
		script(frame);
		reader.beginFrame(++frame);
		orbit.update(1 / 60);
		map.update(1 / 60);
		orthographic.update(1 / 60);
	}
};

run('controls-loop', async () => ({ ready: true }));
