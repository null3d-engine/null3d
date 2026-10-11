// Always-on interaction for the demos. Each demo runs by itself and takes the user's input at any
// moment, with no switch:
//
// - The camera: orbit controls from @null3d/controls. The sketch's own camera motion runs until
//   the user's first camera gesture: a drag with any button or one finger, the wheel, or a pinch.
//   From then on, the user owns the camera, and the scene goes on moving. Until then, the controls'
//   target follows the point that the scripted camera looks at, so the hand-over never jumps.
// - Steering: in a demo with something to lead, the pointer points at a plane. A mouse points by
//   hovering, with no button held, since a drag turns the camera. A finger points by tapping, since
//   a one-finger drag turns the camera. A click points too. The engine has no signal for a pointer
//   that leaves the canvas, so after a few seconds with no pointer movement the steered object eases
//   back to its scripted path.
//
// With no input, as in hold mode and the image tests, nothing here moves anything: the camera stays
// where the sketch puts it, and `steer` returns the scripted value unchanged.

import {
	createOrbitControls,
	type OrbitControls,
	type OrbitControlsOptions,
} from '@null3d/controls';
import {
	math,
	type OrthographicCamera,
	type PerspectiveCamera,
	quat,
	type RaycastHit,
	type SketchContext,
	type Vec3Like,
	vec3,
} from '@null3d/engine';

/** Seconds with no pointer movement before the steered object eases back to its scripted path. */
const IDLE = 3;
/** How fast steering eases in and out, and how fast the point follows the pointer, for math.damp. */
const EASE = 3;
const FOLLOW = 12;
/** How far a press may move, in CSS pixels, and still point: the engine's own limits for a click. */
const MOUSE_SLOP = 2;
const FINGER_SLOP = 10;
/** Places in the array of numbers that change every frame. */
const STEERING = 0;
const IDLE_TIME = 1;
const TRAVEL = 2;

/** Options for `interact`: the orbit controls' options, with what the pointer steers. */
export interface InteractOptions extends OrbitControlsOptions {
	/**
	 * The point that the scripted camera looks at. The sketch may change it in place each frame.
	 * The controls orbit it from the user's first gesture.
	 */
	target: Vec3Like;
	/**
	 * The height of the level plane that the pointer points at. A demo with nothing to steer leaves
	 * it and `planeZ` out.
	 */
	groundY?: number;
	/** Or the z of an upright plane that faces +Z, for a demo whose objects face the camera. */
	planeZ?: number;
	/** True to point at the scene's surfaces through a raycast, and at the plane where it hits none. */
	surfaces?: boolean;
	/** The box that keeps the pointed point: its lowest x, y and z, then its highest. */
	bounds?: readonly [number, number, number, number, number, number];
}

/** A demo's camera controls and pointer steering. `interact` makes one. */
export class Interaction {
	/** The orbit controls, which turn the camera from the user's first gesture. */
	readonly controls: OrbitControls;
	/** Where the pointer last pointed, eased so that the steered object glides. */
	readonly point = vec3.create();
	private readonly values: [number, number, number] = [0, IDLE, 0];
	/** The corners of the box that keeps the pointed point. */
	private readonly low = vec3.create();
	private readonly high = vec3.create();
	private readonly hit: RaycastHit = {
		object: null,
		instance: -1,
		point: vec3.create(),
		normal: vec3.create(),
		distance: 0,
		triangle: -1,
	};
	private readonly ray = { origin: vec3.create(), direction: vec3.create() };
	/** The camera's position. A plain array keeps the full precision of large-world mode. */
	private readonly position = vec3.create();
	private handedOver = false;

	constructor(
		private readonly ctx: SketchContext,
		private readonly camera: PerspectiveCamera | OrthographicCamera,
		private readonly options: InteractOptions,
	) {
		// The controls turn the camera toward the target as they start: put it back where the sketch
		// had it, so that the scripted camera keeps its exact pose.
		const { position } = this;
		const rotation = quat.create();
		camera.getPosition(position);
		camera.getRotation(rotation);
		this.controls = createOrbitControls(ctx, camera, { enableDamping: true, ...options });
		camera.setPosition(position[0], position[1], position[2]);
		camera.setRotation(rotation[0], rotation[1], rotation[2], rotation[3]);
		const bounds = options.bounds ?? [
			-Infinity,
			-Infinity,
			-Infinity,
			Infinity,
			Infinity,
			Infinity,
		];
		vec3.set(this.low, bounds[0], bounds[1], bounds[2]);
		vec3.set(this.high, bounds[3], bounds[4], bounds[5]);
	}

	/** True once the user has taken the camera. Until then the sketch moves it. */
	get userCamera(): boolean {
		return this.handedOver;
	}

	/** How much the pointer steers, from 0 (the scripted path) to 1 (the pointed point). */
	get steering(): number {
		return this.values[STEERING];
	}

	/**
	 * Reads the frame's input: hands the camera over at the user's first gesture, moves it from then
	 * on, and follows the pointer. Call it once per frame, after the scripted camera has moved.
	 */
	update(dt: number): void {
		const { input } = this.ctx;
		const { pointer } = input;
		const { values, controls } = this;
		if (input.wasPressed('Mouse0') || input.wasPressed('Mouse1') || input.wasPressed('Mouse2'))
			values[TRAVEL] = 0;
		values[TRAVEL] += Math.abs(pointer.dragDx) + Math.abs(pointer.dragDy);
		const slop = pointer.isTouch ? FINGER_SLOP : MOUSE_SLOP;
		if (!this.handedOver) {
			vec3.copy(controls.target, this.options.target);
			if (values[TRAVEL] > slop || pointer.wheel !== 0 || input.touches.length > 1) {
				this.handedOver = true;
				controls.autoRotate = false;
			}
		}
		if (this.handedOver || controls.autoRotate) controls.update(dt);
		if (this.options.groundY === undefined && this.options.planeZ === undefined) return;

		const hovered =
			!pointer.isTouch && pointer.buttons === 0 && (pointer.dx !== 0 || pointer.dy !== 0);
		const tapped = input.wasReleased('Mouse0') && values[TRAVEL] <= slop;
		if ((hovered || tapped) && this.aim(pointer.x, pointer.y)) {
			// The first point of a new steer takes the pointer's place at once; later ones glide.
			if (values[STEERING] < 0.01) vec3.copy(this.point, this.hit.point);
			values[IDLE_TIME] = 0;
		} else values[IDLE_TIME] += dt;
		// Close a share of the gap that suits the frame's step, as math.damp does for one number.
		vec3.lerp(this.point, this.point, this.hit.point, 1 - Math.exp(-FOLLOW * dt));
		const goal = values[IDLE_TIME] < IDLE ? 1 : 0;
		const steering = math.damp(values[STEERING], goal, EASE, dt);
		values[STEERING] = goal === 0 && steering < 0.001 ? 0 : steering;
	}

	/** Moves `scripted` in place toward the pointed point, by how much the pointer steers. */
	steer<T extends Vec3Like>(scripted: T): T {
		return vec3.lerp(scripted, scripted, this.point, this.values[STEERING]);
	}

	/**
	 * Moves the user's camera and its target together, for a target that travels on, such as a car.
	 * Before the hand-over the sketch moves the camera, and this does nothing.
	 */
	shift(dx: number, dy: number, dz: number): void {
		if (!this.handedOver) return;
		const { target } = this.controls;
		vec3.set(target, target[0] + dx, target[1] + dy, target[2] + dz);
		const { position } = this;
		this.camera.getPosition(position);
		this.camera.setPosition(position[0] + dx, position[1] + dy, position[2] + dz);
	}

	/** Finds the point under the canvas point, into the hit's point. False when there is none. */
	private aim(x: number, y: number): boolean {
		const { ray, hit, options } = this;
		const { origin, direction } = ray;
		this.camera.screenToRay(x, y, ray);
		if (!(options.surfaces && this.ctx.scene.raycast(origin, direction, undefined, hit))) {
			const axis = options.planeZ === undefined ? 1 : 2;
			const along = ((options.planeZ ?? options.groundY ?? 0) - origin[axis]) / direction[axis];
			if (!(along > 0 && Number.isFinite(along))) return false;
			vec3.scaleAndAdd(hit.point, origin, direction, along);
		}
		vec3.max(hit.point, vec3.min(hit.point, hit.point, this.high), this.low);
		return true;
	}
}

/**
 * Gives a demo's camera orbit controls that take over at the user's first gesture, and, with a
 * plane, a point that the pointer steers. Call `update(dt)` in each frame.
 */
export const interact = (
	ctx: SketchContext,
	camera: PerspectiveCamera | OrthographicCamera,
	options: InteractOptions,
): Interaction => new Interaction(ctx, camera, options);
