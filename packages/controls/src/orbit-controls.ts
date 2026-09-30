// Orbit and map controls for a sketch's camera, with three.js's option names and behavior. Where
// three.js's controls react to each DOM event, these read the sketch's input once per frame, in
// update(dt). Turns, pans and zooms add up over a frame's events, so a frame reaches the pose that
// three.js reaches after the same events. The math follows three.js's OrbitControls and
// MapControls step for step: the camera sits on a sphere around the target, in spherical
// coordinates with +Y up.
// update(dt) allocates nothing: the state lives in typed arrays and number fields made once, and
// the per-frame helpers take no fractions as arguments.

import {
	type Camera,
	type InputPointer,
	type InputTouch,
	type SketchContext,
	type Vec3Like,
	vec3,
} from '@null3d/engine';

/**
 * What a held mouse button does: turn the camera around the target, dolly it toward the target, or
 * pan the camera and the target together.
 *
 * @category api/controls
 */
export type MouseAction = 'rotate' | 'dolly' | 'pan';

/**
 * What one finger does.
 *
 * @category api/controls
 */
export type OneFingerAction = 'rotate' | 'pan';

/**
 * What two fingers do: they dolly as they spread or close, and pan or rotate as they move together.
 *
 * @category api/controls
 */
export type TwoFingerAction = 'dolly-pan' | 'dolly-rotate';

/**
 * The action of each mouse button, with three.js's names for the buttons. Null gives a button no
 * action.
 *
 * @category api/controls
 */
export interface MouseButtons {
	/** The main button. */
	LEFT: MouseAction | null;
	/** The middle button, or a pressed wheel. */
	MIDDLE: MouseAction | null;
	/** The right button. */
	RIGHT: MouseAction | null;
}

/**
 * The action of one finger and of two fingers, with three.js's names. Null gives no action.
 *
 * @category api/controls
 */
export interface TouchActions {
	/** One finger on the canvas. */
	ONE: OneFingerAction | null;
	/** Two fingers on the canvas. */
	TWO: TwoFingerAction | null;
}

/**
 * Options for `createOrbitControls` and `createMapControls`, with three.js's names and defaults.
 * The controls keep each option as a property of the same name, which a sketch can change at any
 * time.
 *
 * @category api/controls
 */
export interface OrbitControlsOptions {
	/** The point the camera orbits and looks at. The default is (0, 0, 0). */
	target?: Vec3Like;
	/**
	 * False ignores the user's input. Damping and auto-rotation still move the camera. The default
	 * is true.
	 */
	enabled?: boolean;
	/**
	 * True keeps the camera moving for a moment after the user lets go, and slows it each frame. The
	 * default is false.
	 */
	enableDamping?: boolean;
	/**
	 * The share of the remaining motion that each frame applies with damping on, at 60 frames per
	 * second. Other frame rates get the same motion over the same time. The default is 0.05.
	 */
	dampingFactor?: number;
	/** False stops the user turning the camera. The default is true. */
	enableRotate?: boolean;
	/** How fast drags turn the camera. The default is 1. */
	rotateSpeed?: number;
	/** False stops the user dollying the camera. The default is true. */
	enableZoom?: boolean;
	/** How fast the wheel, a pinch and a dolly drag move the camera. The default is 1. */
	zoomSpeed?: number;
	/** False stops the user panning the camera. The default is true. */
	enablePan?: boolean;
	/** How fast drags pan the camera. The default is 1. */
	panSpeed?: number;
	/**
	 * True pans in the plane of the screen. False pans over the ground: the plane at right angles to
	 * +Y. The default is true for orbit controls and false for map controls.
	 */
	screenSpacePanning?: boolean;
	/** The closest the camera comes to the target. The default is 0. */
	minDistance?: number;
	/** The farthest the camera goes from the target. The default is Infinity. */
	maxDistance?: number;
	/**
	 * The smallest angle between the camera and +Y as seen from the target, in radians. The default
	 * is 0.
	 */
	minPolarAngle?: number;
	/**
	 * The largest angle between the camera and +Y as seen from the target, in radians. The default
	 * is π.
	 */
	maxPolarAngle?: number;
	/**
	 * The smallest angle around +Y, in radians. At 0 the camera is on the target's +Z side. With
	 * both limits set, the range must lie within -2π to 2π and span less than 2π. The default is
	 * -Infinity.
	 */
	minAzimuthAngle?: number;
	/** The largest angle around +Y, in radians. The default is Infinity. */
	maxAzimuthAngle?: number;
	/**
	 * True turns the camera around the target while the user is not dragging. It stops while the user
	 * asks for less motion. The default is false.
	 */
	autoRotate?: boolean;
	/** How fast auto-rotation turns: 2 takes 30 seconds for one turn. The default is 2. */
	autoRotateSpeed?: number;
	/**
	 * What each mouse button does. Orbit controls rotate with the left button, dolly with the middle
	 * one and pan with the right one. Map controls pan with the left button and rotate with the right
	 * one.
	 */
	mouseButtons?: Partial<MouseButtons>;
	/**
	 * What one and two fingers do. Orbit controls rotate with one finger and dolly and pan with two.
	 * Map controls pan with one finger and dolly and rotate with two.
	 */
	touches?: Partial<TouchActions>;
}

/** The user's gestures. */
const NONE = 0;
const ROTATE = 1;
const DOLLY = 2;
const PAN = 3;
const DOLLY_PAN = 4;
const DOLLY_ROTATE = 5;

/** The main, right and middle buttons in `PointerEvent.buttons`. */
const MAIN_BUTTON = 1;
const RIGHT_BUTTON = 2;
const MIDDLE_BUTTON = 4;

const TWO_PI = 2 * Math.PI;
/** How close the camera may come to either pole, in radians, as three.js keeps it. */
const POLE_MARGIN = 0.000001;
/** A squared distance past which the camera or the target counts as moved, as in three.js. */
const MOVED = 0.000001;
/** The frame rate at which a damping factor applies once per frame, as three.js applies it. */
const DAMPING_RATE = 60;
/** Each 100 pixels of wheel scroll or dolly drag scale the distance by this, as in three.js. */
const ZOOM_BASE = 0.95;
/** A pinch on a trackpad zooms this many times as far as its wheel scroll, as in three.js. */
const PINCH_BOOST = 10;
/** Keys that swap a mouse button's rotate and pan while held, as in three.js. */
const SWAP_KEYS = [
	'ShiftLeft',
	'ShiftRight',
	'ControlLeft',
	'ControlRight',
	'MetaLeft',
	'MetaRight',
];
const UP: Vec3Like = [0, 1, 0];

/**
 * Places in the controls' array of numbers that change every frame: the turns due around +Y and
 * away from +Y, the factor that the next update scales the distance by, the camera's angles after
 * the last update, the distance between two fingers in the previous frame, and a map drag's ground
 * height.
 */
const THETA_DELTA = 0;
const PHI_DELTA = 1;
const SCALE = 2;
const THETA = 3;
const PHI = 4;
const SPREAD = 5;
const GROUND = 6;
const VALUES = 7;

/** The distance between two fingers, in CSS pixels. */
function fingerDistance(a: InputTouch, b: InputTouch): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Orbit controls: they turn a camera around a target point, dolly it toward the target, and pan
 * both. They follow the sketch's pointer, wheel and touch input. `createOrbitControls` makes them.
 * Call `update` once per frame in `onUpdate`.
 *
 * @category api/controls
 */
export class OrbitControls {
	/**
	 * The point the camera orbits and looks at. Change it in place, such as with
	 * `vec3.set(controls.target, x, y, z)`.
	 */
	readonly target: [number, number, number] = [0, 0, 0];
	/** False ignores the user's input. Damping and auto-rotation still move the camera. */
	enabled: boolean;
	/** True keeps the camera moving for a moment after the user lets go. */
	enableDamping: boolean;
	/**
	 * The share of the remaining motion that each frame applies with damping on, at 60 frames per
	 * second.
	 */
	dampingFactor: number;
	/** False stops the user turning the camera. */
	enableRotate: boolean;
	/** How fast drags turn the camera. */
	rotateSpeed: number;
	/** False stops the user dollying the camera. */
	enableZoom: boolean;
	/** How fast the wheel, a pinch and a dolly drag move the camera. */
	zoomSpeed: number;
	/** False stops the user panning the camera. */
	enablePan: boolean;
	/** How fast drags pan the camera. */
	panSpeed: number;
	/** True pans in the plane of the screen; false pans over the ground. */
	screenSpacePanning: boolean;
	/** The closest the camera comes to the target. */
	minDistance: number;
	/** The farthest the camera goes from the target. */
	maxDistance: number;
	/** The smallest angle between the camera and +Y as seen from the target, in radians. */
	minPolarAngle: number;
	/** The largest angle between the camera and +Y as seen from the target, in radians. */
	maxPolarAngle: number;
	/** The smallest angle around +Y, in radians. */
	minAzimuthAngle: number;
	/** The largest angle around +Y, in radians. */
	maxAzimuthAngle: number;
	/** True turns the camera around the target while the user is not dragging. */
	autoRotate: boolean;
	/** How fast auto-rotation turns: 2 takes 30 seconds for one turn. */
	autoRotateSpeed: number;
	/** What each mouse button does. */
	readonly mouseButtons: MouseButtons;
	/** What one and two fingers do. */
	readonly touches: TouchActions;

	private readonly input: SketchContext['input'];
	private readonly viewport: SketchContext['engine']['viewport'];
	private readonly preferences: SketchContext['preferences'];
	/** The camera's position in double precision, as the controls last wrote or read it. */
	private readonly position = new Float64Array(3);
	/** The camera's position as the camera stores it, after the controls last wrote or read it. */
	private readonly stored = new Float64Array(3);
	/** Where `readCamera` reads the camera's position. */
	private readonly read = new Float64Array(3);
	/**
	 * The movement that the next turn, pan or dolly applies, across and down in CSS pixels. Helpers
	 * take it here rather than as arguments: a call that the browser does not inline would put each
	 * fraction it passes in an object of its own.
	 */
	private readonly drag = new Float64Array(2);
	/** A point of the canvas in normalized device coordinates, for a ray from the camera. */
	private readonly ndc = new Float64Array(2);
	/** How far the next updates move the target, and the camera with it. */
	private readonly panOffset = new Float64Array(3);
	/** The camera's right, up and back directions, from its last turn toward the target. */
	private readonly right = new Float64Array(3);
	private readonly up = new Float64Array(3);
	private readonly back = new Float64Array(3);
	/** The point on the ground that a map drag keeps under the pointer. */
	private readonly grabbed = new Float64Array(3);
	/** Where a ray from the camera through the pointer meets the ground. */
	private readonly hit = new Float64Array(3);
	/** The camera and the target after the last update that moved them. */
	private readonly lastPosition = new Float64Array(3);
	private readonly lastTarget = new Float64Array(3);
	/**
	 * The numbers that change every frame, at the places that the constants above name. They live in
	 * a typed array: some browsers make a new object for each fraction stored in an object's property.
	 */
	private readonly values = new Float64Array(VALUES);
	/** The user's gesture: a drag of the pointer, or of the fingers. */
	private gesture = NONE;
	/**
	 * True while the gesture follows the pointer: the mouse, a pen, or the finger that the pointer
	 * follows. False while it follows the fingers in the input's list.
	 */
	private byPointer = false;
	/** True while the pointer's gesture comes from a finger. */
	private byFinger = false;
	/** The pointer's buttons in the previous frame. */
	private buttons = 0;
	/** The fingers in the previous frame: their count and the ids of the first two. */
	private fingers = 0;
	private firstFinger = -1;
	private secondFinger = -1;
	/** True while a map drag holds a point on the ground under the pointer. */
	private grabbing = false;

	constructor(
		context: SketchContext,
		private readonly camera: Camera,
		options: OrbitControlsOptions,
		/** Map controls pan a mouse drag over the ground by keeping the point under the pointer. */
		private readonly grabsGround: boolean,
	) {
		this.values[SCALE] = 1;
		this.input = context.input;
		this.viewport = context.engine.viewport;
		this.preferences = context.preferences;
		if (options.target) vec3.copy(this.target, options.target);
		this.enabled = options.enabled ?? true;
		this.enableDamping = options.enableDamping ?? false;
		this.dampingFactor = options.dampingFactor ?? 0.05;
		this.enableRotate = options.enableRotate ?? true;
		this.rotateSpeed = options.rotateSpeed ?? 1;
		this.enableZoom = options.enableZoom ?? true;
		this.zoomSpeed = options.zoomSpeed ?? 1;
		this.enablePan = options.enablePan ?? true;
		this.panSpeed = options.panSpeed ?? 1;
		this.screenSpacePanning = options.screenSpacePanning ?? !grabsGround;
		this.minDistance = options.minDistance ?? 0;
		this.maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
		this.minPolarAngle = options.minPolarAngle ?? 0;
		this.maxPolarAngle = options.maxPolarAngle ?? Math.PI;
		this.minAzimuthAngle = options.minAzimuthAngle ?? Number.NEGATIVE_INFINITY;
		this.maxAzimuthAngle = options.maxAzimuthAngle ?? Number.POSITIVE_INFINITY;
		this.autoRotate = options.autoRotate ?? false;
		this.autoRotateSpeed = options.autoRotateSpeed ?? 2;
		const mouse = options.mouseButtons ?? {};
		this.mouseButtons = {
			LEFT: mouse.LEFT === undefined ? (grabsGround ? 'pan' : 'rotate') : mouse.LEFT,
			MIDDLE: mouse.MIDDLE === undefined ? 'dolly' : mouse.MIDDLE,
			RIGHT: mouse.RIGHT === undefined ? (grabsGround ? 'rotate' : 'pan') : mouse.RIGHT,
		};
		const touch = options.touches ?? {};
		this.touches = {
			ONE: touch.ONE === undefined ? (grabsGround ? 'pan' : 'rotate') : touch.ONE,
			TWO: touch.TWO === undefined ? (grabsGround ? 'dolly-rotate' : 'dolly-pan') : touch.TWO,
		};
		// Input that is down already, such as a held button, starts no gesture.
		const { pointer, touches } = this.input;
		this.buttons = pointer.buttons;
		this.fingers = touches.length;
		this.firstFinger = touches[0]?.id ?? -1;
		this.secondFinger = touches[1]?.id ?? -1;
		// As three.js's controls do when they start: turn the camera toward the target, within the
		// limits.
		this.readCamera();
		this.move(0);
	}

	/**
	 * Moves the camera by the frame's input, damping and auto-rotation, and turns it toward the
	 * target. Call it once per frame in `onUpdate`, with the frame's step in seconds. Returns true
	 * when the camera or the target moved.
	 */
	update(dt: number): boolean {
		this.readCamera();
		this.readInput();
		return this.move(dt);
	}

	/** The distance from the camera to the target. */
	getDistance(): number {
		this.readCamera();
		return vec3.distance(this.position, this.target);
	}

	/**
	 * The angle between the camera and +Y as seen from the target, in radians, after the last
	 * update.
	 */
	getPolarAngle(): number {
		return this.values[PHI] as number;
	}

	/** The camera's angle around +Y as seen from the target, in radians, after the last update. */
	getAzimuthalAngle(): number {
		return this.values[THETA] as number;
	}

	/**
	 * Turns the camera around +Y by `angle` radians, to the camera's left. The next `update`
	 * applies it.
	 */
	rotateLeft(angle: number): void {
		this.values[THETA_DELTA] = (this.values[THETA_DELTA] as number) - angle;
	}

	/** Turns the camera up over the target by `angle` radians. The next `update` applies it. */
	rotateUp(angle: number): void {
		this.values[PHI_DELTA] = (this.values[PHI_DELTA] as number) - angle;
	}

	/**
	 * Pans the camera and the target as a drag of `deltaX` pixels to the right and `deltaY` pixels
	 * down would. The next `update` applies it.
	 */
	pan(deltaX: number, deltaY: number): void {
		this.readCamera();
		this.drag[0] = deltaX;
		this.drag[1] = deltaY;
		this.panByDrag();
	}

	/**
	 * Moves the camera toward the target: `dollyScale` below 1 scales the distance by it. The next
	 * `update` applies it.
	 */
	dollyIn(dollyScale: number): void {
		this.values[SCALE] = (this.values[SCALE] as number) * dollyScale;
	}

	/**
	 * Moves the camera away from the target: `dollyScale` below 1 divides the distance by it. The
	 * next `update` applies it.
	 */
	dollyOut(dollyScale: number): void {
		this.values[SCALE] = (this.values[SCALE] as number) / dollyScale;
	}

	/** Takes the camera's position, unless it is still the one the controls wrote. */
	private readCamera(): void {
		const { read, stored, position } = this;
		this.camera.getPosition(read);
		for (let k = 0; k < 3; k++) {
			if (read[k] === stored[k]) continue;
			// Something else moved the camera: the controls carry on from there, as three.js's do.
			vec3.copy(position, read);
			vec3.copy(stored, read);
			return;
		}
	}

	/**
	 * Turns the frame's pointer, wheel and touch input into turns, pans and dollies. The mouse, a pen
	 * and a single finger drive a gesture through the pointer, whose drag counts from the press to
	 * the release in any frame. Two fingers drive one through the input's list of fingers.
	 */
	private readInput(): void {
		const { pointer, touches } = this.input;
		const count = touches.length;
		const first = touches[0];
		const second = touches[1];
		const firstId = first ? first.id : -1;
		const secondId = second ? second.id : -1;
		const changed =
			count !== this.fingers || firstId !== this.firstFinger || secondId !== this.secondFinger;
		const hadTwo = this.fingers >= 2;
		const held = this.buttons !== 0;
		const buttons = pointer.buttons;
		this.fingers = count;
		this.firstFinger = firstId;
		this.secondFinger = secondId;
		this.buttons = buttons;
		if (!this.enabled) {
			this.gesture = NONE;
			return;
		}
		// A frame where the fingers change cannot tell which movement came before the change, so it
		// starts the new gesture and leaves out the movement, a frame's worth at most.
		if (count >= 2) {
			if (changed) this.startFingers(count);
			else if (first && second) this.moveFingers(first, second);
			return;
		}
		if (hadTwo && changed) {
			// Back to one finger, which three.js's controls also take as a new gesture.
			this.gesture = NONE;
			if (count === 1) {
				// While the first finger stays down, the pointer still follows it.
				if (pointer.isTouch && buttons !== 0) this.startPointer(pointer, buttons);
				else this.startFingers(1);
			}
			return;
		}
		if (this.gesture !== NONE && !this.byPointer) {
			if (first && !changed) this.moveFinger(first);
			else this.gesture = NONE;
			return;
		}
		if (this.gesture === NONE && !held) {
			if (buttons !== 0) this.startPointer(pointer, buttons);
			else if (pointer.dragDx !== 0 || pointer.dragDy !== 0) {
				// A press, a drag and a release, all since the previous frame.
				this.startPointer(pointer, this.pressedButtons());
				this.dragPointer(pointer);
				this.gesture = NONE;
				return;
			}
		}
		if (this.gesture !== NONE) {
			this.dragPointer(pointer);
			if (buttons === 0) this.gesture = NONE;
			return;
		}
		// The wheel, where a pinch on a trackpad counts ten times, dollies as a drag down would.
		const scroll = pointer.wheel + (PINCH_BOOST - 1) * pointer.pinch;
		if (scroll !== 0 && this.enableZoom) {
			this.drag[1] = scroll;
			this.dollyByDrag();
		}
	}

	/** The mouse buttons pressed since the previous frame, as `PointerEvent.buttons` bits. */
	private pressedButtons(): number {
		const { input } = this;
		return (
			(input.wasPressed('Mouse0') ? MAIN_BUTTON : 0) |
			(input.wasPressed('Mouse1') ? MIDDLE_BUTTON : 0) |
			(input.wasPressed('Mouse2') ? RIGHT_BUTTON : 0)
		);
	}

	/**
	 * Starts a drag of the pointer: a finger's takes the one-finger action, and the mouse's takes the
	 * action of the button that went down.
	 */
	private startPointer(pointer: InputPointer, buttons: number): void {
		this.byPointer = true;
		this.byFinger = pointer.isTouch;
		this.gesture = pointer.isTouch ? this.oneFinger() : this.mouseGesture(buttons);
		if (this.gesture === PAN && this.grabsGround && !this.byFinger) this.grab(pointer);
	}

	private mouseGesture(buttons: number): number {
		const { mouseButtons } = this;
		const action =
			(buttons & MAIN_BUTTON) !== 0
				? mouseButtons.LEFT
				: (buttons & MIDDLE_BUTTON) !== 0
					? mouseButtons.MIDDLE
					: (buttons & RIGHT_BUTTON) !== 0
						? mouseButtons.RIGHT
						: null;
		if (action === 'dolly') return this.enableZoom ? DOLLY : NONE;
		if (action === null) return NONE;
		// Shift, Control or Meta swaps rotate and pan.
		if ((action === 'pan') !== this.swapKeyDown()) return this.enablePan ? PAN : NONE;
		return this.enableRotate ? ROTATE : NONE;
	}

	private swapKeyDown(): boolean {
		for (let k = 0; k < SWAP_KEYS.length; k++)
			if (this.input.isDown(SWAP_KEYS[k] as string)) return true;
		return false;
	}

	/** Applies the frame's drag of the pointer to the gesture. */
	private dragPointer(pointer: InputPointer): void {
		const { drag } = this;
		switch (this.gesture) {
			case ROTATE:
				if (!this.enableRotate) break;
				drag[0] = pointer.dragDx;
				drag[1] = pointer.dragDy;
				this.rotateByDrag();
				break;
			case DOLLY:
				if (!this.enableZoom) break;
				drag[1] = pointer.dragDy;
				this.dollyByDrag();
				break;
			case PAN:
				if (!this.enablePan) break;
				// A map's mouse drag keeps the ground under the pointer; a finger pans as three.js's does.
				if (this.grabsGround && !this.byFinger && !this.screenSpacePanning) {
					if (this.grabbing && (pointer.dragDx !== 0 || pointer.dragDy !== 0))
						this.dragGround(pointer);
					break;
				}
				drag[0] = pointer.dragDx * this.panSpeed;
				drag[1] = pointer.dragDy * this.panSpeed;
				this.panByDrag();
				break;
		}
	}

	/** Starts the gesture of this many fingers, which follows the input's list of fingers. */
	private startFingers(count: number): void {
		this.byPointer = false;
		this.byFinger = true;
		this.gesture = count === 1 ? this.oneFinger() : count === 2 ? this.twoFingers() : NONE;
		const { touches } = this.input;
		if (count === 2)
			this.values[SPREAD] = fingerDistance(touches[0] as InputTouch, touches[1] as InputTouch);
	}

	private oneFinger(): number {
		const action = this.touches.ONE;
		if (action === 'rotate') return this.enableRotate ? ROTATE : NONE;
		if (action === 'pan') return this.enablePan ? PAN : NONE;
		return NONE;
	}

	private twoFingers(): number {
		const action = this.touches.TWO;
		if (action === 'dolly-pan') return this.enableZoom || this.enablePan ? DOLLY_PAN : NONE;
		if (action === 'dolly-rotate')
			return this.enableZoom || this.enableRotate ? DOLLY_ROTATE : NONE;
		return NONE;
	}

	/** Applies the frame's movement of a finger that the pointer does not follow. */
	private moveFinger(finger: InputTouch): void {
		const { drag } = this;
		if (this.gesture === ROTATE && this.enableRotate) {
			drag[0] = finger.dx;
			drag[1] = finger.dy;
			this.rotateByDrag();
		} else if (this.gesture === PAN && this.enablePan) {
			drag[0] = finger.dx * this.panSpeed;
			drag[1] = finger.dy * this.panSpeed;
			this.panByDrag();
		}
	}

	/**
	 * Applies the frame's movement of two fingers: they dolly as they spread or close, and pan or
	 * rotate as their midpoint moves.
	 */
	private moveFingers(first: InputTouch, second: InputTouch): void {
		const { values } = this;
		const spread = fingerDistance(first, second);
		const before = values[SPREAD] as number;
		values[SPREAD] = spread;
		if (this.gesture !== DOLLY_PAN && this.gesture !== DOLLY_ROTATE) return;
		// Fingers that spread dolly in, and fingers that close dolly out.
		if (this.enableZoom && before > 0 && spread > 0)
			values[SCALE] = (values[SCALE] as number) / (spread / before) ** this.zoomSpeed;
		const { drag } = this;
		const across = (first.dx + second.dx) * 0.5;
		const down = (first.dy + second.dy) * 0.5;
		if (this.gesture === DOLLY_ROTATE) {
			if (!this.enableRotate) return;
			drag[0] = across;
			drag[1] = down;
			this.rotateByDrag();
		} else if (this.enablePan) {
			drag[0] = across * this.panSpeed;
			drag[1] = down * this.panSpeed;
			this.panByDrag();
		}
	}

	/** Turns the camera by the drag: a drag as long as the canvas is high turns it once around. */
	private rotateByDrag(): void {
		const height = this.viewport.height;
		if (!(height > 0)) return;
		const { values, drag } = this;
		const turn = (TWO_PI * this.rotateSpeed) / height;
		values[THETA_DELTA] = (values[THETA_DELTA] as number) - (drag[0] as number) * turn;
		values[PHI_DELTA] = (values[PHI_DELTA] as number) - (drag[1] as number) * turn;
	}

	/** Dollies by the drag's movement down, or by wheel scroll, in pixels: down moves away. */
	private dollyByDrag(): void {
		const { values } = this;
		values[SCALE] =
			(values[SCALE] as number) * ZOOM_BASE ** (-this.zoomSpeed * (this.drag[1] as number) * 0.01);
	}

	/**
	 * Pans by the drag in CSS pixels, so that points at the target's distance follow the pointer. The
	 * canvas's height sets the scale, so its shape does not change the speed.
	 */
	private panByDrag(): void {
		const height = this.viewport.height;
		if (!(height > 0)) return;
		const { position, target, right, up, panOffset, drag } = this;
		const ox = (position[0] as number) - target[0];
		const oy = (position[1] as number) - target[1];
		const oz = (position[2] as number) - target[2];
		const halfHeight =
			Math.sqrt(ox * ox + oy * oy + oz * oz) * Math.tan((this.camera.fov * Math.PI) / 360);
		const left = (2 * (drag[0] as number) * halfHeight) / height;
		const forward = (2 * (drag[1] as number) * halfHeight) / height;
		for (let k = 0; k < 3; k++)
			panOffset[k] = (panOffset[k] as number) - (right[k] as number) * left;
		if (this.screenSpacePanning) {
			for (let k = 0; k < 3; k++)
				panOffset[k] = (panOffset[k] as number) + (up[k] as number) * forward;
		} else {
			// Along the ground, at right angles to the camera's right: +Y crossed with it.
			panOffset[0] = (panOffset[0] as number) + (right[2] as number) * forward;
			panOffset[2] = (panOffset[2] as number) - (right[0] as number) * forward;
		}
	}

	/**
	 * Starts a map drag: the ground point under the press stays under the pointer while the drag
	 * lasts. The ground is the level plane through the target.
	 */
	private grab(pointer: InputPointer): void {
		const { panOffset, ndc } = this;
		panOffset[0] = 0;
		panOffset[1] = 0;
		panOffset[2] = 0;
		this.grabbing = false;
		if (this.screenSpacePanning) return;
		const { width, height } = this.viewport;
		if (!(width > 0 && height > 0)) return;
		this.values[GROUND] = this.target[1];
		// The press was where the pointer is now, less the drag since the press.
		ndc[0] = ((pointer.x - pointer.dragDx) / width) * 2 - 1;
		ndc[1] = 1 - ((pointer.y - pointer.dragDy) / height) * 2;
		this.grabbing = this.rayToGround(this.grabbed);
	}

	/** Pans so that the grabbed ground point comes back under the pointer. */
	private dragGround(pointer: InputPointer): void {
		const { ndc, hit } = this;
		ndc[0] = pointer.ndcX;
		ndc[1] = pointer.ndcY;
		if (this.rayToGround(hit)) vec3.sub(this.panOffset, this.grabbed, hit);
	}

	/**
	 * Where the ray from the camera through the canvas point `ndc` meets the ground, into `out`. The
	 * point is in normalized device coordinates. False when the ray misses the ground.
	 */
	private rayToGround(out: Float64Array): boolean {
		const { width, height } = this.viewport;
		const { position, right, up, back, ndc } = this;
		const ground = this.values[GROUND] as number;
		const tan = Math.tan((this.camera.fov * Math.PI) / 360);
		const across = (ndc[0] as number) * tan * (width / height);
		const upward = (ndc[1] as number) * tan;
		const dy = (right[1] as number) * across + (up[1] as number) * upward - (back[1] as number);
		const y = position[1] as number;
		if (dy === 0) {
			// A level ray meets the ground only when the camera is on it.
			if (y !== ground) return false;
			vec3.copy(out, position);
			return true;
		}
		const along = (ground - y) / dy;
		if (along < 0) return false;
		const dx = (right[0] as number) * across + (up[0] as number) * upward - (back[0] as number);
		const dz = (right[2] as number) * across + (up[2] as number) * upward - (back[2] as number);
		out[0] = (position[0] as number) + dx * along;
		out[1] = ground;
		out[2] = (position[2] as number) + dz * along;
		return true;
	}

	/**
	 * Applies the turns, pans and dolly that are due, within the limits, then places the camera and
	 * turns it toward the target. This is three.js's update, with damping that suits the frame's step.
	 */
	private move(dt: number): boolean {
		const { position, target, panOffset, values } = this;
		const ox = (position[0] as number) - target[0];
		const oy = (position[1] as number) - target[1];
		const oz = (position[2] as number) - target[2];
		let radius = Math.sqrt(ox * ox + oy * oy + oz * oz);
		let theta = 0;
		let phi = 0;
		if (radius > 0) {
			theta = Math.atan2(ox, oz);
			phi = Math.acos(Math.max(-1, Math.min(1, oy / radius)));
		}
		const step = dt > 0 ? dt : 0;
		if (this.autoRotate && this.gesture === NONE && !this.preferences.reducedMotion)
			values[THETA_DELTA] =
				(values[THETA_DELTA] as number) - (TWO_PI / 60) * this.autoRotateSpeed * step;
		// With damping, each frame applies a share of the motion that is due, and the rest decays.
		const share = this.enableDamping ? 1 - (1 - this.dampingFactor) ** (DAMPING_RATE * step) : 1;
		theta += (values[THETA_DELTA] as number) * share;
		phi += (values[PHI_DELTA] as number) * share;
		let min = this.minAzimuthAngle;
		let max = this.maxAzimuthAngle;
		if (Number.isFinite(min) && Number.isFinite(max)) {
			if (min < -Math.PI) min += TWO_PI;
			else if (min > Math.PI) min -= TWO_PI;
			if (max < -Math.PI) max += TWO_PI;
			else if (max > Math.PI) max -= TWO_PI;
			if (min <= max) theta = Math.max(min, Math.min(max, theta));
			// A range across ±π: the angle goes to the nearer limit.
			else theta = theta > (min + max) / 2 ? Math.max(min, theta) : Math.min(max, theta);
		}
		phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, phi));
		phi = Math.max(POLE_MARGIN, Math.min(Math.PI - POLE_MARGIN, phi));
		for (let k = 0; k < 3; k++)
			target[k] = (target[k] as number) + (panOffset[k] as number) * share;
		radius = Math.max(
			this.minDistance,
			Math.min(this.maxDistance, radius * (values[SCALE] as number)),
		);
		const across = Math.sin(phi) * radius;
		position[0] = target[0] + across * Math.sin(theta);
		position[1] = target[1] + Math.cos(phi) * radius;
		position[2] = target[2] + across * Math.cos(theta);
		values[THETA] = theta;
		values[PHI] = phi;
		this.place();
		const keep = this.enableDamping ? 1 - share : 0;
		values[THETA_DELTA] = (values[THETA_DELTA] as number) * keep;
		values[PHI_DELTA] = (values[PHI_DELTA] as number) * keep;
		for (let k = 0; k < 3; k++) panOffset[k] = (panOffset[k] as number) * keep;
		values[SCALE] = 1;
		const { lastPosition, lastTarget } = this;
		let movedBy = 0;
		let targetMovedBy = 0;
		for (let k = 0; k < 3; k++) {
			const d = (position[k] as number) - (lastPosition[k] as number);
			const t = (target[k] as number) - (lastTarget[k] as number);
			movedBy += d * d;
			targetMovedBy += t * t;
		}
		if (!(movedBy > MOVED || targetMovedBy > MOVED)) return false;
		vec3.copy(lastPosition, position);
		vec3.copy(lastTarget, target);
		return true;
	}

	/**
	 * Writes the camera's position, turns it toward the target, and keeps its axes as three.js's
	 * look-at makes them, for the pans of the next frame.
	 */
	private place(): void {
		const { camera, position, stored, target, right, up, back } = this;
		camera.setPosition(position[0] as number, position[1] as number, position[2] as number);
		camera.lookAt(target[0], target[1], target[2]);
		camera.getPosition(stored);
		vec3.sub(back, stored, target);
		if (back[0] === 0 && back[1] === 0 && back[2] === 0) back[2] = 1;
		vec3.normalize(back, back);
		vec3.cross(right, UP, back);
		if (right[0] === 0 && right[1] === 0 && right[2] === 0) {
			// The camera looks straight up or down: tilt it slightly, as three.js does.
			back[2] = (back[2] as number) + 0.0001;
			vec3.normalize(back, back);
			vec3.cross(right, UP, back);
		}
		vec3.normalize(right, right);
		vec3.cross(up, back, right);
	}
}

/**
 * Map controls: orbit controls for a camera that looks down on a map. A left drag or one finger
 * pans over the ground and keeps the point under the pointer there. A right drag or two fingers
 * turn the camera. `createMapControls` makes them.
 *
 * @category api/controls
 */
export class MapControls extends OrbitControls {
	constructor(context: SketchContext, camera: Camera, options: OrbitControlsOptions) {
		super(context, camera, options, true);
	}
}

/**
 * Creates orbit controls, which three.js calls `OrbitControls`. A left drag or one finger turns the
 * camera around the target. The wheel, a pinch and a middle drag dolly it. A right drag or two
 * fingers pan. Call `controls.update(dt)` once per frame in `onUpdate`.
 *
 * @category api/controls
 */
export function createOrbitControls(
	ctx: SketchContext,
	camera: Camera,
	options: OrbitControlsOptions = {},
): OrbitControls {
	return new OrbitControls(ctx, camera, options, false);
}

/**
 * Creates map controls, which three.js calls `MapControls`. A left drag or one finger pans over
 * the ground. The wheel, a pinch and a middle drag dolly the camera. A right drag or two fingers
 * turn it. Call `controls.update(dt)` once per frame in `onUpdate`.
 *
 * @category api/controls
 */
export function createMapControls(
	ctx: SketchContext,
	camera: Camera,
	options: OrbitControlsOptions = {},
): MapControls {
	return new MapControls(ctx, camera, options);
}
