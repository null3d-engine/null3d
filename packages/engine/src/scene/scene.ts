// The scene API: objects with transforms, cameras, lights and instance batches. Setters write
// straight into engine memory. Structural changes (create, destroy, reparent, visibility, layers)
// go into the command ring as 16-byte records, which the engine applies when the next frame
// starts.

import {
	checkLayers,
	checkLive,
	checkNumber,
	checkVector,
	DEV,
	type Described,
} from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import { fromEuler as quaternionFromEuler } from '../math/quat';
import type { EulerOrder } from '../math/types';
import { type ColorInput, linearColor } from './color';
import type { CoreMemory } from './memory';
import type { Material, MeshGeometry } from './resources';
import { quaternionLookAt } from './rotation';
import { UnmarkedWrites } from './unmarked-writes';

/**
 * A vector (x, y, z).
 *
 * @category api/objects
 */
export type Vec3 = readonly [number, number, number];
/**
 * A rotation as a quaternion (x, y, z, w).
 *
 * @category api/objects
 */
export type Quat = readonly [number, number, number, number];

const SLOT_MASK = (1 << C.HANDLE_SLOT_BITS) - 1;

/**
 * Options every node takes when it is created.
 *
 * @category api/scene
 */
export interface NodeOptions {
	/** A name for error messages. */
	name?: string;
	/** The position relative to the parent. The default is (0, 0, 0). */
	position?: Vec3;
	/** The rotation relative to the parent, as a quaternion (x, y, z, w). The default is none. */
	rotation?: Quat;
	/** The scale on each axis. The default is (1, 1, 1). */
	scale?: Vec3;
	/** The node to attach this one to. The default, null, makes a root node. */
	parent?: Object3D | null;
	/**
	 * True recomputes the node every frame without checks. A static node, the default for all but
	 * cameras, updates only when it changes.
	 */
	dynamic?: boolean;
	/**
	 * The layers the node is on, as a 32-bit mask: bit n puts it on layer n. A camera draws the
	 * objects that share a layer with it. The default, 1, is layer 0.
	 */
	layers?: number;
}

/**
 * Options for `scene.createMesh`.
 *
 * @category api/scene
 */
export interface MeshOptions extends NodeOptions {
	/** The shape to draw, from `ctx.geometry`. */
	mesh: MeshGeometry;
	/** How the surface looks, from `ctx.materials`. */
	material: Material;
}

/**
 * Options for `scene.createPerspectiveCamera`.
 *
 * @category api/cameras
 */
export interface CameraOptions extends NodeOptions {
	/** The vertical field of view in degrees. The default is 50. */
	fov?: number;
	/** The distance to the near clipping plane. The default is 0.1. */
	near?: number;
	/** The distance to the far clipping plane. The default is 2000. */
	far?: number;
	/** A point the camera turns toward. */
	target?: Vec3;
}

/**
 * Options for `scene.createInstances`.
 *
 * @category api/scene
 */
export interface InstanceOptions {
	/** The material of every row. */
	material: Material;
	/** Every row updates and uploads every frame; a static batch updates rows marked dirty only. */
	dynamic?: boolean;
	/** Adds a color per row (RGBA, linear). This version stores the colors but does not draw them yet. */
	colors?: boolean;
	/** The layers every row is on, as a 32-bit mask. The default, 1, is layer 0. */
	layers?: number;
}

/**
 * Options every light takes.
 *
 * @category api/lights
 */
export interface LightOptions {
	/** The light's color. The default is white. */
	color?: ColorInput;
	/** A factor that scales the color. The default is 1. */
	intensity?: number;
}

/**
 * Options for `scene.createDirectionalLight`.
 *
 * @category api/lights
 */
export interface DirectionalLightOptions extends LightOptions {
	/** The direction the light travels. The default, (0, -1, 0), points straight down. */
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

/**
 * A node in the scene: position, rotation and scale, a parent, visibility.
 *
 * @category api/objects
 */
export class Object3D implements Described {
	/** @internal */
	destroyedFrame = -1;

	constructor(
		/** @internal */ protected readonly scene: Scene,
		/** @internal */ readonly handle: number,
		/** The name from the create options, or an empty string. */
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

	/** The object's name and slot, as error messages show them. */
	describe(): string {
		return `${this.name ? `"${this.name}"` : 'an object'} (slot ${this.slot})`;
	}

	/** Sets the position relative to the parent. */
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

	/** Sets the scale on each axis. */
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

	/**
	 * Puts the object on the layers of a 32-bit mask: bit n puts it on layer n, so `1 << 2` is
	 * layer 2 and `0b101` is layers 0 and 2. A camera draws the object only when their masks share
	 * a layer. The object's children keep their own layers. A new mask needs no rebuild.
	 */
	setLayers(mask: number): void {
		if (DEV) {
			checkLive('setLayers', this);
			checkLayers('setLayers', mask, this);
		}
		this.scene.command(C.COMMAND_SET_LAYERS, this.handle, mask >>> 0, 0, 'setLayers');
	}

	/** Makes the object dynamic or static from the next frame. See `NodeOptions.dynamic`. */
	setDynamic(dynamic: boolean): void {
		if (DEV) {
			checkLive('setDynamic', this);
			this.scene.unmarkedWrites?.watch(this, !dynamic);
		}
		this.scene.command(C.COMMAND_SET_DYNAMIC, this.handle, dynamic ? 1 : 0, 0, 'setDynamic');
	}

	/** Removes the object at the next frame. Its children become roots. */
	destroy(): void {
		if (DEV) {
			checkLive('destroy', this);
			this.scene.unmarkedWrites?.watch(this, false);
		}
		this.scene.command(C.COMMAND_DESTROY, this.handle, 0, 0, 'destroy');
		this.destroyedFrame = this.scene.frame;
	}
}

/**
 * An empty node, for hierarchy.
 *
 * @category api/objects
 */
export class Group extends Object3D {}

/**
 * A drawn object: a mesh and a material.
 *
 * @category api/objects
 */
export class Mesh extends Object3D {
	/** Changes the material from the next frame. */
	setMaterial(material: Material): void {
		this.scene.command(C.COMMAND_SET_MATERIAL, this.handle, material.id, 0, 'setMaterial');
	}
}

/**
 * A perspective camera. Make it the scene's view with `scene.setActiveCamera`.
 *
 * @category api/cameras
 */
export class Camera extends Object3D {
	/** @internal */
	fov = 50;
	/** @internal */
	near = 0.1;
	/** @internal */
	far = 2000;
	/** @internal The layers of the objects the camera draws. */
	layers: number = C.LAYERS_DEFAULT;

	protected override get looksDownMinusZ(): boolean {
		return true;
	}

	/**
	 * Sets the layers the camera draws, as a 32-bit mask: it draws the objects whose masks share a
	 * layer with it. The default, 1, draws layer 0, where every object starts.
	 */
	override setLayers(mask: number): void {
		super.setLayers(mask);
		this.layers = mask >>> 0;
		this.scene.lensChanged(this);
	}

	/** Sets the vertical field of view in degrees. */
	setFov(degrees: number): void {
		if (DEV) checkNumber('setFov', 'fov', degrees, this);
		this.fov = degrees;
		this.scene.lensChanged(this);
	}

	/** Sets the distances to the near and far clipping planes. */
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

/**
 * Light arriving from one direction, like sunlight. Its direction and intensity setters allocate
 * nothing.
 *
 * @category api/lights
 */
export class DirectionalLight {
	private readonly direction = new Float64Array(3);
	/** The color in linear RGB, before the intensity scales it. */
	private readonly linear = new Float64Array(3);

	constructor(
		private readonly scene: Scene,
		direction: readonly [number, number, number],
		color: ColorInput,
		private intensity: number,
	) {
		this.direction.set(direction);
		this.linear.set(linearColor(color, 'createDirectionalLight'));
		this.apply();
	}

	private apply(): void {
		const d = this.direction;
		const c = this.linear;
		const k = this.intensity;
		this.scene.core.glue.setSun(
			d[0] as number,
			d[1] as number,
			d[2] as number,
			(c[0] as number) * k,
			(c[1] as number) * k,
			(c[2] as number) * k,
		);
	}

	/** Sets the direction the light travels. */
	setDirection(x: number, y: number, z: number): void {
		const d = this.direction;
		d[0] = x;
		d[1] = y;
		d[2] = z;
		this.apply();
	}

	/** Sets the color. Converting a color allocates, so per-frame code sets the intensity instead. */
	setColor(color: ColorInput): void {
		this.linear.set(linearColor(color, 'setColor'));
		this.apply();
	}

	/** Sets the factor that scales the color. */
	setIntensity(intensity: number): void {
		this.intensity = intensity;
		this.apply();
	}
}

/**
 * Light that reaches every surface equally. Its intensity setter allocates nothing.
 *
 * @category api/lights
 */
export class AmbientLight {
	/** The color in linear RGB, before the intensity scales it. */
	private readonly linear = new Float64Array(3);

	constructor(
		private readonly scene: Scene,
		color: ColorInput,
		private intensity: number,
	) {
		this.linear.set(linearColor(color, 'createAmbientLight'));
		this.apply();
	}

	private apply(): void {
		const c = this.linear;
		const k = this.intensity;
		this.scene.core.glue.setAmbient(
			(c[0] as number) * k,
			(c[1] as number) * k,
			(c[2] as number) * k,
		);
	}

	/** Sets the color. Converting a color allocates, so per-frame code sets the intensity instead. */
	setColor(color: ColorInput): void {
		this.linear.set(linearColor(color, 'setColor'));
		this.apply();
	}

	/** Sets the factor that scales the color. */
	setIntensity(intensity: number): void {
		this.intensity = intensity;
		this.apply();
	}
}

/**
 * Many copies of one mesh and material. Write rows straight into the typed arrays; a dynamic batch
 * updates every row every frame, and a static batch updates the rows you mark dirty.
 *
 * @category api/scene
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

	/**
	 * The row arrays, made again after the engine's memory grew. Sketches read rows every frame, so
	 * this check creates no closure: one would allocate on each call until the browser optimizes
	 * the code.
	 */
	private views(): InstanceBatch['rows'] {
		if (this.generation !== this.scene.core.generation) this.makeViews();
		return this.rows;
	}

	private makeViews(): void {
		const { core } = this.scene;
		const address = (field: number) =>
			core.check(core.glue.batchArrays(this.id, field), 'instance arrays');
		this.rows = {
			positions: core.f32(address(C.BATCH_FIELD_POSITIONS), this.count * 3),
			rotations: core.f32(address(C.BATCH_FIELD_ROTATIONS), this.count * 4),
			scales: core.f32(address(C.BATCH_FIELD_SCALES), this.count * 3),
			colors: this.hasColors ? core.f32(address(C.BATCH_FIELD_COLORS), this.count * 4) : undefined,
		};
		this.generation = core.generation;
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

	/**
	 * Linear RGBA colors, 4 floats per row, when the batch was created with colors. This version
	 * stores them but does not draw them yet.
	 */
	get colors(): Float32Array | undefined {
		return this.views().colors;
	}

	/** Draws only the first `count` rows. */
	setActiveCount(count: number): void {
		const { core } = this.scene;
		core.check(core.glue.setBatchActiveCount(this.id, count), 'setActiveCount', undefined, true);
	}

	/**
	 * Puts every row on the layers of a 32-bit mask, as `Object3D.setLayers` does for one object. A
	 * new mask needs no rebuild.
	 */
	setLayers(mask: number): void {
		if (DEV) checkLayers('setLayers', mask);
		const { core } = this.scene;
		core.check(core.glue.setBatchLayers(this.id, mask >>> 0), 'setLayers', undefined, true);
	}

	/** Marks rows of a static batch to update and upload. */
	markDirty(start = 0, count = this.count - start): void {
		const { core } = this.scene;
		core.check(core.glue.markBatchDirty(this.id, start, count), 'markDirty', undefined, true);
	}

	/** Removes the batch and frees its rows. Its typed arrays are not valid after this. */
	destroy(): void {
		const { core } = this.scene;
		core.check(core.glue.destroyBatch(this.id, this.scene.frame), 'destroy', undefined, true);
		if (DEV) this.scene.countBatchRows(-this.count);
		this.destroyedFrame = this.scene.frame;
		this.scene.core.refresh();
	}
}

/**
 * The scene: every object, the active camera, the lights and the background.
 *
 * @category api/scene
 */
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
	/** A world matrix, whose translation keeps 64-bit precision far from the origin. */
	private readonly matrix = new Float64Array(C.CORE_MATRIX_FLOATS);
	/** Rows of the live instance batches, which development builds count. */
	private batchRows = 0;
	private warnedPastPortable = false;
	/**
	 * @internal Development builds: finds static objects whose transform changed without a setter.
	 * Declared without a value, so release builds hold no trace of it.
	 */
	declare readonly unmarkedWrites: UnmarkedWrites | undefined;

	constructor(
		/** @internal */ readonly core: CoreMemory,
		private readonly time: { readonly frame: number },
	) {
		if (DEV) this.unmarkedWrites = new UnmarkedWrites(this);
	}

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
	worldMatrix(object: Object3D, call: string): Float64Array {
		this.core.check(
			this.core.glue.worldMatrix(object.handle, this.matrix),
			call,
			object.describe(),
			true,
		);
		return this.matrix;
	}

	/**
	 * @internal Counts the rows of batches as they are created and destroyed, and warns once when
	 * the scene passes the limit that every WebGPU device draws. WebGL2 devices with small textures
	 * draw fewer, and no warning covers them.
	 */
	countBatchRows(change: number): void {
		this.batchRows += change;
		if (this.warnedPastPortable) return;
		// The core counts every scene slot, used or not, toward the limit.
		const sources = this.core.glue.sceneCapacity() + 1 + this.batchRows;
		if (sources <= C.LIMIT_PORTABLE_MAX_SOURCES) return;
		this.warnedPastPortable = true;
		const count = (n: number) => n.toLocaleString('en-US');
		console.warn(
			`null3D: this scene counts ${count(sources)} objects and instance rows toward the GPU's limit. This device draws them, but devices with WebGPU's default limits draw at most ${count(C.LIMIT_PORTABLE_MAX_SOURCES)} and fail with E1501. engine.capabilities.maxInstances gives the limit of each device.`,
		);
	}

	/** @internal */
	lensChanged(camera: Camera): void {
		if (camera === this.activeCamera)
			this.core.glue.setCamera(camera.handle, camera.fov, camera.near, camera.far, camera.layers);
	}

	private create<T extends Object3D>(
		Kind: new (scene: Scene, handle: number, name: string) => T,
		options: NodeOptions,
		mesh: number,
		radius: number,
		call: string,
	): T {
		const { layers } = options;
		if (DEV && layers !== undefined) checkLayers(call, layers);
		const handle = this.core.check(this.core.glue.reserveObject(), call, options.name);
		const slot = handle & SLOT_MASK;
		const v = this.views;
		v.positions.set(options.position ?? [0, 0, 0], slot * 3);
		v.rotations.set(options.rotation ?? [0, 0, 0, 1], slot * 4);
		v.scales.set(options.scale ?? [1, 1, 1], slot * 3);
		v.radii[slot] = radius;
		const flags = C.FLAG_VISIBLE | (options.dynamic ? C.FLAG_DYNAMIC : 0);
		this.command(C.COMMAND_CREATE | (flags << 8), handle, options.parent?.handle ?? 0, mesh, call);
		if (layers !== undefined && layers >>> 0 !== C.LAYERS_DEFAULT)
			this.command(C.COMMAND_SET_LAYERS, handle, layers >>> 0, 0, call);
		const object = new Kind(this, handle, options.name ?? '');
		if (DEV) this.unmarkedWrites?.watch(object, !options.dynamic);
		return object;
	}

	/** An empty node, for hierarchy. */
	createGroup(options: NodeOptions = {}): Group {
		return this.create(Group, options, C.CORE_NO_MESH, 0, 'createGroup');
	}

	/** A drawn object. It is static unless `dynamic: true`. */
	createMesh(options: MeshOptions): Mesh {
		const mesh = this.create(Mesh, options, options.mesh.id, options.mesh.radius, 'createMesh');
		this.command(C.COMMAND_SET_MATERIAL, mesh.handle, options.material.id, 0, 'createMesh');
		return mesh;
	}

	/** Many copies of one mesh and material, with typed arrays of rows. */
	createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch {
		const { core } = this;
		const { layers } = options;
		if (DEV && layers !== undefined) checkLayers('createInstances', layers);
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
		if (DEV) this.countBatchRows(count);
		const batch = new InstanceBatch(this, id, count, options.colors ?? false);
		batch.setActiveCount(count);
		if (layers !== undefined) batch.setLayers(layers);
		return batch;
	}

	/** A perspective camera; `fov` is vertical, in degrees. Cameras are dynamic by default. */
	createPerspectiveCamera(options: CameraOptions = {}): Camera {
		const camera = this.create(
			Camera,
			{ dynamic: true, ...options },
			C.CORE_NO_MESH,
			0,
			'createPerspectiveCamera',
		);
		camera.layers = (options.layers ?? C.LAYERS_DEFAULT) >>> 0;
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
