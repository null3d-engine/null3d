// Two-finger touch gestures for a showcase scene's manual camera: a pinch dollies along the view, a
// two-finger drag pans across the scene, and a twist turns the camera. One finger is left to the
// engine's first-person controls, which look and walk. The maths follows the engine's orbit
// controls, `fingerDistance` in `@null3d/controls`: a pinch is the change in the distance between
// the two fingers, and a drag is how their middle moves. A scene hands the camera and the sketch's
// input to `createTouchGestures`, and calls `update` once per frame while two fingers are down.
//
// `update` allocates nothing: the camera's axes and pose live in typed arrays made once.
import { type PerspectiveCamera, quat, type SketchContext, vec3 } from '@null3d/engine';

/** How the two-finger gestures move the camera. */
export interface TouchGestureOptions {
	/** The meters a pinch dollies for each doubling of the space between the fingers. The default is 8. */
	dollySpeed?: number;
	/**
	 * The distance whose world size sets how far a drag pans, in meters. The default is 15, so a
	 * drag of a whole screen height pans about the height of a wall.
	 */
	panDistance?: number;
	/** The turn, in radians, for each radian that the fingers twist. The default is 1.25. */
	rotateSpeed?: number;
}

/** The two-finger gestures of a showcase scene's manual camera. */
export interface TouchGestures {
	/**
	 * Applies the frame's two-finger gesture to the camera. Returns true while two or more fingers
	 * are down, so the caller can stand its one-finger controls down. Returns false otherwise.
	 */
	update(): boolean;
}

/** The camera's own axes, in the world, as unit directions. */
const AXIS_FORWARD: readonly [number, number, number] = [0, 0, -1];
const AXIS_RIGHT: readonly [number, number, number] = [1, 0, 0];
const AXIS_UP: readonly [number, number, number] = [0, 1, 0];

/** The distance between two fingers, in CSS pixels. */
const spreadOf = (ax: number, ay: number, bx: number, by: number): number =>
	Math.hypot(bx - ax, by - ay);

/** The angle of the line between two fingers, in radians, from +X toward +Y. */
const angleOf = (ax: number, ay: number, bx: number, by: number): number =>
	Math.atan2(by - ay, bx - ax);

/**
 * Makes the two-finger gestures of a manual camera. Call `update` once per frame in `onUpdate`, in
 * Manual mode. It reads the sketch's own fingers, so it works on a touch screen alone.
 */
export function createTouchGestures(
	{ input, engine }: SketchContext,
	camera: PerspectiveCamera,
	options: TouchGestureOptions = {},
): TouchGestures {
	const dollySpeed = options.dollySpeed ?? 8;
	const panDistance = options.panDistance ?? 15;
	const rotateSpeed = options.rotateSpeed ?? 1.25;
	const rotation = quat.create();
	const forward = vec3.create();
	const right = vec3.create();
	const up = vec3.create();
	const position = vec3.create();
	/** The fingers' spread and angle at the previous frame, and whether a gesture is running. */
	let spread = 0;
	let twist = 0;
	let running = false;
	return {
		update() {
			const { touches } = input;
			const first = touches[0];
			const second = touches[1];
			if (!first || !second) {
				running = false;
				return false;
			}
			const nowSpread = spreadOf(first.x, first.y, second.x, second.y);
			const nowTwist = angleOf(first.x, first.y, second.x, second.y);
			// The first frame of a gesture sets its start, and moves nothing: a new finger must not
			// jolt the camera.
			if (!running) {
				running = true;
				spread = nowSpread;
				twist = nowTwist;
				return true;
			}
			camera.getRotation(rotation);
			camera.getPosition(position);
			vec3.transformQuat(forward, AXIS_FORWARD, rotation);
			vec3.transformQuat(right, AXIS_RIGHT, rotation);
			vec3.transformQuat(up, AXIS_UP, rotation);
			// A pinch dollies along the view: fingers that spread move the camera forward. The drag
			// pans the scene with the fingers, across and down the canvas.
			const across = (first.dx + second.dx) * 0.5;
			const down = (first.dy + second.dy) * 0.5;
			const viewportHeight = engine.viewport.height || 1;
			const perPixel = (2 * panDistance * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeight;
			const dolly = spread > 0 && nowSpread > 0 ? ((nowSpread - spread) / spread) * dollySpeed : 0;
			for (let k = 0; k < 3; k++)
				position[k] =
					(position[k] as number) +
					(forward[k] as number) * dolly -
					(right[k] as number) * across * perPixel +
					(up[k] as number) * down * perPixel;
			camera.setPosition(position[0] as number, position[1] as number, position[2] as number);
			// A twist turns the camera about the world's up, so the scene rotates under the fingers.
			let turn = (nowTwist - twist) * rotateSpeed;
			if (turn > Math.PI) turn -= 2 * Math.PI;
			else if (turn < -Math.PI) turn += 2 * Math.PI;
			if (turn !== 0) {
				quat.rotateY(rotation, rotation, turn);
				camera.setRotation(
					rotation[0] as number,
					rotation[1] as number,
					rotation[2] as number,
					rotation[3] as number,
				);
			}
			spread = nowSpread;
			twist = nowTwist;
			return true;
		},
	};
}
