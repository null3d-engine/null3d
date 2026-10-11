// Fly controls for a sketch's camera, with three.js's option names and behavior: keys move the
// camera along its own axes and turn it, and the pointer's place on the canvas steers it. Where
// three.js's FlyControls react to each DOM event, these read the sketch's input once per frame, in
// update(dt), and step the camera as three.js's update does. update(dt) allocates nothing.

import type { OrthographicCamera, PerspectiveCamera, SketchContext } from '@null3d/engine';
import { CameraPose } from './camera-pose';

/**
 * Options for `createFlyControls`, with three.js's names and defaults. The controls keep each
 * option as a property of the same name, which a sketch can change at any time.
 *
 * @category api/controls
 */
export interface FlyControlsOptions {
	/** False ignores the user's input and stops the camera. The default is true. */
	enabled?: boolean;
	/** How fast the camera moves, in world units per second. The default is 1. */
	movementSpeed?: number;
	/**
	 * How fast the camera turns, in radians per second at full turn: about twice this, as three.js
	 * counts it. The default is 0.005.
	 */
	rollSpeed?: number;
	/**
	 * True steers only while a button or a finger is down. False steers by the pointer's place
	 * whenever it moves over the canvas, and the left and right buttons move forward and back. The
	 * default is false.
	 */
	dragToLook?: boolean;
	/** True moves the camera forward all the time, unless a key moves it back. The default is false. */
	autoForward?: boolean;
}

/** The main and right buttons in `PointerEvent.buttons`. */
const MAIN_BUTTON = 1;
const RIGHT_BUTTON = 2;

/**
 * Fly controls: they move the camera in all directions and turn it about its own axes, as in a
 * flight game. W, A, S and D move it forward, left, back and right, and R and F move it up and down.
 * The arrow keys turn it, and Q and E roll it. The pointer steers: the farther it is from the
 * canvas's middle, the faster the camera turns. `createFlyControls` makes them. Call `update` once
 * per frame in `onUpdate`.
 *
 * @category api/controls
 */
export class FlyControls {
	/** False ignores the user's input and stops the camera. */
	enabled: boolean;
	/** How fast the camera moves, in world units per second. */
	movementSpeed: number;
	/** How fast the camera turns: about twice this, in radians per second, at full turn. */
	rollSpeed: number;
	/** True steers only while a button or a finger is down. */
	dragToLook: boolean;
	/** True moves the camera forward all the time, unless a key moves it back. */
	autoForward: boolean;

	private readonly input: SketchContext['input'];
	private readonly viewport: SketchContext['engine']['viewport'];
	private readonly pose: CameraPose;
	/**
	 * The pointer's steering, from -1 to 1 across each half of the canvas: the turn to the left, and
	 * the turn down. It holds until the pointer moves, as three.js's does.
	 */
	private readonly steer = new Float64Array(2);
	/** The movement along the camera's axes, and the turn about them, before speeds. */
	private readonly move = new Float64Array(3);
	private readonly turn = new Float64Array(3);
	/** The pointer's place at the last update, to see when it moves. */
	private readonly last = new Float64Array(2);

	constructor(
		context: SketchContext,
		camera: PerspectiveCamera | OrthographicCamera,
		options: FlyControlsOptions,
	) {
		this.input = context.input;
		this.viewport = context.engine.viewport;
		this.pose = new CameraPose(camera);
		this.enabled = options.enabled ?? true;
		this.movementSpeed = options.movementSpeed ?? 1;
		this.rollSpeed = options.rollSpeed ?? 0.005;
		this.dragToLook = options.dragToLook ?? false;
		this.autoForward = options.autoForward ?? false;
		// The pointer steers once it moves, not from where it was when the controls started.
		const { pointer } = this.input;
		this.last[0] = pointer.x;
		this.last[1] = pointer.y;
	}

	/**
	 * Moves and turns the camera by the frame's input. Call it once per frame in `onUpdate`, with
	 * the frame's step in seconds. Returns true when the camera moved or turned.
	 */
	update(dt: number): boolean {
		if (!this.enabled) return false;
		this.pose.sync();
		this.readInput();
		const step = dt > 0 ? dt : 0;
		const { position, rotation: q } = this.pose;
		const { move, turn } = this;
		// The move along the camera's own axes: its rotation turns the vector.
		const along = step * this.movementSpeed;
		const mx = (move[0] as number) * along;
		const my = (move[1] as number) * along;
		const mz = (move[2] as number) * along;
		const qx = q[0] as number;
		const qy = q[1] as number;
		const qz = q[2] as number;
		const qw = q[3] as number;
		const tx = 2 * (qy * mz - qz * my);
		const ty = 2 * (qz * mx - qx * mz);
		const tz = 2 * (qx * my - qy * mx);
		position[0] = (position[0] as number) + mx + qw * tx + qy * tz - qz * ty;
		position[1] = (position[1] as number) + my + qw * ty + qz * tx - qx * tz;
		position[2] = (position[2] as number) + mz + qw * tz + qx * ty - qy * tx;
		// The turn, as three.js makes it: a quaternion of the turn's axes with w = 1, normalized,
		// applied about the camera's own axes.
		const by = step * this.rollSpeed;
		let rx = (turn[0] as number) * by;
		let ry = (turn[1] as number) * by;
		let rz = (turn[2] as number) * by;
		let rw = 1;
		const scale = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + 1);
		rx *= scale;
		ry *= scale;
		rz *= scale;
		rw *= scale;
		q[0] = qw * rx + qx * rw + qy * rz - qz * ry;
		q[1] = qw * ry - qx * rz + qy * rw + qz * rx;
		q[2] = qw * rz + qx * ry - qy * rx + qz * rw;
		q[3] = qw * rw - qx * rx - qy * ry - qz * rz;
		this.pose.write();
		return this.pose.changed();
	}

	/** Turns the frame's keys and pointer into the movement and the turn. */
	private readInput(): void {
		const { input, steer, move, turn, last } = this;
		const { pointer } = input;
		const buttons = pointer.buttons;
		if (this.dragToLook) {
			// Only a drag steers, from the place it moves to, and a release stops the turn.
			if (buttons === 0) {
				steer[0] = 0;
				steer[1] = 0;
			} else if (pointer.dragDx !== 0 || pointer.dragDy !== 0) this.steerByPointer();
		} else if (pointer.x !== last[0] || pointer.y !== last[1]) this.steerByPointer();
		last[0] = pointer.x;
		last[1] = pointer.y;
		const byButton = !this.dragToLook;
		const forward = input.isDown('KeyW') || (byButton && (buttons & MAIN_BUTTON) !== 0) ? 1 : 0;
		const back = input.isDown('KeyS') || (byButton && (buttons & RIGHT_BUTTON) !== 0) ? 1 : 0;
		const ahead = forward === 1 || (this.autoForward && back === 0) ? 1 : 0;
		move[0] = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
		move[1] = (input.isDown('KeyR') ? 1 : 0) - (input.isDown('KeyF') ? 1 : 0);
		move[2] = back - ahead;
		// The keys add to the pointer's steering.
		turn[0] =
			(input.isDown('ArrowUp') ? 1 : 0) -
			(input.isDown('ArrowDown') ? 1 : 0) -
			(steer[1] as number);
		turn[1] =
			(input.isDown('ArrowLeft') ? 1 : 0) -
			(input.isDown('ArrowRight') ? 1 : 0) +
			(steer[0] as number);
		turn[2] = (input.isDown('KeyQ') ? 1 : 0) - (input.isDown('KeyE') ? 1 : 0);
	}

	/** Steers by the pointer's place: at the canvas's middle, not at all; at an edge, fully. */
	private steerByPointer(): void {
		const { width, height } = this.viewport;
		if (!(width > 0 && height > 0)) return;
		const { pointer } = this.input;
		const halfWidth = width / 2;
		const halfHeight = height / 2;
		this.steer[0] = -(pointer.x - halfWidth) / halfWidth;
		this.steer[1] = (pointer.y - halfHeight) / halfHeight;
	}
}

/**
 * Creates fly controls, which three.js calls `FlyControls`. W, A, S, D, R and F move the camera,
 * the arrow keys turn it, Q and E roll it, and the pointer steers it. Call `controls.update(dt)`
 * once per frame in `onUpdate`.
 *
 * @category api/controls
 */
export function createFlyControls(
	ctx: SketchContext,
	camera: PerspectiveCamera | OrthographicCamera,
	options: FlyControlsOptions = {},
): FlyControls {
	return new FlyControls(ctx, camera, options);
}
