// Translate, rotate and scale gizmos for one object, shaped after three.js's TransformControls.
// update(dt) reads the sketch's input once per frame: a press on a handle begins a drag, and the
// pointer's ray then moves, turns or scales the object. Like the package's camera controls, these
// add no DOM listeners.
//
// The handles draw on a layer of their own and their pickers on a second one, so a raycast finds
// the gizmo alone, without testing the scene and without the scene's objects standing in its way.
// The controls add the first layer to the camera when they start, and take it away when they are
// destroyed, so the second one, which the camera leaves out, is never drawn.
import {
	type Material,
	type MeshGeometry,
	mat4,
	type Object3D,
	type OrthographicCamera,
	type PerspectiveCamera,
	type Quat,
	type QuatLike,
	quat,
	type RaycastHit,
	type SketchContext,
	type Vec3,
	type Vec3Like,
	vec3,
} from '@null3d/engine';
import {
	type DragStart,
	type GizmoAxis,
	GizmoDrag,
	type GizmoMode,
	type GizmoSpace,
} from './gizmo-drag';

/**
 * Options for `createTransformControls`, with three.js's names and defaults. The controls keep each
 * option as a property of the same name, which a sketch can change at any time.
 *
 * @category api/controls
 */
export interface TransformControlsOptions {
	/** What a drag does: move the object, turn it or scale it. The default is `'translate'`. */
	mode?: GizmoMode;
	/**
	 * The axes that a drag works along: the world's or the object's own. A scale drag always works
	 * along the object's axes, as in three.js. The default is `'world'`.
	 */
	space?: GizmoSpace;
	/** The size of the handles on the screen. The default is 1. */
	size?: number;
	/** False hides the handles of the X axis, and the planes that it lies in. The default is true. */
	showX?: boolean;
	/** False hides the handles of the Y axis, and the planes that it lies in. The default is true. */
	showY?: boolean;
	/** False hides the handles of the Z axis, and the planes that it lies in. The default is true. */
	showZ?: boolean;
	/** False ignores the user's input. The default is true. */
	enabled?: boolean;
	/** The steps, in meters, that a move snaps to. The default is null: a free move. */
	translationSnap?: number | null;
	/** The steps, in radians, that a turn snaps to. The default is null: a free turn. */
	rotationSnap?: number | null;
	/** The steps that a scale snaps to. The default is null: a free scale. */
	scaleSnap?: number | null;
	/**
	 * The layer that the handles draw on, as `setLayers` takes it. The controls add it to the
	 * camera's layers, and take it away when they are destroyed. The default is layer 30.
	 */
	layers?: number;
	/**
	 * The layer that the handles answer a raycast on. The camera never draws it, so give it a
	 * layer that no camera of the scene draws. The default is layer 29.
	 */
	pickLayers?: number;
}

/** The layer that the handles draw on, away from the layers that a scene usually takes. */
const DEFAULT_LAYERS = 1 << 30;
/** The layer that the handles answer a raycast on, which the camera leaves out. */
const DEFAULT_PICK_LAYERS = 1 << 29;

/** The handles' sizes, before the scale that keeps them the same size on the screen. */
const SHAFT = 0.65;
const SHAFT_RADIUS = 0.012;
const HEAD_LENGTH = 0.16;
const HEAD_RADIUS = 0.045;
const CUBE = 0.07;
const PLANE = 0.22;
const PLANE_OFFSET = 0.3;
const RING = 0.55;
const RING_TUBE = 0.009;
const OUTER_RING = 0.7;
const OUTER_TUBE = 0.007;
const CENTER = 0.06;
/** A picker reaches past its handle, so that a finger finds it too, and starts away from the
 * center handle, so that the handles that meet at the center keep their own pickers. */
const PICK_ARM_FROM = 0.18;
const PICK_ARM_TO = 0.95;
const PICK_ARM = PICK_ARM_TO - PICK_ARM_FROM;
const PICK_ARM_CENTER = (PICK_ARM_FROM + PICK_ARM_TO) / 2;
const PICK_ARM_WIDTH = 0.14;
const PICK_RING_TUBE = 0.07;
const PICK_PLANE = 0.34;
const PICK_PLANE_DEPTH = 0.12;
const PICK_CENTER = 0.26;
/** The order of the handles among the blended objects, which draws them over the scene. */
const RENDER_ORDER = 1000;

/** The colors of the handles, as the hex colors that an unlit material takes. */
const COLORS: Record<GizmoAxis, string> = {
	X: '#ff3b30',
	Y: '#35c759',
	Z: '#2f7bff',
	XY: '#2f7bff',
	YZ: '#ff3b30',
	XZ: '#35c759',
	XYZ: '#c8ccd4',
	E: '#c8ccd4',
};
/** The color that the handle under the pointer takes. */
const HIGHLIGHT = '#ffd400';

/** The three modes, in the order of the groups that hold their handles. */
const MODES: readonly GizmoMode[] = ['translate', 'rotate', 'scale'];

/** The three axes, in order, with the unit vector of each. */
const AXES: readonly { axis: GizmoAxis; unit: Vec3Like }[] = [
	{ axis: 'X', unit: [1, 0, 0] },
	{ axis: 'Y', unit: [0, 1, 0] },
	{ axis: 'Z', unit: [0, 0, 1] },
];
/** The rotation that stands a handle on +Y along each axis. */
const ALONG: readonly Quat[] = [
	[0, 0, -Math.SQRT1_2, Math.SQRT1_2], // X: a quarter turn about Z, against the clock
	[0, 0, 0, 1], // Y: as it is
	[Math.SQRT1_2, 0, 0, Math.SQRT1_2], // Z: a quarter turn about X
];
/** The rotation that stands a ring's own +Z along each axis. */
const RING_ALONG: readonly Quat[] = [
	[0, Math.SQRT1_2, 0, Math.SQRT1_2], // X: a quarter turn about Y
	[-Math.SQRT1_2, 0, 0, Math.SQRT1_2], // Y: against a quarter turn about X
	[0, 0, 0, 1], // Z: as it is
];
/** The plane handles: the size of the tile and where it sits, in its plane's corner. */
const PLANE_HANDLES: readonly { axis: GizmoAxis; size: Vec3; at: Vec3 }[] = [
	{ axis: 'XY', size: [PLANE, PLANE, 0.01], at: [PLANE_OFFSET, PLANE_OFFSET, 0] },
	{ axis: 'YZ', size: [0.01, PLANE, PLANE], at: [0, PLANE_OFFSET, PLANE_OFFSET] },
	{ axis: 'XZ', size: [PLANE, 0.01, PLANE], at: [PLANE_OFFSET, 0, PLANE_OFFSET] },
];
/** The plane handles' pickers, which reach past the tiles. */
const PLANE_PICKERS: readonly { axis: GizmoAxis; size: Vec3; at: Vec3 }[] = [
	{
		axis: 'XY',
		size: [PICK_PLANE, PICK_PLANE, PICK_PLANE_DEPTH],
		at: [PLANE_OFFSET, PLANE_OFFSET, 0],
	},
	{
		axis: 'YZ',
		size: [PICK_PLANE_DEPTH, PICK_PLANE, PICK_PLANE],
		at: [0, PLANE_OFFSET, PLANE_OFFSET],
	},
	{
		axis: 'XZ',
		size: [PICK_PLANE, PICK_PLANE_DEPTH, PICK_PLANE],
		at: [PLANE_OFFSET, 0, PLANE_OFFSET],
	},
];
/** A rotation that turns nothing, and a place at the parent's origin. */
const NO_TURN: Quat = [0, 0, 0, 1];
const NO_MOVE: Vec3 = [0, 0, 0];
/** A camera looks down its -Z axis, so its +Z axis points back toward the viewer. */
const BACK: Vec3Like = [0, 0, 1];

/** One handle of the gizmo, and the mode whose group holds it. */
interface Handle {
	object: Object3D;
	mode: GizmoMode;
	axis: GizmoAxis;
}

/** One material and the handle whose color it takes. */
interface Painted {
	axis: GizmoAxis;
	material: Material;
}

/** The place that a distance along a unit vector reaches. */
function along(unit: Vec3Like, distance: number): Vec3 {
	return [
		(unit[0] as number) * distance,
		(unit[1] as number) * distance,
		(unit[2] as number) * distance,
	];
}

/**
 * Translate, rotate and scale gizmos for one object. `createTransformControls` makes them, and
 * `attach` picks the object. Call `update(dt)` once per frame in `onUpdate`.
 *
 * @category api/controls
 */
export class TransformControls {
	/** What a drag does: move the object, turn it or scale it. */
	mode: GizmoMode;
	/** The axes that a drag works along. A scale drag always works along the object's own axes. */
	space: GizmoSpace;
	/** The size of the handles on the screen. */
	size: number;
	/** True shows the handles of the X axis, and the planes that it lies in. */
	showX = true;
	/** True shows the handles of the Y axis, and the planes that it lies in. */
	showY = true;
	/** True shows the handles of the Z axis, and the planes that it lies in. */
	showZ = true;
	/** False ignores the user's input. */
	enabled: boolean;
	/** The steps, in meters, that a move snaps to, or null for a free move. */
	translationSnap: number | null;
	/** The steps, in radians, that a turn snaps to, or null for a free turn. */
	rotationSnap: number | null;
	/** The steps that a scale snaps to, or null for a free scale. */
	scaleSnap: number | null;

	private readonly scene: SketchContext['scene'];
	private readonly input: SketchContext['input'];
	private readonly geometry: SketchContext['geometry'];
	private readonly materials: SketchContext['materials'];
	private readonly camera: PerspectiveCamera | OrthographicCamera;
	private readonly layers: number;
	private readonly pickLayers: number;
	/** What a raycast of the pickers takes: their own layer alone. */
	private readonly pickOptions: { layers: number };
	/** The camera's layers as they were before the handles' layer joined them. */
	private readonly cameraLayers: number;
	private readonly root: Object3D;
	/** The group of handles of each mode, of which one shows at a time. */
	private readonly groups: Record<GizmoMode, Object3D>;
	private readonly handles: Handle[] = [];
	/** The axis of each handle, which a raycast's hit names. */
	private readonly axes = new Map<Object3D, GizmoAxis>();
	/** Each material and the handle whose color it follows. */
	private readonly painted: Painted[] = [];
	/** The material of each handle, which the modes share. */
	private readonly paints = new Map<GizmoAxis, Material>();
	/** The meshes and the meshes that they draw, which `destroy` frees. */
	private readonly meshes: Object3D[] = [];
	private readonly geometries: MeshGeometry[] = [];
	private readonly pickMaterial: Material;
	/** The ring that turns about the view, and its picker, which face the camera in every frame. */
	private ring: Object3D | undefined;
	private ringPicker: Object3D | undefined;
	private attached: Object3D | undefined;
	private hovering: GizmoAxis | null = null;
	private grabbed: GizmoAxis | null = null;
	/** The handles' visibility as the last pass set it, so that a still scene costs no calls. */
	private shownKey = -1;
	/** The handle whose color the last highlight set. */
	private paintedAxis: GizmoAxis | null = null;
	/** The size that the handles last had, so that a still camera costs no scale call. */
	private placedSize = -1;

	/** The drag whose transform the handles show. */
	private readonly drag = new GizmoDrag();
	/** The pointer's ray, and the hint of the last raycast. */
	private readonly ray = { origin: vec3.create(), direction: vec3.create() };
	private readonly hit: RaycastHit = {
		object: null,
		instance: -1,
		point: vec3.create(),
		normal: vec3.create(),
		distance: 0,
		triangle: -1,
	};
	/** The object's pose in the world, which places the handles. */
	private readonly worldPosition = vec3.create();
	private readonly worldRotation = quat.create();
	private readonly cameraPosition = vec3.create();
	private readonly cameraRotation = quat.create();
	/** Scratch matrices and quaternions for the start of a drag and the ring's turn. */
	private readonly matrix = mat4.create();
	private readonly parentInverse = mat4.create();
	private readonly parentRotation = quat.create();
	private readonly phasePosition = vec3.create();
	private readonly phaseRotation = quat.create();
	private readonly ringRotation = quat.create();
	private readonly dragStart: DragStart = {
		mode: 'translate',
		axis: 'X',
		space: 'world',
		position: vec3.create(),
		rotation: quat.create(),
		scale: vec3.create(),
		worldPosition: vec3.create(),
		worldRotation: quat.create(),
		parentInverse: mat4.create(),
		parentRotation: quat.create(),
		eye: vec3.create(),
		view: vec3.create(),
		rayOrigin: vec3.create(),
		rayDirection: vec3.create(),
	};

	constructor(
		context: SketchContext,
		camera: PerspectiveCamera | OrthographicCamera,
		options: TransformControlsOptions,
	) {
		this.scene = context.scene;
		this.input = context.input;
		this.geometry = context.geometry;
		this.materials = context.materials;
		this.camera = camera;
		this.layers = (options.layers ?? DEFAULT_LAYERS) >>> 0;
		this.pickLayers = (options.pickLayers ?? DEFAULT_PICK_LAYERS) >>> 0;
		this.pickOptions = { layers: this.pickLayers };
		this.mode = options.mode ?? 'translate';
		this.space = options.space ?? 'world';
		this.size = options.size ?? 1;
		this.showX = options.showX ?? true;
		this.showY = options.showY ?? true;
		this.showZ = options.showZ ?? true;
		this.enabled = options.enabled ?? true;
		this.translationSnap = options.translationSnap ?? null;
		this.rotationSnap = options.rotationSnap ?? null;
		this.scaleSnap = options.scaleSnap ?? null;

		// The camera draws the handles' layer from now on, and keeps its other layers.
		this.cameraLayers = camera.getLayers();
		camera.setLayers((this.cameraLayers | this.layers) >>> 0);

		this.pickMaterial = this.materials.unlit({ color: '#ffffff' });
		this.root = this.scene.createGroup({ name: 'transform controls', dynamic: true });
		this.groups = {
			translate: this.scene.createGroup({ name: 'translate handles', parent: this.root }),
			rotate: this.scene.createGroup({ name: 'rotate handles', parent: this.root }),
			scale: this.scene.createGroup({ name: 'scale handles', parent: this.root }),
		};
		this.buildTranslate();
		this.buildRotate();
		this.buildScale();
		this.root.setVisible(false);
		this.applyVisibility();
	}

	/** The object that the handles change, or undefined while none is attached. */
	get object(): Object3D | undefined {
		return this.attached;
	}

	/** The axis under the pointer while the user drags it, or null. */
	get axis(): GizmoAxis | null {
		return this.grabbed ?? this.hovering;
	}

	/** True while the user drags a handle. */
	get dragging(): boolean {
		return this.grabbed !== null;
	}

	/** Picks the object that the handles change, and shows the handles on it. */
	attach(object: Object3D): void {
		this.attached = object;
		this.root.setVisible(true);
		this.placedSize = -1;
		this.shownKey = -1;
		this.applyVisibility();
		this.place();
	}

	/** Hides the handles and stops changing the object. */
	detach(): void {
		this.endDrag();
		this.attached = undefined;
		this.root.setVisible(false);
		this.shownKey = -1;
		this.applyVisibility();
	}

	/** Sets what a drag does: move the object, turn it or scale it. */
	setMode(mode: GizmoMode): void {
		this.mode = mode;
		this.applyVisibility();
	}

	/** Sets the axes that a drag works along. */
	setSpace(space: GizmoSpace): void {
		this.space = space;
	}

	/** Sets the size of the handles on the screen. */
	setSize(size: number): void {
		this.size = size;
		this.placedSize = -1;
	}

	/**
	 * Reads the frame's input: a press on a handle begins a drag, and the pointer then moves, turns
	 * or scales the object. Call it once per frame in `onUpdate`. Returns true when it changed the
	 * object.
	 */
	update(dt: number): boolean {
		void dt;
		const object = this.attached;
		if (!object) return false;
		this.applyVisibility();
		const { input } = this;
		const { pointer } = input;
		let moved = false;
		if (this.grabbed !== null) {
			if (input.isDown('Mouse0')) {
				this.camera.screenToRay(pointer.x, pointer.y, this.ray);
				if (this.drag.move(this.ray.origin, this.ray.direction)) {
					this.apply(object);
					moved = true;
				}
			} else this.endDrag();
		} else if (this.enabled) {
			// A finger never hovers, so only a press asks where the handles are. A still pointer
			// keeps its hover, so that a still scene runs no raycast.
			const pressed = input.wasPressed('Mouse0');
			const changed = pressed || pointer.dx !== 0 || pointer.dy !== 0;
			if (changed && (pressed || !pointer.isTouch)) this.hovering = this.pick(pointer.x, pointer.y);
			if (pressed && this.hovering !== null) this.begin(object, pointer.x, pointer.y);
		} else this.hovering = null;
		this.highlight();
		this.place();
		return moved;
	}

	/** Removes the handles from the scene, and gives the camera back its own layers. */
	destroy(): void {
		this.detach();
		this.camera.setLayers(this.cameraLayers);
		for (const mesh of this.meshes) mesh.destroy();
		for (const mesh of this.geometries) mesh.destroy();
		for (const { material } of this.painted) material.destroy();
		this.pickMaterial.destroy();
		for (const mode of MODES) this.groups[mode].destroy();
		this.root.destroy();
	}

	/** Applies the drag's transform to the object. */
	private apply(object: Object3D): void {
		const { drag } = this;
		if (drag.mode === 'scale') {
			object.setScale(drag.scale[0] as number, drag.scale[1] as number, drag.scale[2] as number);
		} else object.setPose(drag.position, drag.rotation);
	}

	/** Reads the object's state and begins a drag at the pointer's ray. */
	private begin(object: Object3D, x: number, y: number): boolean {
		const { dragStart: start, drag, ray } = this;
		const parent = object.getParent();
		if (parent) {
			parent.getWorldMatrix(this.matrix);
			mat4.invert(this.parentInverse, this.matrix);
			parent.getWorldQuaternion(this.parentRotation);
		} else {
			mat4.identity(this.parentInverse);
			quat.identity(this.parentRotation);
		}
		object.getPosition(start.position);
		object.getRotation(start.rotation);
		object.getWorldPosition(start.worldPosition);
		object.getWorldQuaternion(start.worldRotation);
		// The object's own matrix over the parent's inverse gives its scale beside the parent.
		object.getWorldMatrix(this.matrix);
		mat4.multiply(this.matrix, this.parentInverse, this.matrix);
		mat4.decompose(this.phasePosition, this.phaseRotation, start.scale, this.matrix);
		vec3.copy(start.parentInverse, this.parentInverse);
		quat.copy(start.parentRotation, this.parentRotation);
		// The direction from the object toward the camera, and the camera's own backward axis, which
		// gives the plane that faces the screen.
		this.camera.getWorldQuaternion(this.cameraRotation);
		vec3.transformQuat(start.view, BACK, this.cameraRotation);
		if (this.camera.isOrthographic) vec3.copy(start.eye, start.view);
		else {
			this.camera.getWorldPosition(this.cameraPosition);
			vec3.sub(start.eye, this.cameraPosition, start.worldPosition);
			vec3.normalize(start.eye, start.eye);
		}
		this.camera.screenToRay(x, y, ray);
		vec3.copy(start.rayOrigin, ray.origin);
		vec3.copy(start.rayDirection, ray.direction);
		start.mode = this.mode;
		start.axis = this.hovering as GizmoAxis;
		start.space = this.space;
		drag.translationSnap = this.translationSnap;
		drag.rotationSnap = this.rotationSnap;
		drag.scaleSnap = this.scaleSnap;
		if (!drag.begin(start)) return false;
		this.grabbed = start.axis;
		this.hovering = null;
		return true;
	}

	/** Ends the drag, and lets the next frame hover again. */
	private endDrag(): void {
		this.drag.end();
		this.grabbed = null;
	}

	/** The axis of the handle under the canvas point, or null when none is. */
	private pick(x: number, y: number): GizmoAxis | null {
		this.camera.screenToRay(x, y, this.ray);
		const { hit } = this;
		if (!this.scene.raycast(this.ray.origin, this.ray.direction, this.pickOptions, hit))
			return null;
		// The pickers are meshes, so a hit on a batch is no handle of this gizmo.
		const object = hit.object as Object3D | null;
		return object ? (this.axes.get(object) ?? null) : null;
	}

	/** Shows the handles of the current mode alone, and hides the axes that the sketch hides. */
	private applyVisibility(): void {
		const key =
			(this.attached === undefined ? 0 : 8) |
			MODES.indexOf(this.mode) |
			(this.showX ? 0 : 16) |
			(this.showY ? 0 : 32) |
			(this.showZ ? 0 : 64);
		if (key === this.shownKey) return;
		this.shownKey = key;
		const all = this.showX && this.showY && this.showZ;
		for (const { object, mode, axis } of this.handles) {
			let shown = this.attached !== undefined && mode === this.mode;
			if (axis.indexOf('X') !== -1 && !this.showX) shown = false;
			if (axis.indexOf('Y') !== -1 && !this.showY) shown = false;
			if (axis.indexOf('Z') !== -1 && !this.showZ) shown = false;
			if (axis === 'E' && !all) shown = false;
			object.setVisible(shown);
		}
	}

	/** Paints the handle that the pointer is on, and the one that it drags, in the highlight color. */
	private highlight(): void {
		const active = this.grabbed ?? this.hovering;
		if (active === this.paintedAxis) return;
		this.paintedAxis = active;
		for (const { axis, material } of this.painted)
			material.set({ color: axis === active ? HIGHLIGHT : COLORS[axis] });
	}

	/** Places the handles on the object, and sizes them to the screen. */
	private place(): void {
		const object = this.attached;
		if (!object) return;
		const { drag } = this;
		if (drag.dragging) {
			// The drag's own pose: the engine's world getters still describe the previous frame.
			vec3.copy(this.worldPosition, drag.worldPosition);
			quat.copy(this.worldRotation, drag.worldRotation);
		} else {
			object.getWorldPosition(this.worldPosition);
			object.getWorldQuaternion(this.worldRotation);
		}
		this.camera.getWorldPosition(this.cameraPosition);
		this.camera.getWorldQuaternion(this.cameraRotation);
		const distance = vec3.distance(this.cameraPosition, this.worldPosition);
		// The size that keeps the handles the same share of the screen at any distance.
		const factor = this.camera.isOrthographic
			? this.camera.height
			: distance * Math.min(1.9 * Math.tan((this.camera.fov * Math.PI) / 360), 7);
		const size = (factor * this.size) / 4;
		const local = this.mode === 'scale' || this.space === 'local';
		this.root.setPose(this.worldPosition, local ? this.worldRotation : NO_TURN);
		if (Math.abs(size - this.placedSize) > Math.abs(this.placedSize) * 1e-4) {
			this.placedSize = size;
			this.root.setScale(size, size, size);
		}
		if (this.mode === 'rotate') this.faceCamera(local ? this.worldRotation : NO_TURN);
	}

	/** Turns the outer ring and its picker toward the camera. */
	private faceCamera(group: QuatLike): void {
		quat.invert(this.ringRotation, group);
		quat.multiply(this.ringRotation, this.ringRotation, this.cameraRotation);
		this.ring?.setPose(NO_MOVE, this.ringRotation);
		this.ringPicker?.setPose(NO_MOVE, this.ringRotation);
	}

	/** Makes the handles of the three modes, which one mode shows at a time. */
	private buildTranslate(): void {
		const group = this.groups.translate;
		const shaft = this.keep(
			this.geometry.cylinder({
				radiusTop: SHAFT_RADIUS,
				radiusBottom: SHAFT_RADIUS,
				height: SHAFT,
				radialSegments: 8,
			}),
		);
		const head = this.keep(
			this.geometry.cone({ radius: HEAD_RADIUS, height: HEAD_LENGTH, radialSegments: 12 }),
		);
		const pick = this.keep(
			this.geometry.box({ width: PICK_ARM_WIDTH, height: PICK_ARM, depth: PICK_ARM_WIDTH }),
		);
		for (let k = 0; k < 3; k++) {
			const { axis, unit } = AXES[k] as (typeof AXES)[number];
			const turn = ALONG[k] as Quat;
			const paint = this.paint(axis);
			this.add(group, 'translate', axis, shaft, paint, along(unit, SHAFT / 2), turn, true);
			this.add(
				group,
				'translate',
				axis,
				head,
				paint,
				along(unit, SHAFT + HEAD_LENGTH / 2),
				turn,
				true,
			);
			this.add(
				group,
				'translate',
				axis,
				pick,
				this.pickMaterial,
				along(unit, PICK_ARM_CENTER),
				turn,
				false,
			);
		}
		for (const { axis, size, at } of PLANE_HANDLES) {
			const tile = this.keep(
				this.geometry.box({
					width: size[0] as number,
					height: size[1] as number,
					depth: size[2] as number,
				}),
			);
			this.add(group, 'translate', axis, tile, this.paint(axis), at, undefined, true);
		}
		for (const { axis, size, at } of PLANE_PICKERS) {
			const tile = this.keep(
				this.geometry.box({
					width: size[0] as number,
					height: size[1] as number,
					depth: size[2] as number,
				}),
			);
			this.add(group, 'translate', axis, tile, this.pickMaterial, at, undefined, false);
		}
		const cube = this.keep(this.geometry.box({ width: CENTER, height: CENTER, depth: CENTER }));
		const pickCenter = this.keep(
			this.geometry.box({ width: PICK_CENTER, height: PICK_CENTER, depth: PICK_CENTER }),
		);
		this.add(group, 'translate', 'XYZ', cube, this.paint('XYZ'), NO_MOVE, undefined, true);
		this.add(group, 'translate', 'XYZ', pickCenter, this.pickMaterial, NO_MOVE, undefined, false);
	}

	private buildRotate(): void {
		const group = this.groups.rotate;
		const ring = this.keep(
			this.geometry.torus({
				radius: RING,
				tube: RING_TUBE,
				radialSegments: 6,
				tubularSegments: 48,
			}),
		);
		const pick = this.keep(
			this.geometry.torus({
				radius: RING,
				tube: PICK_RING_TUBE,
				radialSegments: 6,
				tubularSegments: 32,
			}),
		);
		for (let k = 0; k < 3; k++) {
			const { axis } = AXES[k] as (typeof AXES)[number];
			const turn = RING_ALONG[k] as Quat;
			this.add(group, 'rotate', axis, ring, this.paint(axis), NO_MOVE, turn, true);
			this.add(group, 'rotate', axis, pick, this.pickMaterial, NO_MOVE, turn, false);
		}
		const outer = this.keep(
			this.geometry.torus({
				radius: OUTER_RING,
				tube: OUTER_TUBE,
				radialSegments: 6,
				tubularSegments: 64,
			}),
		);
		const outerPick = this.keep(
			this.geometry.torus({
				radius: OUTER_RING,
				tube: PICK_RING_TUBE,
				radialSegments: 6,
				tubularSegments: 32,
			}),
		);
		this.ring = this.add(group, 'rotate', 'E', outer, this.paint('E'), NO_MOVE, NO_TURN, true);
		this.ringPicker = this.add(
			group,
			'rotate',
			'E',
			outerPick,
			this.pickMaterial,
			NO_MOVE,
			NO_TURN,
			false,
		);
	}

	private buildScale(): void {
		const group = this.groups.scale;
		const shaft = this.keep(
			this.geometry.cylinder({
				radiusTop: SHAFT_RADIUS,
				radiusBottom: SHAFT_RADIUS,
				height: SHAFT,
				radialSegments: 8,
			}),
		);
		const cube = this.keep(this.geometry.box({ width: CUBE, height: CUBE, depth: CUBE }));
		const pick = this.keep(
			this.geometry.box({ width: PICK_ARM_WIDTH, height: PICK_ARM, depth: PICK_ARM_WIDTH }),
		);
		for (let k = 0; k < 3; k++) {
			const { axis, unit } = AXES[k] as (typeof AXES)[number];
			const turn = ALONG[k] as Quat;
			const paint = this.paint(axis);
			this.add(group, 'scale', axis, shaft, paint, along(unit, SHAFT / 2), turn, true);
			this.add(group, 'scale', axis, cube, paint, along(unit, SHAFT + CUBE / 2), turn, true);
			this.add(
				group,
				'scale',
				axis,
				pick,
				this.pickMaterial,
				along(unit, PICK_ARM_CENTER),
				turn,
				false,
			);
		}
		const center = this.keep(
			this.geometry.box({ width: CENTER * 1.4, height: CENTER * 1.4, depth: CENTER * 1.4 }),
		);
		const pickCenter = this.keep(
			this.geometry.box({ width: PICK_CENTER, height: PICK_CENTER, depth: PICK_CENTER }),
		);
		this.add(group, 'scale', 'XYZ', center, this.paint('XYZ'), NO_MOVE, undefined, true);
		this.add(group, 'scale', 'XYZ', pickCenter, this.pickMaterial, NO_MOVE, undefined, false);
	}

	/** Adds one handle, or its picker, to a mode's group. */
	private add(
		parent: Object3D,
		mode: GizmoMode,
		axis: GizmoAxis,
		mesh: MeshGeometry,
		material: Material,
		position: Vec3,
		rotation: Quat | undefined,
		drawn: boolean,
	): Object3D {
		const object = this.scene.createMesh({
			name: `${mode} ${axis}`,
			mesh,
			material,
			parent,
			layers: drawn ? this.layers : this.pickLayers,
			position,
			...(rotation ? { rotation } : {}),
		});
		if (drawn) object.setRenderOrder(RENDER_ORDER);
		this.meshes.push(object);
		this.axes.set(object, axis);
		this.handles.push({ object, mode, axis });
		return object;
	}

	/** The material of one handle, which draws over the scene whatever lies in front of it. */
	private paint(axis: GizmoAxis): Material {
		const shared = this.paints.get(axis);
		if (shared) return shared;
		const material = this.materials.unlit({
			color: COLORS[axis],
			alphaMode: 'blend',
			depthTest: false,
			depthWrite: false,
		});
		this.paints.set(axis, material);
		this.painted.push({ axis, material });
		return material;
	}

	/** Keeps a mesh that the handles share, so that `destroy` frees it. */
	private keep(mesh: MeshGeometry): MeshGeometry {
		this.geometries.push(mesh);
		return mesh;
	}
}

/**
 * Creates translate, rotate and scale gizmos for one object, which three.js calls
 * `TransformControls`. `attach` picks the object, `setMode` picks what a drag does, and
 * `controls.update(dt)` reads the input once per frame in `onUpdate`. A press on a handle begins
 * the drag, and `controls.dragging` is true until the pointer comes up, so a sketch can leave its
 * camera controls alone meanwhile.
 *
 * @category api/controls
 */
export function createTransformControls(
	context: SketchContext,
	camera: PerspectiveCamera | OrthographicCamera,
	options: TransformControlsOptions = {},
): TransformControls {
	return new TransformControls(context, camera, options);
}
