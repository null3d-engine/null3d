// The scene API: objects with transforms, cameras, lights and instance batches. Setters write
// straight into engine memory; structural changes (create, destroy, reparent, visibility) go into
// the command ring as 16-byte records, which the engine applies when the next frame starts.

import { checkLive, checkNumber, checkVector, DEV, type Described } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import { type ColorInput, linearColor } from './color';
import type { CoreMemory } from './memory';
import type { Material, MeshGeometry } from './resources';
import { type EulerOrder, quaternionFromEuler, quaternionLookAt } from './rotation';

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

const SLOT_MASK = (1 << C.HANDLE_SLOT_BITS) - 1;

/** Options every node takes when it is created. */
export interface NodeOptions {
	name?: string;
	position?: Vec3;
	/** A quaternion (x, y, z, w). */
	rotation?: Quat;
	scale?: Vec3;
	parent?: Object3D | null;
	/** Recomputed every frame without checks; static objects update only when they change. */
	dynamic?: boolean;
}

export interface MeshOptions extends NodeOptions {
	mesh: MeshGeometry;
	material: Material;
}

export interface CameraOptions extends NodeOptions {
	/** Vertical field of view in degrees. */
	fov?: number;
	near?: number;
	far?: number;
	/** A point the camera turns toward. */
	target?: Vec3;
}

export interface InstanceOptions {
	material: Material;
	/** Every row updates and uploads every frame; a static batch updates rows marked dirty only. */
	dynamic?: boolean;
	/** Adds a color per row (RGBA, linear). */
	colors?: boolean;
}

export interface LightOptions {
	color?: ColorInput;
	intensity?: number;
}

export interface DirectionalLightOptions extends LightOptions {
	/** The direction the light travels. */
	direction?: Vec3;
}

/** Views of the per-slot arrays and the command ring. */
class SceneViews {
	readonly positions: Float32Array;
	readonly rotations: Float32Array;
	readonly scales: Float32Array;
	readonly radii: Float32Array;
	readonly dirty: Uint32Array;
	readonly records: Uint32Array;
	readonly writeIndex: Uint32Array;
	readonly readIndex: Uint32Array;
	readonly ringCapacity: number;

	constructor(core: CoreMemory) {
		const { glue } = core;
		const rows = glue.sceneCapacity() + 1;
		this.positions = core.f32(glue.sceneArrays(C.SCENE_FIELD_POSITIONS), rows * 3);
		this.rotations = core.f32(glue.sceneArrays(C.SCENE_FIELD_ROTATIONS), rows * 4);
		this.scales = core.f32(glue.sceneArrays(C.SCENE_FIELD_SCALES), rows * 3);
		this.radii = core.f32(glue.sceneArrays(C.SCENE_FIELD_LOCAL_RADII), rows);
		this.dirty = core.u32(glue.sceneArrays(C.SCENE_FIELD_DIRTY_WORDS), Math.ceil(rows / 32));
		this.ringCapacity = glue.commandRing(C.RING_FIELD_CAPACITY);
		this.records = core.u32(
			glue.commandRing(C.RING_FIELD_RECORDS),
			this.ringCapacity * C.COMMAND_WORDS,
		);
		this.writeIndex = core.u32(glue.commandRing(C.RING_FIELD_WRITE_INDEX), 1);
		this.readIndex = core.u32(glue.commandRing(C.RING_FIELD_READ_INDEX), 1);
	}
}

/** A node in the scene: position, rotation and scale, a parent, visibility. */
export class Object3D implements Described {
	/** @internal */
	destroyedFrame = -1;

	constructor(
		/** @internal */ protected readonly scene: Scene,
		/** @internal */ readonly handle: number,
		readonly name: string,
	) {}

	/** @internal */
	get slot(): number {
		return this.handle & SLOT_MASK;
	}

	/** @internal Cameras and lights point their -Z axis where they look; other objects +Z. */
	protected get looksDownMinusZ(): boolean {
		return false;
	}

	describe(): string {
		return `${this.name ? `"${this.name}"` : 'an object'} (slot ${this.slot})`;
	}

	setPosition(x: number, y: number, z: number): void {
		if (DEV) {
			checkLive('setPosition', this);
			checkVector('setPosition', this, x, y, z);
		}
		const p = this.scene.views.positions;
		const i = this.slot * 3;
		p[i] = x;
		p[i + 1] = y;
		p[i + 2] = z;
		this.scene.markDirty(this.slot);
	}

	/** Sets the rotation as a quaternion (x, y, z, w). */
	setRotation(x: number, y: number, z: number, w: number): void {
		if (DEV) {
			checkLive('setRotation', this);
			checkVector('setRotation', this, x, y, z, w);
		}
		const r = this.scene.views.rotations;
		const i = this.slot * 4;
		r[i] = x;
		r[i + 1] = y;
		r[i + 2] = z;
		r[i + 3] = w;
		this.scene.markDirty(this.slot);
	}

	/** Sets the rotation from Euler angles in radians, with three.js's axis order names. */
	setRotationEuler(x: number, y: number, z: number, order: EulerOrder = 'XYZ'): void {
		if (DEV) {
			checkLive('setRotationEuler', this);
			checkVector('setRotationEuler', this, x, y, z);
		}
		const r = this.scene.views.rotations;
		const i = this.slot * 4;
		quaternionFromEuler(this.scene.scratch, x, y, z, order);
		r.set(this.scene.scratch, i);
		this.scene.markDirty(this.slot);
	}

	setScale(x: number, y: number, z: number): void {
		if (DEV) {
			checkLive('setScale', this);
			checkVector('setScale', this, x, y, z);
		}
		const s = this.scene.views.scales;
		const i = this.slot * 3;
		s[i] = x;
		s[i + 1] = y;
		s[i + 2] = z;
		this.scene.markDirty(this.slot);
	}

	/** Turns the object toward a point. It assumes the object's parents are not rotated. */
	lookAt(x: number, y: number, z: number): void {
		if (DEV) {
			checkLive('lookAt', this);
			checkVector('lookAt', this, x, y, z);
		}
		const { positions, rotations } = this.scene.views;
		const i = this.slot * 3;
		const eye = this.scene.eye;
		eye[0] = positions[i] as number;
		eye[1] = positions[i + 1] as number;
		eye[2] = positions[i + 2] as number;
		const target = this.scene.target;
		target[0] = x;
		target[1] = y;
		target[2] = z;
		quaternionLookAt(this.scene.scratch, eye, target, this.looksDownMinusZ);
		rotations.set(this.scene.scratch, this.slot * 4);
		this.scene.markDirty(this.slot);
	}

	/** Copies the position into `out`. */
	getPosition(out: { [index: number]: number }): void {
		const p = this.scene.views.positions;
		const i = this.slot * 3;
		out[0] = p[i] as number;
		out[1] = p[i + 1] as number;
		out[2] = p[i + 2] as number;
	}

	/** Copies the world position of the frame that last ran into `out`. */
	getWorldPosition(out: { [index: number]: number }): void {
		const m = this.scene.worldMatrix(this, 'getWorldPosition');
		out[0] = m[3] as number;
		out[1] = m[7] as number;
		out[2] = m[11] as number;
	}

	/** Moves the object under another, or to the root with null. It keeps its local transform. */
	setParent(parent: Object3D | null): void {
		if (DEV) checkLive('setParent', this);
		this.scene.command(C.COMMAND_SET_PARENT, this.handle, parent?.handle ?? 0, 0, 'setParent');
	}

	/** Hides or shows the object and everything under it. */
	setVisible(visible: boolean): void {
		if (DEV) checkLive('setVisible', this);
		this.scene.command(C.COMMAND_SET_VISIBLE, this.handle, visible ? 1 : 0, 0, 'setVisible');
	}

	setDynamic(dynamic: boolean): void {
		if (DEV) checkLive('setDynamic', this);
		this.scene.command(C.COMMAND_SET_DYNAMIC, this.handle, dynamic ? 1 : 0, 0, 'setDynamic');
	}

	/** Removes the object at the next frame. Its children become roots. */
	destroy(): void {
		if (DEV) checkLive('destroy', this);
		this.scene.command(C.COMMAND_DESTROY, this.handle, 0, 0, 'destroy');
		this.destroyedFrame = this.scene.frame;
	}
}

/** An empty node, for hierarchy. */
export class Group extends Object3D {}

/** A drawn object: a mesh and a material. */
export class Mesh extends Object3D {
	setMaterial(material: Material): void {
		this.scene.command(C.COMMAND_SET_MATERIAL, this.handle, material.id, 0, 'setMaterial');
	}
}

/** A perspective camera. Make it the scene's view with `scene.setActiveCamera`. */
export class Camera extends Object3D {
	/** @internal */
	fov = 50;
	/** @internal */
	near = 0.1;
	/** @internal */
	far = 2000;

	protected override get looksDownMinusZ(): boolean {
		return true;
	}

	/** Sets the vertical field of view in degrees. */
	setFov(degrees: number): void {
		if (DEV) checkNumber('setFov', 'fov', degrees, this);
		this.fov = degrees;
		this.scene.lensChanged(this);
	}

	setNearFar(near: number, far: number): void {
		if (DEV) {
			checkNumber('setNearFar', 'near', near, this);
			checkNumber('setNearFar', 'far', far, this);
		}
		this.near = near;
		this.far = far;
		this.scene.lensChanged(this);
	}
}

/** Light arriving from one direction, like sunlight. */
export class DirectionalLight {
	constructor(
		private readonly scene: Scene,
		private direction: [number, number, number],
		private color: ColorInput,
		private intensity: number,
	) {
		this.apply();
	}

	private apply(): void {
		const [r, g, b] = linearColor(this.color, 'createDirectionalLight', this.intensity);
		const [x, y, z] = this.direction;
		this.scene.core.glue.setSun(x, y, z, r, g, b);
	}

	/** Sets the direction the light travels. */
	setDirection(x: number, y: number, z: number): void {
		this.direction = [x, y, z];
		this.apply();
	}

	setColor(color: ColorInput): void {
		this.color = color;
		this.apply();
	}

	setIntensity(intensity: number): void {
		this.intensity = intensity;
		this.apply();
	}
}

/** Light that reaches every surface equally. */
export class AmbientLight {
	constructor(
		private readonly scene: Scene,
		private color: ColorInput,
		private intensity: number,
	) {
		this.apply();
	}

	private apply(): void {
		const [r, g, b] = linearColor(this.color, 'createAmbientLight', this.intensity);
		this.scene.core.glue.setAmbient(r, g, b);
	}

	setColor(color: ColorInput): void {
		this.color = color;
		this.apply();
	}

	setIntensity(intensity: number): void {
		this.intensity = intensity;
		this.apply();
	}
}

/**
 * Many copies of one mesh and material. Write rows straight into the typed arrays; a dynamic batch
 * updates every row every frame, and a static batch updates the rows you mark dirty.
 */
export class InstanceBatch {
	private generation = -1;
	private rows!: {
		positions: Float32Array;
		rotations: Float32Array;
		scales: Float32Array;
		colors: Float32Array | undefined;
	};
	/** @internal */
	destroyedFrame = -1;

	constructor(
		private readonly scene: Scene,
		/** @internal */ readonly id: number,
		/** The number of rows: the batch's capacity. */
		readonly count: number,
		private readonly hasColors: boolean,
	) {}

	private views(): InstanceBatch['rows'] {
		const { core } = this.scene;
		if (this.generation !== core.generation) {
			const address = (field: number) =>
				core.check(core.glue.batchArrays(this.id, field), 'instance arrays');
			this.rows = {
				positions: core.f32(address(C.BATCH_FIELD_POSITIONS), this.count * 3),
				rotations: core.f32(address(C.BATCH_FIELD_ROTATIONS), this.count * 4),
				scales: core.f32(address(C.BATCH_FIELD_SCALES), this.count * 3),
				colors: this.hasColors
					? core.f32(address(C.BATCH_FIELD_COLORS), this.count * 4)
					: undefined,
			};
			this.generation = core.generation;
		}
		return this.rows;
	}

	/** Positions, 3 floats per row. */
	get positions(): Float32Array {
		return this.views().positions;
	}

	/** Rotations as quaternions (x, y, z, w), 4 floats per row. */
	get rotations(): Float32Array {
		return this.views().rotations;
	}

	/** Scales, 3 floats per row. */
	get scales(): Float32Array {
		return this.views().scales;
	}

	/** Linear RGBA colors, 4 floats per row, when the batch was created with colors. */
	get colors(): Float32Array | undefined {
		return this.views().colors;
	}

	/** Draws only the first `count` rows. */
	setActiveCount(count: number): void {
		const { core } = this.scene;
		core.check(core.glue.setBatchActiveCount(this.id, count), 'setActiveCount', undefined, true);
	}

	/** Marks rows of a static batch to update and upload. */
	markDirty(start = 0, count = this.count - start): void {
		const { core } = this.scene;
		core.check(core.glue.markBatchDirty(this.id, start, count), 'markDirty', undefined, true);
	}

	destroy(): void {
		const { core } = this.scene;
		core.check(core.glue.destroyBatch(this.id, this.scene.frame), 'destroy', undefined, true);
		this.destroyedFrame = this.scene.frame;
		this.scene.core.refresh();
	}
}

/** The scene: every object, the active camera, the lights and the background. */
export class Scene {
	private viewsGeneration = -1;
	private currentViews!: SceneViews;
	private activeCamera: Camera | undefined;
	/** @internal Scratch arrays, so rotations and reads allocate nothing. */
	readonly scratch = new Float32Array(4);
	/** @internal */
	readonly eye = new Float64Array(3);
	/** @internal */
	readonly target = new Float64Array(3);
	private readonly matrix = new Float32Array(C.CORE_MATRIX_FLOATS);

	constructor(
		/** @internal */ readonly core: CoreMemory,
		private readonly time: { readonly frame: number },
	) {}

	/** @internal */
	get frame(): number {
		return this.time.frame;
	}

	/** @internal */
	get views(): SceneViews {
		if (this.viewsGeneration !== this.core.generation) {
			this.currentViews = new SceneViews(this.core);
			this.viewsGeneration = this.core.generation;
		}
		return this.currentViews;
	}

	/** @internal Flags a static object for recomputation. */
	markDirty(slot: number): void {
		const dirty = this.views.dirty;
		dirty[slot >>> 5] = (dirty[slot >>> 5] as number) | (1 << (slot & 31));
	}

	/** @internal Appends a command record for the next frame. */
	command(op: number, handle: number, a: number, b: number, call: string): void {
		const v = this.views;
		const write = Atomics.load(v.writeIndex, 0);
		const read = Atomics.load(v.readIndex, 0);
		if ((write - read) >>> 0 >= v.ringCapacity)
			throw new EngineError(
				'E1102',
				`${call}() failed: the command ring already holds ${v.ringCapacity} changes for the next frame.`,
			);
		const at = (write & (v.ringCapacity - 1)) * C.COMMAND_WORDS;
		v.records[at] = op;
		v.records[at + 1] = handle;
		v.records[at + 2] = a;
		v.records[at + 3] = b;
		Atomics.store(v.writeIndex, 0, (write + 1) >>> 0);
	}

	/** @internal */
	worldMatrix(object: Object3D, call: string): Float32Array {
		this.core.check(
			this.core.glue.worldMatrix(object.handle, this.matrix),
			call,
			object.describe(),
			true,
		);
		return this.matrix;
	}

	/** @internal */
	lensChanged(camera: Camera): void {
		if (camera === this.activeCamera)
			this.core.glue.setCamera(camera.handle, camera.fov, camera.near, camera.far);
	}

	private create(options: NodeOptions, mesh: number, radius: number, call: string): number {
		const handle = this.core.check(this.core.glue.reserveObject(), call, options.name);
		const slot = handle & SLOT_MASK;
		const v = this.views;
		v.positions.set(options.position ?? [0, 0, 0], slot * 3);
		v.rotations.set(options.rotation ?? [0, 0, 0, 1], slot * 4);
		v.scales.set(options.scale ?? [1, 1, 1], slot * 3);
		v.radii[slot] = radius;
		const flags = C.FLAG_VISIBLE | (options.dynamic ? C.FLAG_DYNAMIC : 0);
		this.command(C.COMMAND_CREATE | (flags << 8), handle, options.parent?.handle ?? 0, mesh, call);
		return handle;
	}

	/** An empty node, for hierarchy. */
	createGroup(options: NodeOptions = {}): Group {
		const handle = this.create(options, C.CORE_NO_MESH, 0, 'createGroup');
		return new Group(this, handle, options.name ?? '');
	}

	/** A drawn object. It is static unless `dynamic: true`. */
	createMesh(options: MeshOptions): Mesh {
		const handle = this.create(options, options.mesh.id, options.mesh.radius, 'createMesh');
		this.command(C.COMMAND_SET_MATERIAL, handle, options.material.id, 0, 'createMesh');
		return new Mesh(this, handle, options.name ?? '');
	}

	/** Many copies of one mesh and material, with typed arrays of rows. */
	createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch {
		const { core } = this;
		const id = core.check(
			core.glue.createBatch(
				count,
				options.dynamic ?? false,
				options.colors ?? false,
				mesh.id,
				options.material.id,
			),
			'createInstances',
		);
		core.refresh();
		const batch = new InstanceBatch(this, id, count, options.colors ?? false);
		batch.setActiveCount(count);
		return batch;
	}

	/** A perspective camera; `fov` is vertical, in degrees. Cameras are dynamic by default. */
	createPerspectiveCamera(options: CameraOptions = {}): Camera {
		const handle = this.create(
			{ dynamic: true, ...options },
			C.CORE_NO_MESH,
			0,
			'createPerspectiveCamera',
		);
		const camera = new Camera(this, handle, options.name ?? '');
		camera.fov = options.fov ?? 50;
		camera.near = options.near ?? 0.1;
		camera.far = options.far ?? 2000;
		if (options.target) camera.lookAt(...options.target);
		return camera;
	}

	/** Draws the scene from this camera. */
	setActiveCamera(camera: Camera): void {
		this.activeCamera = camera;
		this.lensChanged(camera);
	}

	/**
	 * Light from one direction. This version has one directional light: a newer one replaces the
	 * older.
	 */
	createDirectionalLight(options: DirectionalLightOptions = {}): DirectionalLight {
		const [x, y, z] = options.direction ?? [0, -1, 0];
		return new DirectionalLight(
			this,
			[x, y, z],
			options.color ?? '#ffffff',
			options.intensity ?? 1,
		);
	}

	/** Light on every surface. This version has one ambient light: a newer one replaces the older. */
	createAmbientLight(options: LightOptions = {}): AmbientLight {
		return new AmbientLight(this, options.color ?? '#ffffff', options.intensity ?? 1);
	}

	/** The color behind every object. */
	setBackground(color: ColorInput): void {
		const [r, g, b] = linearColor(color, 'setBackground');
		this.core.glue.setBackground(r, g, b);
	}
}
