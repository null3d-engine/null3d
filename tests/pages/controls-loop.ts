// Runs orbit, map, fly and first-person controls over scripted input in a loop, for the test that
// checks that their update allocates nothing. The input goes through the engine's input ring and
// reader, as the page writes it, and stand-in cameras keep their poses as the engine's cameras do:
// perspective cameras and an orthographic one. The script cycles through every gesture: each mouse
// button's drag, the wheel, a trackpad's pinch, one finger, two fingers, and the mouse while the
// pointer is locked. Keys go down and up through the cycle. The page publishes its loop on the
// window, and the test runs it.
import {
	createFirstPersonControls,
	createFlyControls,
	createMapControls,
	createOrbitControls,
} from '@null3d/controls';
import type { PerspectiveCamera } from '@null3d/engine';
import {
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_LOCK,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_WHEEL,
	FLAG_CONTROL,
	FLAG_LOCKED,
	FLAG_PRIMARY,
	FLAG_TOUCH,
} from '../../packages/engine/src/shared/control';
import { KEY_CODES } from '../../packages/engine/src/shared/key-codes';
import { run } from './lib/result';
import { ScriptedInput } from './lib/scripted-input';
import { StandInCamera, StandInOrthographic } from './lib/stand-in-cameras';

declare global {
	interface Window {
		/** Runs this many frames of the script through each set of controls. */
		__null3dControlsRun?: (frames: number) => void;
	}
}

const WIDTH = 320;
const HEIGHT = 180;

const input = new ScriptedInput(WIDTH, HEIGHT);
const { ring, context } = input;
/** A camera above the target and in front of it. */
function standIn(camera: StandInCamera): PerspectiveCamera {
	camera.setPosition(0, 4, 9);
	return camera as unknown as PerspectiveCamera;
}
const perspective = () => standIn(new StandInCamera());
const orbit = createOrbitControls(context, perspective(), {
	enableDamping: true,
	autoRotate: true,
	minDistance: 2,
	maxDistance: 30,
});
const map = createMapControls(context, perspective(), { enableDamping: true });
const orthographic = createMapControls(context, standIn(new StandInOrthographic()), {
	enableDamping: true,
	minZoom: 0.5,
	maxZoom: 4,
});
const fly = createFlyControls(context, perspective(), { rollSpeed: 0.5 });
const firstPerson = createFirstPersonControls(context, perspective(), {
	lookSpeed: 0.1,
	heightSpeed: true,
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

/** Keys that the script holds for part of each cycle, and the numbers the page gives them. */
const KEYS = ['KeyW', 'KeyA', 'ArrowLeft', 'KeyQ', 'KeyR'].map((code) => KEY_CODES.indexOf(code));

/** Writes one frame of the script into the ring: a cycle of 70 frames through every gesture. */
function script(frame: number): void {
	const step = frame % 70;
	// Each key goes down at the start of a cycle, and up at a different step.
	for (const [k, key] of KEYS.entries()) {
		if (step === 0) ring.write(EVENT_KEY_DOWN, 0, 0, key, 0, 0, 0);
		else if (step === 12 * (k + 1)) ring.write(EVENT_KEY_UP, 0, 0, key, 0, 0, 0);
	}
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
	} else if (step >= 60) {
		// The pointer lock: it begins, the mouse moves, and it ends.
		if (phase === 0) ring.write(EVENT_POINTER_LOCK, 0, 0, 1, 0, 0, 0);
		else if (phase === 9) ring.write(EVENT_POINTER_LOCK, 0, 0, 0, 0, 0, 0);
		else
			ring.write(
				EVENT_POINTER_MOVE,
				wobble - 2.25,
				1.5 - wobble,
				-1,
				MOUSE,
				0,
				FLAG_PRIMARY | FLAG_LOCKED,
			);
	} else {
		const primary = FLAG_TOUCH | FLAG_PRIMARY;
		const type =
			phase === 0 ? EVENT_POINTER_DOWN : phase === 9 ? EVENT_POINTER_UP : EVENT_POINTER_MOVE;
		const buttons = phase === 9 ? 0 : 1;
		ring.write(type, x, y, 0, FINGER_A, buttons, primary);
		ring.write(type, x + 60 + 4.75 * wobble, y, 0, FINGER_B, buttons, FLAG_TOUCH);
	}
}

(globalThis as unknown as { __controls: unknown }).__controls = {
	orbit,
	map,
	orthographic,
	fly,
	firstPerson,
};
let frame = 0;
window.__null3dControlsRun = (frames) => {
	for (let k = 0; k < frames; k++) {
		script(frame);
		input.beginFrame();
		frame++;
		orbit.update(1 / 60);
		map.update(1 / 60);
		orthographic.update(1 / 60);
		fly.update(1 / 60);
		firstPerson.update(1 / 60);
	}
};

run('controls-loop', async () => ({ ready: true }));
