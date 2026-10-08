// First-person controls for a sketch's camera, with three.js's option names and behavior. They join
// two three.js controls. Without a pointer lock, they act as FirstPersonControls: keys walk, and a
// drag looks around and walks along the view. While the canvas holds the pointer lock, the mouse's
// movement turns the view as PointerLockControls turns it. Where three.js's controls react to each
// DOM event, these read the sketch's input once per frame, in update(dt). update(dt) allocates
// nothing: the state lives in typed arrays and number fields made once.

import type {
	OrthographicCamera,
	PerspectiveCamera,
	SketchContext,
	Vec3Like,
} from '@null3d/engine';
import { CameraPose } from './camera-pose';

/**
 * Options for `createFirstPersonControls`, with the names and defaults of three.js's
 * `FirstPersonControls` and `PointerLockControls`. The controls keep each option as a property of
 * the same name, which a sketch can change at any time.
 *
 * @category api/controls
 */
export interface FirstPersonControlsOptions {
	/** False ignores the user's input and stops the camera. The default is true. */
	enabled?: boolean;
	/**
	 * How fast the keys and the pointer move the camera, in world units per second. 0 leaves the
	 * moves to the sketch, as with three.js's `PointerLockControls`. The default is 1.
	 */
	movementSpeed?: number;
	/** How fast a drag turns the view: degrees per second for each pixel of the drag. The default is 0.005. */
	lookSpeed?: number;
	/**
	 * The share of the remaining change of speed that each frame applies, at 60 frames per second, so
	 * moves and turns start and stop smoothly. Other frame rates get the same motion over the same
	 * time. The default is 0.1.
	 */
	dampingFactor?: number;
	/** False keeps a drag from turning the view up and down. The default is true. */
	lookVertical?: boolean;
	/** True moves the camera forward along the view all the time. The default is false. */
	autoForward?: boolean;
	/** True moves the camera forward faster the higher it is. The default is false. */
	heightSpeed?: boolean;
	/** How much faster, per world unit of height above `heightMin`. The default is 1. */
	heightCoef?: number;
	/** The height from which `heightSpeed` adds speed. The default is 0. */
	heightMin?: number;
	/** The height above which `heightSpeed` adds no more. The default is 1. */
	heightMax?: number;
	/**
	 * True maps the view's angle from +Y into the range from `verticalMin` to `verticalMax`. The
	 * default is false.
	 */
	constrainVertical?: boolean;
	/** The smallest angle between the view and +Y, in radians, with `constrainVertical`. The default is 0. */
	verticalMin?: number;
	/** The largest angle between the view and +Y, in radians, with `constrainVertical`. The default is π. */
	verticalMax?: number;
	/** How fast the locked pointer turns the view: 1 turns 0.002 radians per pixel. The default is 1. */
	pointerSpeed?: number;
	/**
	 * The smallest angle between the view and +Y while the pointer is locked, in radians. The default
	 * is 0.
	 */
	minPolarAngle?: number;
	/**
	 * The largest angle between the view and +Y while the pointer is locked, in radians. The default
	 * is π.
	 */
	maxPolarAngle?: number;
}

/** The main and right buttons in `PointerEvent.buttons`. */
const MAIN_BUTTON = 1;
const RIGHT_BUTTON = 2;
const DEGREES = 180 / Math.PI;
const RADIANS = Math.PI / 180;
/** How far a drag tips the view up or down, in degrees, as in three.js. */
const LAT_LIMIT = 85;
/** Radians per pixel of a locked pointer's movement, as in three.js's PointerLockControls. */
const MOUSE_SENSITIVITY = 0.002;
/** The frame rate at which a damping factor applies once per frame, as three.js applies it. */
const DAMPING_RATE = 60;

/** The keys that walk, as bits. */
const KEY_FORWARD = 1;
const KEY_BACK = 2;
const KEY_LEFT = 4;
const KEY_RIGHT = 8;
const KEY_UP = 16;
const KEY_DOWN = 32;

/**
 * Places in the controls' array of numbers that change every frame: the view's angle above the
 * level and around +Y in degrees, as three.js's `lat` and `lon` count them, and how fast each turns;
 * where the drag began, and how far it has gone, in CSS pixels.
 */
const LAT = 0;
const LON = 1;
const LAT_SPEED = 2;
const LON_SPEED = 3;
const DOWN_X = 4;
const DOWN_Y = 5;
const DRAG_X = 6;
const DRAG_Y = 7;
const VALUES = 8;

/**
 * First-person controls: keys walk the camera over the ground. The user looks around with a drag,
 * or with the mouse while the pointer is locked. W, A, S and D or the arrow keys walk, and R
 * and F move up and down. A left drag or one finger walks forward along the view, and a right drag
 * or two fingers walk back. `createFirstPersonControls` makes them. Call `update` once per frame in
 * `onUpdate`.
 *
 * @category api/controls
 */
export class FirstPersonControls {
	/** False ignores the user's input and stops the camera. */
	enabled: boolean;
	/** How fast the keys and the pointer move the camera, in world units per second. */
	movementSpeed: number;
	/** How fast a drag turns the view: degrees per second for each pixel of the drag. */
	lookSpeed: number;
	/** The share of the remaining change of speed that each frame applies, at 60 frames per second. */
	dampingFactor: number;
	/** False keeps a drag from turning the view up and down. */
	lookVertical: boolean;
	/** True moves the camera forward along the view all the time. */
	autoForward: boolean;
	/** True moves the camera forward faster the higher it is. */
	heightSpeed: boolean;
	/** How much faster, per world unit of height above `heightMin`. */
	heightCoef: number;
	/** The height from which `heightSpeed` adds speed. */
	heightMin: number;
	/** The height above which `heightSpeed` adds no more. */
	heightMax: number;
	/** True maps the view's angle from +Y into the range from `verticalMin` to `verticalMax`. */
	constrainVertical: boolean;
	/** The smallest angle between the view and +Y, in radians, with `constrainVertical`. */
	verticalMin: number;
	/** The largest angle between the view and +Y, in radians, with `constrainVertical`. */
	verticalMax: number;
	/** How fast the locked pointer turns the view: 1 turns 0.002 radians per pixel. */
	pointerSpeed: number;
	/** The smallest angle between the view and +Y while the pointer is locked, in radians. */
	minPolarAngle: number;
	/** The largest angle between the view and +Y while the pointer is locked, in radians. */
	maxPolarAngle: number;

	private readonly input: SketchContext['input'];
	private readonly pose: CameraPose;
	/** The camera's velocity in world units per second, which eases toward the input's. */
	private readonly velocity = new Float64Array(3);
	/** The view's direction, for moves along it. */
	private readonly direction = new Float64Array(3);
	/** The camera's right, for moves to the side. */
	private readonly right = new Float64Array(3);
	/** The numbers that change every frame, at the places that the constants above name. */
	private readonly values = new Float64Array(VALUES);
	/** True while a drag or the fingers look around. */
	private looking = false;
	/** True while the pointer walks forward or back along the view. */
	private pointerForward = false;
	private pointerBackward = false;
	/** The fingers in the previous frame. */
	private fingers = 0;
	/** True while a button that was down when the controls started stays down: it starts no drag. */
	private held = false;

	constructor(
		context: SketchContext,
		camera: PerspectiveCamera | OrthographicCamera,
		options: FirstPersonControlsOptions,
	) {
		this.input = context.input;
		this.pose = new CameraPose(camera);
		this.enabled = options.enabled ?? true;
		this.movementSpeed = options.movementSpeed ?? 1;
		this.lookSpeed = options.lookSpeed ?? 0.005;
		this.dampingFactor = options.dampingFactor ?? 0.1;
		this.lookVertical = options.lookVertical ?? true;
		this.autoForward = options.autoForward ?? false;
		this.heightSpeed = options.heightSpeed ?? false;
		this.heightCoef = options.heightCoef ?? 1;
		this.heightMin = options.heightMin ?? 0;
		this.heightMax = options.heightMax ?? 1;
		this.constrainVertical = options.constrainVertical ?? false;
		this.verticalMin = options.verticalMin ?? 0;
		this.verticalMax = options.verticalMax ?? Math.PI;
		this.pointerSpeed = options.pointerSpeed ?? 1;
		this.minPolarAngle = options.minPolarAngle ?? 0;
		this.maxPolarAngle = options.maxPolarAngle ?? Math.PI;
		// Input that is down already, such as a held button, starts no drag.
		const { pointer, touches } = this.input;
		this.held = pointer.buttons !== 0;
		this.fingers = touches.length;
		this.anchor();
		// As three.js's controls do when they start: take the view's angles from the camera.
		this.takeView();
	}

	/**
	 * Moves and turns the camera by the frame's input. Call it once per frame in `onUpdate`, with
	 * the frame's step in seconds. Returns true when the camera moved or turned.
	 */
	update(dt: number): boolean {
		if (!this.enabled) return false;
		this.pose.sync();
		const keys = this.readKeys();
		const locked = this.input.pointer.locked;
		if (locked) this.turnByLock();
		else this.readPointer(keys);
		const step = dt > 0 ? dt : 0;
		const { values, velocity, pose } = this;
		const { position } = pose;
		let drive = (keys & KEY_FORWARD ? 1 : 0) - (keys & KEY_BACK ? 1 : 0);
		let lookMove = (this.pointerForward ? 1 : 0) - (this.pointerBackward ? 1 : 0);
		if (this.autoForward && drive === 0 && lookMove === 0) lookMove = 1;
		// Faster forward the higher the camera is.
		let forwardSpeed = this.movementSpeed;
		if (this.heightSpeed) {
			const y = Math.max(this.heightMin, Math.min(this.heightMax, position[1] as number));
			forwardSpeed += (y - this.heightMin) * this.heightCoef;
		}
		// The keys move over the ground, by the view's angle around +Y alone, and along +Y.
		const yaw = (values[LON] as number) * RADIANS;
		const sinYaw = Math.sin(yaw);
		const cosYaw = Math.cos(yaw);
		let strafe = (keys & KEY_RIGHT ? 1 : 0) - (keys & KEY_LEFT ? 1 : 0);
		let climb = (keys & KEY_UP ? 1 : 0) - (keys & KEY_DOWN ? 1 : 0);
		// Two keys at once move no faster than one.
		const keyScale = 1 / Math.max(1, Math.sqrt(strafe * strafe + climb * climb + drive * drive));
		strafe *= this.movementSpeed * keyScale;
		climb *= this.movementSpeed * keyScale;
		drive *= (drive > 0 ? forwardSpeed : this.movementSpeed) * keyScale;
		let vx = sinYaw * drive - cosYaw * strafe;
		let vy = climb;
		let vz = cosYaw * drive + sinYaw * strafe;
		if (lookMove !== 0) {
			// The pointer moves along the camera's view.
			this.viewDirection();
			const along = lookMove * (lookMove > 0 ? forwardSpeed : this.movementSpeed);
			const { direction } = this;
			vx += (direction[0] as number) * along;
			vy += (direction[1] as number) * along;
			vz += (direction[2] as number) * along;
		}
		// Ease toward the input's velocity, by a share that suits the frame's step.
		const share = 1 - (1 - this.dampingFactor) ** (DAMPING_RATE * step);
		velocity[0] = (velocity[0] as number) + (vx - (velocity[0] as number)) * share;
		velocity[1] = (velocity[1] as number) + (vy - (velocity[1] as number)) * share;
		velocity[2] = (velocity[2] as number) + (vz - (velocity[2] as number)) * share;
		for (let k = 0; k < 3; k++)
			position[k] = (position[k] as number) + (velocity[k] as number) * step;
		// A drag turns the view at a speed that grows with its length, and eases to a stop after it.
		const ratio = this.constrainVertical ? Math.PI / (this.verticalMax - this.verticalMin) : 1;
		const lookLon = this.looking ? -(values[DRAG_X] as number) * this.lookSpeed : 0;
		const lookLat =
			this.looking && this.lookVertical ? -(values[DRAG_Y] as number) * this.lookSpeed * ratio : 0;
		values[LON_SPEED] =
			(values[LON_SPEED] as number) + (lookLon - (values[LON_SPEED] as number)) * share;
		values[LAT_SPEED] =
			(values[LAT_SPEED] as number) + (lookLat - (values[LAT_SPEED] as number)) * share;
		values[LON] = (values[LON] as number) + (values[LON_SPEED] as number) * step;
		values[LAT] = (values[LAT] as number) + (values[LAT_SPEED] as number) * step;
		// A locked pointer keeps the view within the polar limits, and a drag within 85 degrees of
		// the level.
		if (locked) this.clampPolar();
		else values[LAT] = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, values[LAT] as number));
		this.turnToView();
		pose.write();
		return pose.changed();
	}

	/** Turns the camera toward a point, and takes the view's angles from there. */
	lookAt(x: number, y: number, z: number): void {
		const { pose, direction } = this;
		pose.sync();
		const { position } = pose;
		direction[0] = x - (position[0] as number);
		direction[1] = y - (position[1] as number);
		direction[2] = z - (position[2] as number);
		this.setView();
		this.turnToView();
		pose.write();
	}

	/**
	 * Moves the camera forward over the ground, at right angles to its right, as three.js's
	 * `PointerLockControls.moveForward` does. Negative distances move it back.
	 */
	moveForward(distance: number): void {
		if (!this.enabled) return;
		const { pose, right } = this;
		pose.sync();
		this.rightAxis();
		// Forward is +Y crossed with the camera's right.
		const { position } = pose;
		position[0] = (position[0] as number) + (right[2] as number) * distance;
		position[2] = (position[2] as number) - (right[0] as number) * distance;
		pose.writePosition();
	}

	/** Moves the camera to its right, as three.js's `PointerLockControls.moveRight` does. */
	moveRight(distance: number): void {
		if (!this.enabled) return;
		const { pose, right } = this;
		pose.sync();
		this.rightAxis();
		const { position } = pose;
		for (let k = 0; k < 3; k++)
			position[k] = (position[k] as number) + (right[k] as number) * distance;
		pose.writePosition();
	}

	/** Copies the direction the camera looks in into `out`, and returns `out`. */
	getDirection<T extends Vec3Like>(out: T): T {
		this.pose.sync();
		this.viewDirection();
		const { direction } = this;
		out[0] = direction[0] as number;
		out[1] = direction[1] as number;
		out[2] = direction[2] as number;
		return out;
	}

	/** The keys held, as `KEY_` bits. */
	private readKeys(): number {
		const { input } = this;
		return (
			(input.isDown('KeyW') || input.isDown('ArrowUp') ? KEY_FORWARD : 0) |
			(input.isDown('KeyS') || input.isDown('ArrowDown') ? KEY_BACK : 0) |
			(input.isDown('KeyA') || input.isDown('ArrowLeft') ? KEY_LEFT : 0) |
			(input.isDown('KeyD') || input.isDown('ArrowRight') ? KEY_RIGHT : 0) |
			(input.isDown('KeyR') ? KEY_UP : 0) |
			(input.isDown('KeyF') ? KEY_DOWN : 0)
		);
	}

	/**
	 * Follows the drag of the mouse or the fingers. A press starts a drag that looks around: the left
	 * button or one finger also walks forward, and the right button or two fingers walk back. A
	 * change in the count of fingers starts the drag again from where the fingers are.
	 */
	private readPointer(keys: number): void {
		const { pointer, touches } = this.input;
		const { values } = this;
		const count = touches.length;
		if (count !== this.fingers) {
			this.fingers = count;
			this.pointerForward = count === 1;
			this.pointerBackward = count >= 2;
			this.looking = count > 0;
			this.anchor();
			return;
		}
		if (count > 0) {
			const first = touches[0];
			if (first) {
				values[DRAG_X] = first.x - (values[DOWN_X] as number);
				values[DRAG_Y] = first.y - (values[DOWN_Y] as number);
			}
			return;
		}
		const buttons = pointer.buttons;
		if (buttons === 0) {
			this.held = false;
			if (this.looking) this.endDrag();
			return;
		}
		if (this.held) return;
		if (!this.looking) {
			// While a key walks forward or back, a press only looks.
			const walking = (keys & (KEY_FORWARD | KEY_BACK)) !== 0;
			this.pointerForward = !walking && (buttons & MAIN_BUTTON) !== 0;
			this.pointerBackward = !walking && !this.pointerForward && (buttons & RIGHT_BUTTON) !== 0;
			this.looking = true;
			// The press was where the pointer is now, less the drag since the press.
			values[DOWN_X] = pointer.x - pointer.dragDx;
			values[DOWN_Y] = pointer.y - pointer.dragDy;
		}
		values[DRAG_X] = pointer.x - (values[DOWN_X] as number);
		values[DRAG_Y] = pointer.y - (values[DOWN_Y] as number);
	}

	/** Ends a drag: the walk along the view stops, and the turn eases to a stop. */
	private endDrag(): void {
		this.looking = false;
		this.pointerForward = false;
		this.pointerBackward = false;
		this.values[DRAG_X] = 0;
		this.values[DRAG_Y] = 0;
	}

	/** Starts the drag from where the pointer or the first finger is now. */
	private anchor(): void {
		const { pointer, touches } = this.input;
		const first = touches[0];
		const { values } = this;
		values[DOWN_X] = first ? first.x : pointer.x;
		values[DOWN_Y] = first ? first.y : pointer.y;
		values[DRAG_X] = 0;
		values[DRAG_Y] = 0;
	}

	/** Turns the view by the locked pointer's movement in this frame, as PointerLockControls does. */
	private turnByLock(): void {
		if (this.looking || this.pointerForward || this.pointerBackward) this.endDrag();
		const { pointer } = this.input;
		const { values } = this;
		const turn = MOUSE_SENSITIVITY * this.pointerSpeed * DEGREES;
		values[LON] = (values[LON] as number) - pointer.dx * turn;
		values[LAT] = (values[LAT] as number) - pointer.dy * turn;
		this.clampPolar();
	}

	/** Keeps the view between the polar limits. */
	private clampPolar(): void {
		const { values } = this;
		const lowest = 90 - this.maxPolarAngle * DEGREES;
		const highest = 90 - this.minPolarAngle * DEGREES;
		values[LAT] = Math.max(lowest, Math.min(highest, values[LAT] as number));
	}

	/** Takes the view's angles from the camera's rotation. */
	private takeView(): void {
		this.viewDirection();
		this.setView();
	}

	/** Sets the view's angles to point along `direction`, as three.js's spherical coordinates do. */
	private setView(): void {
		const { direction, values } = this;
		const x = direction[0] as number;
		const y = direction[1] as number;
		const z = direction[2] as number;
		const length = Math.sqrt(x * x + y * y + z * z);
		const phi = length > 0 ? Math.acos(Math.max(-1, Math.min(1, y / length))) : 0;
		const theta = length > 0 ? Math.atan2(x, z) : 0;
		values[LAT] = 90 - phi * DEGREES;
		values[LON] = theta * DEGREES;
	}

	/** The camera's right, into `right`: its +X axis, which its rotation turns. */
	private rightAxis(): void {
		const q = this.pose.rotation;
		const qx = q[0] as number;
		const qy = q[1] as number;
		const qz = q[2] as number;
		const qw = q[3] as number;
		const { right } = this;
		right[0] = 1 - 2 * (qy * qy + qz * qz);
		right[1] = 2 * (qx * qy + qw * qz);
		right[2] = 2 * (qx * qz - qw * qy);
	}

	/** The direction the camera's rotation looks in, into `direction`: its -Z axis. */
	private viewDirection(): void {
		const q = this.pose.rotation;
		const qx = q[0] as number;
		const qy = q[1] as number;
		const qz = q[2] as number;
		const qw = q[3] as number;
		const { direction } = this;
		direction[0] = -2 * (qx * qz + qw * qy);
		direction[1] = -2 * (qy * qz - qw * qx);
		direction[2] = -(1 - 2 * (qx * qx + qy * qy));
	}

	/**
	 * Sets the camera's rotation from the view's angles: a turn around +Y, then a tilt about the
	 * camera's own X axis, with no roll, as three.js's look-at gives it.
	 */
	private turnToView(): void {
		const { values } = this;
		let phi = (90 - (values[LAT] as number)) * RADIANS;
		const theta = (values[LON] as number) * RADIANS;
		if (this.constrainVertical)
			phi = this.verticalMin + (phi / Math.PI) * (this.verticalMax - this.verticalMin);
		// The camera looks down its -Z axis, so a view at angle theta around +Y turns it by theta - π.
		const yaw = (theta - Math.PI) / 2;
		const pitch = (Math.PI / 2 - phi) / 2;
		const sy = Math.sin(yaw);
		const cy = Math.cos(yaw);
		const sx = Math.sin(pitch);
		const cx = Math.cos(pitch);
		const q = this.pose.rotation;
		q[0] = cy * sx;
		q[1] = sy * cx;
		q[2] = -sy * sx;
		q[3] = cy * cx;
	}
}

/**
 * Creates first-person controls, which three.js calls `FirstPersonControls`, and which also take the
 * place of its `PointerLockControls`. Keys walk, and a drag looks around. While the page holds the
 * pointer lock, which `engine.requestPointerLock()` asks for, the mouse turns the view. Call
 * `controls.update(dt)` once per frame in `onUpdate`.
 *
 * @category api/controls
 */
export function createFirstPersonControls(
	ctx: SketchContext,
	camera: PerspectiveCamera | OrthographicCamera,
	options: FirstPersonControlsOptions = {},
): FirstPersonControls {
	return new FirstPersonControls(ctx, camera, options);
}
