// Drag controls for a set of objects, shaped after three.js's DragControls. A press on one of the
// objects drags it over a plane that faces the camera, or turns it as the pointer moves. Like the
// package's other controls, these read the sketch's input once per frame in update(dt), with no DOM
// listeners, and they report the object that they drag instead of sending events.
import {
	mat4,
	type Object3D,
	type OrthographicCamera,
	type PerspectiveCamera,
	quat,
	type RaycastHit,
	type SketchContext,
	type Vec3Like,
	vec3,
} from '@null3d/engine';

/**
 * What a held button or a finger does to a draggable object: drag it over a plane that faces the
 * camera, or turn it about the camera's axes.
 *
 * @category api/controls
 */
export type DragAction = 'pan' | 'rotate';

/**
 * The action of each mouse button, with three.js's names for the buttons. Null gives a button no
 * action.
 *
 * @category api/controls
 */
export interface DragMouseButtons {
	/** The main button. */
	LEFT: DragAction | null;
	/** The middle button, or a pressed wheel. */
	MIDDLE: DragAction | null;
	/** The right button. */
	RIGHT: DragAction | null;
}

/**
 * The action of one finger on the canvas.
 *
 * @category api/controls
 */
export interface DragTouchActions {
	/** One finger on the canvas. */
	ONE: DragAction | null;
}

/**
 * Options for `createDragControls`, with three.js's names and defaults. The controls keep each
 * option as a property of the same name, which a sketch can change at any time.
 *
 * @category api/controls
 */
export interface DragControlsOptions {
	/** False ignores the user's input. The default is true. */
	enabled?: boolean;
	/** True drags a child of a listed object as its parent. The default is true. */
	recursive?: boolean;
	/**
	 * True drags the outermost listed object that holds the one under the pointer, instead of that
	 * object alone. The default is false.
	 */
	transformGroup?: boolean;
	/** How fast a rotate drag turns the object. The default is 1. */
	rotateSpeed?: number;
	/**
	 * The layers that the pointer's ray tests, as `setLayers` takes them. The default is layer 0
	 * alone, where every new object starts.
	 */
	layers?: number;
	/** What each mouse button does. The main button drags and the right one turns, as in three.js. */
	mouseButtons?: Partial<DragMouseButtons>;
	/** What one finger does. A finger drags, as in three.js. */
	touches?: Partial<DragTouchActions>;
}

/** The main, right and middle buttons in `PointerEvent.buttons`. */
const MAIN_BUTTON = 1;
const RIGHT_BUTTON = 2;
const MIDDLE_BUTTON = 4;
/** Below this, a ray runs along the drag's plane rather than across it. */
const ZERO_DOT = 1e-9;
const UP: Vec3Like = [0, 1, 0];
const RIGHT: Vec3Like = [1, 0, 0];

/**
 * Drag controls: they drag the objects of a list over a plane that faces the camera, or turn them
 * about the camera's axes. `createDragControls` makes them. Call `update(dt)` once per frame in
 * `onUpdate`.
 *
 * @category api/controls
 */
export class DragControls {
	/** The objects that a press can drag, which a sketch may add to or remove from at any time. */
	readonly objects: Object3D[];
	/** False ignores the user's input. */
	enabled: boolean;
	/** True drags a child of a listed object as its parent. */
	recursive: boolean;
	/** True drags the outermost listed object that holds the one under the pointer. */
	transformGroup: boolean;
	/** How fast a rotate drag turns the object. */
	rotateSpeed: number;
	/** What each mouse button does. */
	readonly mouseButtons: DragMouseButtons;
	/** What one finger does. */
	readonly touches: DragTouchActions;

	private readonly scene: SketchContext['scene'];
	private readonly input: SketchContext['input'];
	private readonly camera: PerspectiveCamera | OrthographicCamera;
	/** What a raycast of the pointer's candidate objects takes: their layers alone. */
	private readonly pickOptions: { layers: number };
	private readonly ray = { origin: vec3.create(), direction: vec3.create() };
	private readonly hit: RaycastHit = {
		object: null,
		instance: -1,
		point: vec3.create(),
		normal: vec3.create(),
		distance: 0,
		triangle: -1,
	};
	/** The object under the pointer, and the object that a drag holds. */
	private overhead: Object3D | null = null;
	private held: Object3D | null = null;
	/** What the drag does, and the button that holds it in `PointerEvent.buttons`. */
	private action: DragAction | null = null;
	private button = 0;
	/** The plane of a pan drag: a point that it holds, its normal, and the offset of the grab. */
	private readonly planePoint = vec3.create();
	private readonly planeNormal = vec3.create();
	private readonly offset = vec3.create();
	private readonly grabbed = vec3.create();
	private readonly cameraPosition = vec3.create();
	/** The parent's inverse world matrix and world rotation, and the object's pose under it. */
	private readonly parentInverse = mat4.create();
	private readonly parentRotation = quat.create();
	private readonly parentInverseRotation = quat.create();
	private readonly worldPosition = vec3.create();
	private readonly worldRotation = quat.create();
	private readonly cameraRotation = quat.create();
	private readonly position = vec3.create();
	private readonly rotation = quat.create();
	private readonly axis = vec3.create();
	private readonly scratch = vec3.create();
	private readonly turn = quat.create();
	private readonly total = quat.create();
	/** The canvas's size in CSS pixels, which turns a movement into device coordinates. */
	private readonly viewportSize: { width: number; height: number };

	constructor(
		context: SketchContext,
		camera: PerspectiveCamera | OrthographicCamera,
		objects: Object3D[],
		options: DragControlsOptions,
	) {
		this.scene = context.scene;
		this.input = context.input;
		this.camera = camera;
		this.objects = objects;
		this.enabled = options.enabled ?? true;
		this.recursive = options.recursive ?? true;
		this.transformGroup = options.transformGroup ?? false;
		this.rotateSpeed = options.rotateSpeed ?? 1;
		this.pickOptions = { layers: (options.layers ?? 1) >>> 0 };
		this.viewportSize = context.engine.viewport;
		const mouse = options.mouseButtons ?? {};
		this.mouseButtons = {
			LEFT: mouse.LEFT === undefined ? 'pan' : mouse.LEFT,
			MIDDLE: mouse.MIDDLE === undefined ? 'pan' : mouse.MIDDLE,
			RIGHT: mouse.RIGHT === undefined ? 'rotate' : mouse.RIGHT,
		};
		const touch = options.touches ?? {};
		this.touches = { ONE: touch.ONE === undefined ? 'pan' : touch.ONE };
	}

	/** The object that the pointer is over, or null. */
	get hovered(): Object3D | null {
		return this.overhead;
	}

	/** The object that a drag holds, or null while the user drags nothing. */
	get dragging(): Object3D | null {
		return this.held;
	}

	/** What a drag does to the object that it holds, or null while the user drags nothing. */
	get state(): DragAction | null {
		return this.action;
	}

	/**
	 * Reads the frame's input: a press on a listed object begins a drag, and the pointer then moves
	 * or turns that object. Call it once per frame in `onUpdate`. Returns true when it moved an
	 * object.
	 */
	update(_dt: number): boolean {
		if (!this.enabled) {
			this.overhead = null;
			return false;
		}
		const { input } = this;
		const { pointer } = input;
		let moved = false;
		if (this.held) {
			if ((pointer.buttons & this.button) !== 0) moved = this.drag(pointer.x, pointer.y);
			else this.end();
		} else {
			const pressed = this.pressed();
			// A still pointer keeps its hover, so that a still scene runs no raycast.
			const changed = pressed !== null || pointer.dx !== 0 || pointer.dy !== 0;
			if (changed && (pressed !== null || !pointer.isTouch)) {
				const target = this.pick(pointer.x, pointer.y);
				this.overhead = target;
				if (target && pressed) this.begin(target, pressed);
			}
		}
		return moved;
	}

	/** Ends the drag that holds an object, if one does. */
	end(): void {
		this.held = null;
		this.action = null;
		this.button = 0;
	}

	/**
	 * The action of a button or a finger that went down in this frame, or null, and the button that
	 * holds the drag in `this.button`.
	 */
	private pressed(): DragAction | null {
		const { input } = this;
		const { pointer } = input;
		if (pointer.isTouch) {
			if (!input.wasPressed('Mouse0')) return null;
			this.button = MAIN_BUTTON;
			return this.touches.ONE;
		}
		if (input.wasPressed('Mouse0')) {
			this.button = MAIN_BUTTON;
			return this.mouseButtons.LEFT;
		}
		if (input.wasPressed('Mouse1')) {
			this.button = MIDDLE_BUTTON;
			return this.mouseButtons.MIDDLE;
		}
		if (input.wasPressed('Mouse2')) {
			this.button = RIGHT_BUTTON;
			return this.mouseButtons.RIGHT;
		}
		return null;
	}

	/** Finds the listed object that the pointer is on, or null. */
	private pick(x: number, y: number): Object3D | null {
		this.camera.screenToRay(x, y, this.ray);
		const { hit } = this;
		if (!this.scene.raycast(this.ray.origin, this.ray.direction, this.pickOptions, hit))
			return null;
		// A ray hits objects and the rows of batches, and a batch is no listed object.
		const object = hit.object as Object3D | null;
		if (!object) return null;
		if (!this.recursive) return this.objects.includes(object) ? object : null;
		// The outermost listed object that holds the one under the pointer, or the nearest one.
		let found: Object3D | null = null;
		for (let node: Object3D | null = object; node; node = node.getParent()) {
			if (!this.objects.includes(node)) continue;
			found = node;
			if (!this.transformGroup) break;
		}
		return found;
	}

	/** Starts a drag of `object`, with the plane or the axes that the action takes. */
	private begin(object: Object3D, action: DragAction): void {
		const { pointer } = this.input;
		this.held = object;
		this.action = action;
		const parent = object.getParent();
		if (parent) {
			parent.getWorldMatrix(this.parentInverse);
			mat4.invert(this.parentInverse, this.parentInverse);
			parent.getWorldQuaternion(this.parentRotation);
			quat.invert(this.parentInverseRotation, this.parentRotation);
		} else {
			mat4.identity(this.parentInverse);
			quat.identity(this.parentRotation);
			quat.identity(this.parentInverseRotation);
		}
		object.getWorldPosition(this.worldPosition);
		vec3.copy(this.planePoint, this.worldPosition);
		this.camera.getWorldPosition(this.cameraPosition);
		vec3.sub(this.planeNormal, this.cameraPosition, this.worldPosition);
		vec3.normalize(this.planeNormal, this.planeNormal);
		// The grab point on the plane, less the object's place, stays with the object as it moves.
		this.camera.screenToRay(pointer.x, pointer.y, this.ray);
		if (!this.planeHit(this.grabbed)) {
			this.end();
			return;
		}
		vec3.sub(this.offset, this.grabbed, this.worldPosition);
	}

	/** Applies the frame's pointer movement to the object that the drag holds. */
	private drag(x: number, y: number): boolean {
		const object = this.held;
		if (!object) return false;
		if (this.action === 'pan') {
			this.camera.screenToRay(x, y, this.ray);
			if (!this.planeHit(this.position)) return false;
			// Where the grab point has come to, less the offset that it started with.
			vec3.sub(this.position, this.position, this.offset);
			vec3.transformMat4(this.position, this.position, this.parentInverse);
			object.setPosition(
				this.position[0] as number,
				this.position[1] as number,
				this.position[2] as number,
			);
			return true;
		}
		const { pointer } = this.input;
		// A turn: the pointer's movement across the screen, about the camera's up and right axes.
		const across = (2 * pointer.dx * this.rotateSpeed) / this.viewportSize.width;
		const down = (2 * pointer.dy * this.rotateSpeed) / this.viewportSize.height;
		if (across === 0 && down === 0) return false;
		this.camera.getWorldQuaternion(this.cameraRotation);
		object.getWorldQuaternion(this.worldRotation);
		quat.identity(this.total);
		vec3.transformQuat(this.axis, UP, this.cameraRotation);
		quat.setAxisAngle(this.turn, this.axis, across);
		quat.multiply(this.total, this.turn, this.total);
		vec3.transformQuat(this.axis, RIGHT, this.cameraRotation);
		quat.setAxisAngle(this.turn, this.axis, -down);
		quat.multiply(this.total, this.turn, this.total);
		// The turn in the world, carried into the parent's space, which holds the object's own turn.
		quat.multiply(this.worldRotation, this.total, this.worldRotation);
		quat.multiply(this.rotation, this.parentInverseRotation, this.worldRotation);
		object.setRotation(
			this.rotation[0] as number,
			this.rotation[1] as number,
			this.rotation[2] as number,
			this.rotation[3] as number,
		);
		return true;
	}

	/** True when the ray meets the drag's plane in front of its origin, which it writes to `out`. */
	private planeHit(out: Vec3Like): boolean {
		const denominator = vec3.dot(this.ray.direction, this.planeNormal);
		if (Math.abs(denominator) < ZERO_DOT) return false;
		const distance =
			vec3.dot(vec3.sub(this.scratch, this.planePoint, this.ray.origin), this.planeNormal) /
			denominator;
		if (!(distance > 0) || !Number.isFinite(distance)) return false;
		vec3.scaleAndAdd(out, this.ray.origin, this.ray.direction, distance);
		return true;
	}
}

/**
 * Creates drag controls, which three.js calls `DragControls`. A press on one of `objects` drags it
 * over a plane that faces the camera, and the right button or an option turns it instead.
 * `controls.update(dt)` reads the input once per frame in `onUpdate`, and `controls.dragging` names
 * the object that the pointer holds. Pass the sketch's context first, as the other controls take
 * it.
 *
 * @category api/controls
 */
export function createDragControls(
	context: SketchContext,
	camera: PerspectiveCamera | OrthographicCamera,
	objects: Object3D[],
	options: DragControlsOptions = {},
): DragControls {
	return new DragControls(context, camera, objects, options);
}
