// The two-finger gestures: a pinch dollies along the view, a two-finger drag pans across the scene,
// and a twist turns the camera. The test drives the helper with scripted fingers, as the controls
// tests drive the engine's controls, and reads the camera's pose from a small stub.
import { expect, test } from 'bun:test';
import type { PerspectiveCamera, SketchContext } from '@null3d/engine';
import { createTouchGestures } from './touch-gestures';

interface Finger {
	id: number;
	x: number;
	y: number;
	dx: number;
	dy: number;
}

/** A camera whose pose the test can read, with the methods that the gestures call. */
function stubCamera() {
	const rotation = [0, 0, 0, 1];
	let position = [0, 0, 0];
	return {
		fov: 45,
		getRotation: (out: number[]) => {
			for (let k = 0; k < 4; k++) out[k] = rotation[k] as number;
		},
		getPosition: (out: number[]) => {
			for (let k = 0; k < 3; k++) out[k] = position[k] as number;
		},
		setPosition: (x: number, y: number, z: number) => {
			position = [x, y, z];
		},
		setRotation: (x: number, y: number, z: number, w: number) => {
			rotation[0] = x;
			rotation[1] = y;
			rotation[2] = z;
			rotation[3] = w;
		},
		at: () => position,
		yaw: () => 2 * Math.atan2(rotation[1] as number, rotation[3] as number),
	};
}

/** A sketch context whose fingers the test sets, and whose canvas is 800 x 600 CSS pixels. */
function stubContext() {
	const touches: Finger[] = [];
	return {
		ctx: {
			input: { touches },
			engine: { viewport: { width: 800, height: 600 } },
		} as unknown as SketchContext,
		touches,
	};
}

/** Two fingers at (x, y) and (x + spread, y), each moved by (dx, dy) this frame. */
function pair(touches: Finger[], x: number, y: number, spread: number, dx = 0, dy = 0): void {
	touches[0] = { id: 1, x, y, dx, dy };
	touches[1] = { id: 2, x: x + spread, y, dx, dy };
}

test('a pinch dollies along the view', () => {
	const camera = stubCamera();
	const { ctx, touches } = stubContext();
	const gestures = createTouchGestures(ctx, camera as unknown as PerspectiveCamera);
	pair(touches, 100, 300, 100);
	expect(gestures.update()).toBe(true);
	// Fingers that spread move the camera forward, along its own -Z, by dollySpeed for a doubling.
	pair(touches, 50, 300, 200);
	gestures.update();
	expect(camera.at()[2]).toBeLessThan(-5);
	expect(camera.at()[2]).toBeGreaterThan(-11);
});

test('a two-finger drag pans the scene, and does not turn the camera', () => {
	const camera = stubCamera();
	const { ctx, touches } = stubContext();
	const gestures = createTouchGestures(ctx, camera as unknown as PerspectiveCamera);
	pair(touches, 100, 300, 100);
	gestures.update();
	// Both fingers move right, so the camera moves left, and its view does not turn.
	pair(touches, 120, 300, 100, 20, 0);
	gestures.update();
	expect(camera.at()[0]).toBeLessThan(-0.1);
	expect(camera.yaw()).toBeCloseTo(0, 6);
});

test('a twist turns the camera', () => {
	const camera = stubCamera();
	const { ctx, touches } = stubContext();
	const gestures = createTouchGestures(ctx, camera as unknown as PerspectiveCamera);
	pair(touches, 100, 300, 100);
	gestures.update();
	// The line between the fingers turns from +X toward +Y, a quarter turn.
	touches[0] = { id: 1, x: 100, y: 300, dx: 0, dy: 0 };
	touches[1] = { id: 2, x: 100, y: 400, dx: 0, dy: 100 };
	gestures.update();
	expect(Math.abs(camera.yaw())).toBeGreaterThan(1);
});

test('one finger leaves the camera to the first-person controls', () => {
	const camera = stubCamera();
	const { ctx, touches } = stubContext();
	const gestures = createTouchGestures(ctx, camera as unknown as PerspectiveCamera);
	pair(touches, 100, 300, 100);
	gestures.update();
	touches[1] = undefined as unknown as Finger;
	touches.length = 1;
	expect(gestures.update()).toBe(false);
	expect(camera.at()).toEqual([0, 0, 0]);
});
