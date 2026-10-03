// The scene API: objects with transforms, cameras, lights and instance batches. Setters write
// straight into engine memory. Structural changes (create, destroy, reparent, visibility, layers,
// flags) go into the command ring as 16-byte records, which the engine applies when the next frame
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
import { copy as copyMatrix, decompose } from '../math/mat4';
import {
	fromEuler as quaternionFromEuler,
	rotateX,
	rotateY,
	rotateZ,
	rotationTo,
} from '../math/quat';
import type { EulerOrder, Mat4Like, QuatLike, Vec3Like } from '../math/types';
import { transformQuat } from '../math/vec3';
import { rowLimitWarning } from '../page/limits';
import type { CoreGlue } from '../shared/core';
import { type ColorInput, linearColor } from './color';
import { type FogOptions, setSceneFog } from './fog';
import {
	checkFov,
	checkNearFar,
	checkOrthographicSize,
	checkSize,
	DEFAULT_FAR,
	DEFAULT_FOV,
	DEFAULT_NEAR,
	newCamera,
	type OrthographicView,
	orthographicView,
	setViewHeight,
} from './lens';
import type { CoreMemory } from './memory';
import {
	type OverlapHit,
	type QueryOptions,
	type RaycastBatchHits,
	type RaycastHit,
	type RaycastOptions,
	SceneQueries,
} from './queries';
import type { Material, MeshGeometry } from './resources';
import { quaternionLookAt } from './rotation';
import { Texture } from './textures';
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
	/**
	 * True makes the mesh cast the shadows of a directional light, like `setCastShadows(true)`. The
	 * default is false.
	 */
	castShadows?: boolean;
	/**
	 * True makes shadows fall on the mesh, like `setReceiveShadows(true)`. The default is false.
	 * Unlit materials show no shadows.
	 */
	receiveShadows?: boolean;
}

/**
 * Options for `setParent`.
 *
 * @category api/objects
 */
export interface ParentOptions {
	/**
	 * True keeps the object's place, rotation and size in the world, as three.js's `attach` does:
	 * the engine gives it the position, rotation and scale that do that under the new parent. The
	 * default, false, keeps the values relative to the parent, as three.js's `add` does.
	 */
	keepWorld?: boolean;
}

/**
 * An object class, which a scene creates with a handle, a name and any further arguments, such
 * as a camera's lens.
 */
type ObjectClass<T extends Object3D, A extends unknown[] = []> = new (
	scene: Scene,
	handle: number,
	name: string,
	...rest: A
) => T;

/** A function from the quaternion helpers that turns a rotation about one of its own axes. */
type Turn = (out: QuatLike, a: QuatLike, rad: number) => QuatLike;

/**
 * Options that both kinds of camera take.
 *
 * @category api/cameras
 */
export interface CameraOptions extends NodeOptions {
	/** The distance to the near clipping plane. The default is 0.1. */
	near?: number;
	/** The distance to the far clipping plane. The default is 2000. */
	far?: number;
	/** A point the camera turns toward. */
	target?: Vec3;
}

/**
 * Options for `scene.createPerspectiveCamera`.
 *
 * @category api/cameras
 */
export interface PerspectiveCameraOptions extends CameraOptions {
	/** The vertical field of view in degrees. The default is 50. */
	fov?: number;
}

/**
 * Options for `scene.createOrthographicCamera`. Give `height`, and the width follows the canvas's
 * aspect ratio. Or give all four edges, as three.js's `OrthographicCamera` takes them, for a view
 * that keeps its shape on any canvas.
 *
 * @category api/cameras
 */
export interface OrthographicCameraOptions extends CameraOptions {
	/** The view's height in world units. The default is 2. Leave it out when you give the edges. */
	height?: number;
	/** The view's left edge, in world units from the camera's axis. */
	left?: number;
	/** The view's right edge, in world units from the camera's axis. */
	right?: number;
	/** The view's top edge, in world units from the camera's axis. */
	top?: number;
	/** The view's bottom edge, in world units from the camera's axis. */
	bottom?: number;
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
 * Options every light takes, besides the options of every node.
 *
 * @category api/lights
 */
export interface LightOptions extends NodeOptions {
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
	/**
	 * The direction the light travels, relative to the parent. The default, (0, -1, 0), points
	 * straight down. It sets the light's rotation, so it wins over `rotation`.
	 */
	direction?: Vec3;
	/**
	 * True makes the light cast shadows, like `setCastShadows(true)`. The default is false. The
	 * first directional light created casts them.
	 */
	castShadows?: boolean;
	/** How the light's shadows draw, like `setShadow`. Each setting has a default. */
	shadow?: DirectionalShadowOptions;
}

/**
 * The shadows of a directional light. The camera's view splits into cascades by distance, and
 * each cascade has a shadow map of its own.
 *
 * @category api/lights
 */
export interface DirectionalShadowOptions {
	/**
	 * The cascades, a whole number from 1 to 4. More cascades keep shadows sharp further from the
	 * camera, and each draws the shadow casters once more. The default is the quality preset's
	 * `shadowCascades`.
	 */
	cascades?: number;
	/**
	 * Texels on each side of each cascade's shadow map: 256, 512, 1,024, 2,048 or 4,096. The default
	 * is the quality preset's `shadowMapSize`.
	 */
	mapSize?: number;
	/**
	 * How far each receiving surface moves toward the light before its shadow test, in meters, at
	 * least 0. One texel of the surface's cascade caps it. A surface takes this times the tangent of
	 * its angle to the light, up to twice it. Raise it when surfaces show stripes of shadow on
	 * themselves. The default is 0.01.
	 */
	bias?: number;
	/**
	 * How far each receiving surface moves along its normal before its shadow test, in meters, at
	 * least 0. One texel of the surface's cascade caps it. A surface takes this times the sine of its
	 * angle to the light. The default is 0.02.
	 */
	normalBias?: number;
	/**
	 * The distance from the camera in meters, along its view, out to which shadows fall, above 0.
	 * Shadows fade out over the last tenth of it. The camera's far plane ends them sooner. The
	 * default is 200.
	 */
	distance?: number;
}

/**
 * Options for `scene.createPointLight`.
 *
 * @category api/lights
 */
export interface PointLightOptions extends LightOptions {
	/**
	 * The distance in meters where the light ends, above 0. Every point light needs one, because the
	 * engine finds the lights near each surface by their ranges.
	 */
	range: number;
	/** How fast the light fades with distance, at least 0. The default, 2, is the physical rate. */
	decay?: number;
	/**
	 * True makes the light cast shadows, like `setCastShadows(true)`. The default is false. Point
	 * lights cast them where the quality preset's `pointLightShadows` is on, as on High and Ultra.
	 */
	castShadows?: boolean;
	/** How the light's shadows draw, like `setShadow`. Each setting has a default. */
	shadow?: LightShadowOptions;
}

/**
 * The shadows of a point or spot light. A spot light draws its casters' depth into a tile of the
 * shadow atlas, a view from the light that holds its cone. A point light draws into six tiles, one
 * for each face of a cube around it.
 *
 * @category api/lights
 */
export interface LightShadowOptions {
	/**
	 * How far each receiving surface moves toward the light before its shadow test, in meters, at
	 * least 0. One texel of the light's tile at the surface's distance caps it. A surface takes this
	 * times the tangent of its angle to the light, up to twice it. Raise it when surfaces show stripes
	 * of shadow on themselves. The default is 0.01.
	 */
	bias?: number;
	/**
	 * How far each receiving surface moves along its normal before its shadow test, in meters, at
	 * least 0. One texel of the light's tile at the surface's distance caps it. A surface takes this
	 * times the sine of its angle to the light. The default is 0.02.
	 */
	normalBias?: number;
}

/**
 * Options for `scene.createSpotLight`.
 *
 * @category api/lights
 */
export interface SpotLightOptions extends PointLightOptions {
	/**
	 * The direction the light travels, relative to the parent. The default, (0, -1, 0), points
	 * straight down. It sets the light's rotation, so it wins over `rotation`.
	 */
	direction?: Vec3;
	/** A point the light turns toward. It wins over `direction`. */
	target?: Vec3;
	/**
	 * The angle in radians from the light's direction to the edge of its cone, above 0 and at most
	 * π/2. The default is π/3.
	 */
	angle?: number;
	/**
	 * The part of the cone, from 0 to 1, over which the light fades out toward the edge. The
	 * default, 0, gives a sharp edge.
	 */
	penumbra?: number;
	/**
	 * True makes the light cast shadows, like `setCastShadows(true)`. The default is false. The
	 * quality preset's `shadowTiles` caps the lights that cast them at once.
	 */
	castShadows?: boolean;
	/** How the light's shadows draw, like `setShadow`. Each setting has a default. */
	shadow?: LightShadowOptions;
}

/**
 * Options for `scene.createHemisphereLight`.
 *
 * @category api/lights
 */
export interface HemisphereLightOptions extends NodeOptions {
	/** The color of the light from above. The default is white. */
	skyColor?: ColorInput;
	/** The color of the light from below. The default is white. */
	groundColor?: ColorInput;
	/** A factor that scales both colors. The default is 1. */
	intensity?: number;
}

/** The options of any light, as the scene's shared create path reads them. */
type AnyLightOptions = LightOptions &
	Partial<Omit<SpotLightOptions, keyof LightOptions>> &
	Pick<DirectionalLightOptions, 'shadow'>;

/** The numbers of a light's options, and their codes in the light table. */
const LIGHT_NUMBERS = [
	['intensity', C.LIGHT_VALUE_INTENSITY],
	['range', C.LIGHT_VALUE_RANGE],
	['decay', C.LIGHT_VALUE_DECAY],
	['angle', C.LIGHT_VALUE_ANGLE],
	['penumbra', C.LIGHT_VALUE_PENUMBRA],
] as const;

/**
 * Each light number's name, lowest and highest value, and its range in words, by its code, for the
 * development checks.
 */
const LIGHT_LIMITS: Record<number, readonly [string, number, number, string]> = {
	[C.LIGHT_VALUE_INTENSITY]: ['intensity', -Infinity, Infinity, 'a finite number'],
	[C.LIGHT_VALUE_RANGE]: ['range', Number.MIN_VALUE, Number.MAX_VALUE, 'above 0'],
	[C.LIGHT_VALUE_DECAY]: ['decay', 0, Number.MAX_VALUE, 'at least 0'],
	[C.LIGHT_VALUE_ANGLE]: ['angle', Number.MIN_VALUE, Math.PI / 2, 'above 0 and at most π/2'],
	[C.LIGHT_VALUE_PENUMBRA]: ['penumbra', 0, 1, 'from 0 to 1'],
	[C.LIGHT_VALUE_SHADOW_BIAS]: ['shadow bias', 0, Number.MAX_VALUE, 'at least 0'],
	[C.LIGHT_VALUE_SHADOW_NORMAL_BIAS]: ['shadow normal bias', 0, Number.MAX_VALUE, 'at least 0'],
	[C.LIGHT_VALUE_SHADOW_CASCADES]: ['shadow cascades', 1, 4, 'a whole number from 1 to 4'],
	[C.LIGHT_VALUE_SHADOW_MAP_SIZE]: [
		'shadow map size',
		256,
		4096,
		'256, 512, 1,024, 2,048 or 4,096',
	],
	[C.LIGHT_VALUE_SHADOW_DISTANCE]: [
		'shadow distance',
		Number.MIN_VALUE,
		Number.MAX_VALUE,
		'above 0',
	],
};

/** The options of a directional light's shadows, and their codes in the light table. */
const SHADOW_NUMBERS = [
	['cascades', C.LIGHT_VALUE_SHADOW_CASCADES],
	['mapSize', C.LIGHT_VALUE_SHADOW_MAP_SIZE],
	['bias', C.LIGHT_VALUE_SHADOW_BIAS],
	['normalBias', C.LIGHT_VALUE_SHADOW_NORMAL_BIAS],
	['distance', C.LIGHT_VALUE_SHADOW_DISTANCE],
] as const;

/** The direction a new directional or spot light points: straight down. */
const DOWN: Vec3 = [0, -1, 0];
/** The axis that a light's light travels along before the light turns: -Z, as a camera looks. */
const LIGHT_AXIS: Vec3 = [0, 0, -1];

/** Views of the per-slot arrays and the command ring. */
class SceneViews {
	readonly positions: Float32Array;
	readonly rotations: Float32Array;
	readonly scales: Float32Array;
	readonly radii: Float32Array;
	/** The centers of the local bounding spheres, 3 floats per slot. */
	readonly centers: Float32Array;
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
		this.centers = core.f32(glue.sceneArrays(C.SCENE_FIELD_LOCAL_CENTERS), rows * 3);
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
	/**
	 * @internal The row of the scene arrays that the object's calls read and write: its slot, or,
	 * once it is destroyed, row 0, which no object has. So a call on a destroyed object never
	 * reaches the object that takes its slot, in any build, and costs nothing more.
	 */
	row: number;

	constructor(
		/** @internal */ protected readonly scene: Scene,
		/** @internal */ readonly handle: number,
		/** The name from the create options, or an empty string. */
		readonly name: string,
	) {
		this.row = handle & SLOT_MASK;
	}

	/** @internal */
	get slot(): number {
		return this.handle & SLOT_MASK;
	}

	/** @internal Cameras and lights point their -Z axis where they look; other objects +Z. */
	protected get looksDownMinusZ(): boolean {
		return false;
	}

	/** @internal The object's name in quotes, or "an object", as error messages show it. */
	get label(): string {
		return this.name ? `"${this.name}"` : 'an object';
	}

	/** The object's name and slot, as error messages show them. */
	describe(): string {
		return `${this.label} (slot ${this.slot})`;
	}

	/** Sets the position relative to the parent. */
	setPosition(x: number, y: number, z: number): void {
		if (DEV) {
			checkLive('setPosition', this);
			checkVector('setPosition', this, x, y, z);
		}
		const p = this.scene.views.positions;
		const i = this.row * 3;
		p[i] = x;
		p[i + 1] = y;
		p[i + 2] = z;
		this.scene.markDirty(this.row);
	}

	/** Sets the rotation as a quaternion (x, y, z, w). */
	setRotation(x: number, y: number, z: number, w: number): void {
		if (DEV) {
			checkLive('setRotation', this);
			checkVector('setRotation', this, x, y, z, w);
		}
		const r = this.scene.views.rotations;
		const i = this.row * 4;
		r[i] = x;
		r[i + 1] = y;
		r[i + 2] = z;
		r[i + 3] = w;
		this.scene.markDirty(this.row);
	}

	/** Sets the rotation from Euler angles in radians, with three.js's axis order names. */
	setRotationEuler(x: number, y: number, z: number, order: EulerOrder = 'XYZ'): void {
		if (DEV) {
			checkLive('setRotationEuler', this);
			checkVector('setRotationEuler', this, x, y, z);
		}
		const r = this.scene.views.rotations;
		const i = this.row * 4;
		quaternionFromEuler(this.scene.scratch, x, y, z, order);
		r.set(this.scene.scratch, i);
		this.scene.markDirty(this.row);
	}

	/** Sets the scale on each axis. */
	setScale(x: number, y: number, z: number): void {
		if (DEV) {
			checkLive('setScale', this);
			checkVector('setScale', this, x, y, z);
		}
		const s = this.scene.views.scales;
		const i = this.row * 3;
		s[i] = x;
		s[i + 1] = y;
		s[i + 2] = z;
		this.scene.markDirty(this.row);
	}

	/** Turns the object toward a point. It assumes the object's parents are not rotated. */
	lookAt(x: number, y: number, z: number): void {
		if (DEV) {
			checkLive('lookAt', this);
			checkVector('lookAt', this, x, y, z);
		}
		const { positions, rotations } = this.scene.views;
		const i = this.row * 3;
		const eye = this.scene.eye;
		eye[0] = positions[i] as number;
		eye[1] = positions[i + 1] as number;
		eye[2] = positions[i + 2] as number;
		const target = this.scene.target;
		target[0] = x;
		target[1] = y;
		target[2] = z;
		quaternionLookAt(this.scene.scratch, eye, target, this.looksDownMinusZ);
		rotations.set(this.scene.scratch, this.row * 4);
		this.scene.markDirty(this.row);
	}

	/** Turns the object by `angle` radians about its own X axis. */
	rotateX(angle: number): void {
		this.turn('rotateX', rotateX, angle);
	}

	/** Turns the object by `angle` radians about its own Y axis. */
	rotateY(angle: number): void {
		this.turn('rotateY', rotateY, angle);
	}

	/** Turns the object by `angle` radians about its own Z axis. */
	rotateZ(angle: number): void {
		this.turn('rotateZ', rotateZ, angle);
	}

	/** Turns the object's rotation with one of the quaternion helpers' turns about its own axes. */
	private turn(call: string, by: Turn, angle: number): void {
		if (DEV) {
			checkLive(call, this);
			checkNumber(call, 'angle', angle, this);
		}
		const q = this.scene.scratch;
		this.scene.readRotation(this.row, q);
		by(q, q, angle);
		this.scene.views.rotations.set(q, this.row * 4);
		this.scene.markDirty(this.row);
	}

	/**
	 * Moves the object by (x, y, z) along its own axes, as three.js's `translateX`, `translateY` and
	 * `translateZ` do together. The object's rotation turns the vector, and its scale leaves it as
	 * it is, so `translate(0, 0, -1)` moves a camera 1 m forward.
	 */
	translate(x: number, y: number, z: number): void {
		if (DEV) {
			checkLive('translate', this);
			checkVector('translate', this, x, y, z);
		}
		const { scene } = this;
		const q = scene.scratch;
		scene.readRotation(this.row, q);
		const v = scene.eye;
		v[0] = x;
		v[1] = y;
		v[2] = z;
		transformQuat(v, v, q);
		const p = scene.views.positions;
		const i = this.row * 3;
		p[i] = (p[i] as number) + (v[0] as number);
		p[i + 1] = (p[i + 1] as number) + (v[1] as number);
		p[i + 2] = (p[i + 2] as number) + (v[2] as number);
		scene.markDirty(this.row);
	}

	/** Copies the position relative to the parent into `out`. */
	getPosition(out: Vec3Like): void {
		if (DEV) checkLive('getPosition', this);
		const p = this.scene.views.positions;
		const i = this.row * 3;
		out[0] = p[i] as number;
		out[1] = p[i + 1] as number;
		out[2] = p[i + 2] as number;
	}

	/** Copies the rotation relative to the parent into `out`, as a quaternion (x, y, z, w). */
	getRotation(out: QuatLike): void {
		if (DEV) checkLive('getRotation', this);
		this.scene.readRotation(this.row, out);
	}

	/** Copies the world position of the frame that last ran into `out`. */
	getWorldPosition(out: Vec3Like): void {
		if (DEV) checkLive('getWorldPosition', this);
		const m = this.scene.worldMatrix(this, 'getWorldPosition');
		out[0] = m[3] as number;
		out[1] = m[7] as number;
		out[2] = m[11] as number;
	}

	/**
	 * Copies the world rotation of the frame that last ran into `out`, as a quaternion (x, y, z, w).
	 * It is the rotation part of the world matrix, which `mat4.decompose` splits off.
	 */
	getWorldQuaternion(out: QuatLike): void {
		if (DEV) checkLive('getWorldQuaternion', this);
		const { scene } = this;
		const m = scene.worldColumns(this, 'getWorldQuaternion');
		decompose(scene.eye, out, scene.target, m);
	}

	/**
	 * Copies the world matrix of the frame that last ran into `out`: 16 numbers, column by column,
	 * as `mat4` and three.js's `matrixWorld` hold them. Its translation keeps full precision far
	 * from the origin when `out` is a plain array or a `Float64Array`.
	 */
	getWorldMatrix(out: Mat4Like): void {
		if (DEV) checkLive('getWorldMatrix', this);
		copyMatrix(out, this.scene.worldColumns(this, 'getWorldMatrix'));
	}

	/**
	 * Moves the object under another, or to the root with null, from the next frame. By default it
	 * keeps its position, rotation and scale relative to the parent, so its place in the world
	 * changes with the new parent. With `keepWorld: true` it keeps its place in the world instead.
	 */
	setParent(parent: Object3D | null, options?: ParentOptions): void {
		if (DEV) {
			checkLive('setParent', this);
			if (parent) {
				checkLive('setParent', parent, true);
				if (parent.scene !== this.scene)
					throw new EngineError(
						'E1103',
						`setParent() got ${parent.describe()}, which is not from this engine.`,
					);
				if (parent === this)
					throw new EngineError('E1104', `setParent() would put ${this.describe()} under itself.`);
			}
		}
		const keep = options?.keepWorld ? C.COMMAND_KEEP_WORLD : 0;
		this.scene.command(C.COMMAND_SET_PARENT, this.handle, parent?.handle ?? 0, keep, 'setParent');
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
		// The core checks the handle's generation, so a second destroy frees no other object.
		this.scene.command(C.COMMAND_DESTROY, this.handle, 0, 0, 'destroy');
		this.destroyedFrame = this.scene.frame;
		this.row = 0;
		this.scene.forget(this);
	}

	/** @internal Sets or clears one of the object's flags from the next frame. */
	protected setFlag(call: string, flag: number, on: boolean): void {
		if (DEV) checkLive(call, this);
		this.scene.command(C.COMMAND_SET_FLAGS, this.handle, flag, on ? flag : 0, call);
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
		if (DEV) {
			checkLive('setMaterial', this);
			checkSameEngine('setMaterial', 'material', material.core, this.scene);
		}
		this.scene.command(C.COMMAND_SET_MATERIAL, this.handle, material.id, 0, 'setMaterial');
	}

	/**
	 * Changes the shape from the next frame. The mesh's bounds replace the object's, so call
	 * `setBounds` again after this when the object needs bounds of its own.
	 */
	setMesh(mesh: MeshGeometry): void {
		if (DEV) {
			checkLive('setMesh', this);
			checkSameEngine('setMesh', 'mesh', mesh.core, this.scene);
		}
		this.scene.writeBounds(this.row, 0, 0, 0, mesh.radius);
		if (DEV) this.scene.unmarkedWrites?.boundsWritten(this);
		this.scene.command(C.COMMAND_SET_MESH, this.handle, mesh.id, 0, 'setMesh');
	}

	/**
	 * Makes the mesh cast the shadows of a directional light, or stop. The default is false. A
	 * change rebuilds the engine's tables of what it draws, as a new material does.
	 */
	setCastShadows(cast: boolean): void {
		this.setFlag('setCastShadows', C.FLAG_CAST_SHADOWS, cast);
	}

	/**
	 * Makes shadows fall on the mesh, or stop. The default is false. Unlit materials show no
	 * shadows. A change rebuilds the engine's tables of what it draws, as a new material does.
	 */
	setReceiveShadows(receive: boolean): void {
		this.setFlag('setReceiveShadows', C.FLAG_RECEIVE_SHADOWS, receive);
	}

	/**
	 * Sets the order in which the mesh draws among blended objects, lower first, as three.js's
	 * `renderOrder`. Objects of one order draw farthest first. The default is 0. The engine orders
	 * opaque and masked objects itself.
	 */
	setRenderOrder(order: number): void {
		if (DEV) {
			checkLive('setRenderOrder', this);
			checkNumber('setRenderOrder', 'order', order, this);
		}
		const bits = this.scene.floatBits(order);
		this.scene.command(C.COMMAND_SET_RENDER_ORDER, this.handle, bits, 0, 'setRenderOrder');
	}

	/**
	 * With false, the engine draws the mesh even where its bounds are out of view, as three.js's
	 * `frustumCulled = false` does. The default is true. For vertices that a shader moves, larger
	 * bounds from `setBounds` cost less.
	 */
	setFrustumCulled(culled: boolean): void {
		this.setFlag('setFrustumCulled', C.FLAG_UNCULLED, !culled);
	}

	/**
	 * Replaces the mesh's bounding sphere, which culling tests, with a sphere of your own: `center`
	 * relative to the object's origin, and `radius`, both before the object's scale. Use it when a
	 * shader moves vertices outside the mesh's sphere. `setMesh` gives the mesh's sphere back.
	 */
	setBounds(center: Vec3Like, radius: number): void {
		const x = center[0] as number;
		const y = center[1] as number;
		const z = center[2] as number;
		if (DEV) {
			checkLive('setBounds', this);
			checkVector('setBounds', this, x, y, z);
			checkNumber('setBounds', 'radius', radius, this);
			if (radius < 0)
				throw new EngineError(
					'E1108',
					`setBounds() got the radius ${radius} on ${this.describe()}, below 0.`,
				);
		}
		this.scene.writeBounds(this.row, x, y, z, radius);
		if (DEV) this.scene.unmarkedWrites?.boundsWritten(this);
		this.setFlag('setBounds', C.FLAG_CUSTOM_BOUNDS, true);
	}
}

/** Throws E1103 when a mesh or a material comes from another engine. Call it inside `if (DEV)`. */
function checkSameEngine(
	call: string,
	kind: 'mesh' | 'material',
	core: CoreMemory,
	scene: Scene,
): void {
	if (core !== scene.core)
		throw new EngineError('E1103', `${call}() got a ${kind} that is not from this engine.`);
}

/**
 * An object that the scene can be drawn from. `scene.setActiveCamera` picks the camera that the
 * canvas shows. A camera is a `PerspectiveCamera` or an `OrthographicCamera`, and
 * `isOrthographic` tells them apart.
 *
 * @category api/cameras
 */
export abstract class Camera extends Object3D {
	/** True for an `OrthographicCamera`, false for a `PerspectiveCamera`. */
	abstract readonly isOrthographic: boolean;

	/** @internal The layers of the objects the camera draws. */
	layers: number = C.LAYERS_DEFAULT;

	/** @internal */
	constructor(
		scene: Scene,
		handle: number,
		name: string,
		private nearPlane: number,
		private farPlane: number,
	) {
		super(scene, handle, name);
	}

	protected override get looksDownMinusZ(): boolean {
		return true;
	}

	/** The distance to the near clipping plane. */
	get near(): number {
		return this.nearPlane;
	}

	/** The distance to the far clipping plane. */
	get far(): number {
		return this.farPlane;
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

	/** Sets the distances to the near and far clipping planes. */
	setNearFar(near: number, far: number): void {
		if (DEV) {
			checkLive('setNearFar', this);
			checkNearFar('setNearFar', near, far, !this.isOrthographic, this);
		}
		this.nearPlane = near;
		this.farPlane = far;
		this.scene.lensChanged(this);
	}

	/**
	 * @internal Gives the engine core this camera's lens and layers, which the active camera draws
	 * with, or with `target` set to `CAMERA_TARGET_SHADOWS`, the lens that fits the shadow
	 * cascades.
	 */
	abstract sendLens(glue: CoreGlue, target?: number): void;
}

/**
 * A camera that shows near things larger than far things, as the eye does.
 *
 * @category api/cameras
 */
export class PerspectiveCamera extends Camera {
	/** False: a perspective camera. */
	readonly isOrthographic = false;

	/** @internal */
	constructor(
		scene: Scene,
		handle: number,
		name: string,
		private verticalFov: number,
		near: number,
		far: number,
	) {
		super(scene, handle, name, near, far);
	}

	/** The vertical field of view in degrees. */
	get fov(): number {
		return this.verticalFov;
	}

	/** Sets the vertical field of view in degrees. */
	setFov(degrees: number): void {
		if (DEV) {
			checkLive('setFov', this);
			checkFov('setFov', degrees, this);
		}
		this.verticalFov = degrees;
		this.scene.lensChanged(this);
	}

	/** @internal */
	sendLens(glue: CoreGlue, target: number = C.CAMERA_TARGET_VIEW): void {
		glue.setPerspectiveCamera(
			this.handle,
			this.verticalFov,
			this.near,
			this.far,
			this.layers,
			target,
		);
	}
}

/**
 * A camera whose view is a box: things keep their size at every distance, as in maps and
 * isometric games.
 *
 * @category api/cameras
 */
export class OrthographicCamera extends Camera {
	/** True: an orthographic camera. */
	readonly isOrthographic = true;

	/** @internal */
	constructor(
		scene: Scene,
		handle: number,
		name: string,
		/** @internal The view's box across the camera's axis. */ readonly view: OrthographicView,
		near: number,
		far: number,
	) {
		super(scene, handle, name, near, far);
	}

	/** The view's height in world units. */
	get height(): number {
		return this.view.height;
	}

	/**
	 * The view's width in world units, or undefined when the width follows the canvas's aspect
	 * ratio.
	 */
	get width(): number | undefined {
		return this.view.width > 0 ? this.view.width : undefined;
	}

	/**
	 * Sets the view's height in world units. A width that follows the canvas keeps following it.
	 * A view made from four edges scales about its center and keeps its shape, as three.js's
	 * `zoom` scales it.
	 */
	setOrthoHeight(height: number): void {
		if (DEV) {
			checkLive('setOrthoHeight', this);
			checkSize('setOrthoHeight', 'height', height, this);
		}
		setViewHeight(this.view, height);
		this.scene.lensChanged(this);
	}

	/** @internal */
	sendLens(glue: CoreGlue, target: number = C.CAMERA_TARGET_VIEW): void {
		const view = this.view;
		glue.setOrthographicCamera(
			this.handle,
			view.height,
			view.width,
			view.centerX,
			view.centerY,
			this.near,
			this.far,
			this.layers,
			target,
		);
	}
}

/**
 * A light: a scene object that lights the objects around it. Each kind of light has a class of its
 * own. Setters allocate nothing except those that convert a color, so `onUpdate` can animate
 * lights.
 *
 * @category api/lights
 */
export class Light extends Object3D {
	/**
	 * @internal The light's row in the engine's light table, or 0, which holds no light, once the
	 * light is destroyed. The core then refuses its calls, so they never reach the light that
	 * takes the row.
	 */
	id = 0;
	/** @internal The light's color in linear RGB, before the intensity scales it. */
	readonly linear = new Float64Array([1, 1, 1]);

	protected override get looksDownMinusZ(): boolean {
		return true;
	}

	/** Sets the color. Converting a color allocates, so per-frame code sets the intensity instead. */
	setColor(color: ColorInput): void {
		this.paint('setColor', C.LIGHT_COLOR_MAIN, color);
	}

	/** Sets the factor that scales the color. */
	setIntensity(intensity: number): void {
		this.write('setIntensity', C.LIGHT_VALUE_INTENSITY, intensity);
	}

	/** Removes the light at the next frame. Its children become roots. */
	override destroy(): void {
		const { id } = this;
		super.destroy();
		if (id === 0) return;
		this.id = 0;
		const { core } = this.scene;
		core.check(core.glue.destroyLight(id), 'destroy', this.label, true);
	}

	/** @internal Sets one of the light's colors, by its code in the light table. */
	paint(call: string, which: number, color: ColorInput): void {
		if (DEV) checkLive(call, this);
		const rgb = linearColor(color, call);
		if (which === C.LIGHT_COLOR_MAIN) this.linear.set(rgb);
		this.scene.core.glue.setLightColor(this.id, which, rgb[0], rgb[1], rgb[2]);
	}

	/** @internal Sets each of the shadow settings that `shadow` gives. */
	shadow(call: string, shadow: DirectionalShadowOptions | LightShadowOptions): void {
		for (const [key, which] of SHADOW_NUMBERS) {
			const value = (shadow as DirectionalShadowOptions)[key];
			if (value !== undefined) this.write(call, which, value);
		}
	}

	/** @internal Sets one of the light's numbers, by its code in the light table. */
	write(call: string, which: number, value: number): void {
		if (DEV) {
			checkLive(call, this);
			const limits = LIGHT_LIMITS[which] as (typeof LIGHT_LIMITS)[number];
			if (typeof value === 'number') checkNumber(call, limits[0], value, this);
			// Cascades are whole, and map sizes are powers of two.
			const whole =
				which === C.LIGHT_VALUE_SHADOW_CASCADES
					? Number.isInteger(value)
					: which !== C.LIGHT_VALUE_SHADOW_MAP_SIZE || (value & (value - 1)) === 0;
			if (!(value >= limits[1] && value <= limits[2] && whole))
				throw new EngineError(
					'E1108',
					`${call}() got the ${limits[0]} ${value} on ${this.describe()}, which must be ${limits[3]}.`,
				);
		}
		this.scene.core.glue.setLightValue(this.id, which, value);
	}

	/**
	 * @internal Turns the light so that its light travels along (x, y, z), relative to its parent.
	 */
	aim(call: string, x: number, y: number, z: number): void {
		if (DEV) {
			checkLive(call, this);
			checkVector(call, this, x, y, z);
			if (x === 0 && y === 0 && z === 0)
				throw new EngineError(
					'E1108',
					`${call}() got the direction (0, 0, 0) on ${this.describe()}, which points nowhere.`,
				);
		}
		const { scene } = this;
		const d = scene.target;
		const k = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
		d[0] = x * k;
		d[1] = y * k;
		d[2] = z * k;
		rotationTo(scene.scratch, LIGHT_AXIS, d);
		scene.views.rotations.set(scene.scratch, this.row * 4);
		scene.markDirty(this.row);
	}
}

/**
 * Light from one direction, like sunlight. It travels along the light's -Z axis, which
 * `setDirection`, `lookAt` and the light's parents turn. Its position does not matter.
 *
 * @category api/lights
 */
export class DirectionalLight extends Light {
	/** Turns the light so that its light travels along (x, y, z), relative to its parent. */
	setDirection(x: number, y: number, z: number): void {
		this.aim('setDirection', x, y, z);
	}

	/**
	 * Makes the light cast shadows, or stop. The default is false. The first directional light
	 * created casts them.
	 */
	setCastShadows(cast: boolean): void {
		this.setFlag('setCastShadows', C.FLAG_CAST_SHADOWS, cast);
	}

	/**
	 * Changes how the light's shadows draw. Settings that `shadow` leaves out keep their values. A
	 * new cascade count or map size makes the shadow map again, so set them at setup.
	 */
	setShadow(shadow: DirectionalShadowOptions): void {
		this.shadow('setShadow', shadow);
	}
}

/**
 * Light from a point in every direction, which fades with distance and ends at its range.
 *
 * @category api/lights
 */
export class PointLight extends Light {
	/** Sets the distance in meters where the light ends, above 0. */
	setRange(range: number): void {
		this.write('setRange', C.LIGHT_VALUE_RANGE, range);
	}

	/** Sets how fast the light fades with distance, at least 0: 2 is the physical rate. */
	setDecay(decay: number): void {
		this.write('setDecay', C.LIGHT_VALUE_DECAY, decay);
	}

	/**
	 * Makes the light cast shadows, or stop. The default is false. Point lights cast them where the
	 * quality preset's `pointLightShadows` is on, and each takes six tiles of `shadowTiles`.
	 */
	setCastShadows(cast: boolean): void {
		this.setFlag('setCastShadows', C.FLAG_CAST_SHADOWS, cast);
	}

	/** Changes how the light's shadows draw. Settings that `shadow` leaves out keep their values. */
	setShadow(shadow: LightShadowOptions): void {
		this.shadow('setShadow', shadow);
	}
}

/**
 * Light from a point in a cone, which fades with distance and ends at its range. The cone points
 * along the light's -Z axis, which `setDirection`, `lookAt` and the light's parents turn.
 *
 * @category api/lights
 */
export class SpotLight extends Light {
	/** Sets the distance in meters where the light ends, above 0. */
	setRange(range: number): void {
		this.write('setRange', C.LIGHT_VALUE_RANGE, range);
	}

	/** Sets how fast the light fades with distance, at least 0: 2 is the physical rate. */
	setDecay(decay: number): void {
		this.write('setDecay', C.LIGHT_VALUE_DECAY, decay);
	}

	/** Sets the angle in radians from the light's direction to the edge of its cone: up to π/2. */
	setAngle(angle: number): void {
		this.write('setAngle', C.LIGHT_VALUE_ANGLE, angle);
	}

	/** Sets the part of the cone, from 0 to 1, over which the light fades out toward the edge. */
	setPenumbra(penumbra: number): void {
		this.write('setPenumbra', C.LIGHT_VALUE_PENUMBRA, penumbra);
	}

	/** Turns the light so that its light travels along (x, y, z), relative to its parent. */
	setDirection(x: number, y: number, z: number): void {
		this.aim('setDirection', x, y, z);
	}

	/**
	 * Makes the light cast shadows, or stop. The default is false. The quality preset's
	 * `shadowTiles` caps the lights that cast them at once: the lights that look largest from the
	 * camera cast them first.
	 */
	setCastShadows(cast: boolean): void {
		this.setFlag('setCastShadows', C.FLAG_CAST_SHADOWS, cast);
	}

	/** Changes how the light's shadows draw. Settings that `shadow` leaves out keep their values. */
	setShadow(shadow: LightShadowOptions): void {
		this.shadow('setShadow', shadow);
	}
}

/**
 * Light from the sky above and the ground below, which fades from one color to the other with the
 * way a surface faces. The sky lies along the light's +Y axis. `setColor` sets the sky color.
 *
 * @category api/lights
 */
export class HemisphereLight extends Light {
	/** Sets the ground color. Converting a color allocates. */
	setGroundColor(color: ColorInput): void {
		this.paint('setGroundColor', C.LIGHT_COLOR_GROUND, color);
	}
}

/**
 * Light that reaches every surface equally.
 *
 * @category api/lights
 */
export class AmbientLight extends Light {}

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
			core.check(core.glue.batchArrays(this.id, field), 'instance arrays', 'an instance batch');
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

	/**
	 * Removes the batch and frees its rows. Its typed arrays are not valid after this: another
	 * batch can take their memory.
	 */
	destroy(): void {
		const { core } = this.scene;
		core.checkGrowth(core.glue.destroyBatch(this.id, this.scene.frame), 'destroy', undefined, true);
		if (DEV) this.scene.countBatchRows(-this.count);
		this.destroyedFrame = this.scene.frame;
		// The next read of the arrays asks the core for them again, and the core refuses a
		// destroyed batch.
		this.generation = -1;
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
	/** The camera that fits the shadow cascades in place of the active camera, for debugging. */
	private shadowCamera: Camera | undefined;
	/** @internal Scratch arrays, so rotations and reads allocate nothing. */
	readonly scratch = new Float32Array(4);
	/** @internal */
	readonly eye = new Float64Array(3);
	/** @internal */
	readonly target = new Float64Array(3);
	/** A world matrix, whose translation keeps 64-bit precision far from the origin. */
	private readonly matrix = new Float64Array(C.CORE_MATRIX_FLOATS);
	/** The same world matrix as 16 numbers, column by column. */
	private readonly columns = new Float64Array(16);
	/** A 32-bit float and its bits, for commands that carry a float. */
	private readonly float = new Float32Array(1);
	private readonly floatWord = new Uint32Array(this.float.buffer);
	/**
	 * The live objects with each name: the object itself, or the objects with a name that several
	 * share, in the order of their creation.
	 */
	private readonly names = new Map<string, Object3D | Set<Object3D>>();
	/** The object that each slot holds, or last held, which queries name by slot. */
	private readonly objectSlots: (Object3D | undefined)[] = [];
	/** The batch that each batch slot holds, or last held, which queries name by id. */
	private readonly batchSlots: (InstanceBatch | undefined)[] = [];
	/** Raycasts and overlap queries, made on the first query. */
	private sceneQueries: SceneQueries | undefined;
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
		/** True when the engine draws with WebGL2, whose devices draw fewer rows than WebGPU's. */
		private readonly webgl2: boolean,
		private readonly warmUpScene: () => Promise<void> = () => Promise.resolve(),
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

	/** @internal The world matrix of the frame that last ran: 12 numbers, row by row. */
	worldMatrix(object: Object3D, call: string): Float64Array {
		// The core's error adds the slot to the object's name.
		this.core.check(
			this.core.glue.worldMatrix(object.handle, this.matrix),
			call,
			object.label,
			true,
		);
		return this.matrix;
	}

	/** @internal The world matrix of the frame that last ran: 16 numbers, column by column. */
	worldColumns(object: Object3D, call: string): Float64Array {
		const m = this.worldMatrix(object, call);
		const out = this.columns;
		for (let row = 0; row < 3; row++)
			for (let column = 0; column < 4; column++)
				out[column * 4 + row] = m[row * 4 + column] as number;
		out[3] = 0;
		out[7] = 0;
		out[11] = 0;
		out[15] = 1;
		return out;
	}

	/** @internal Copies the rotation of the object in `slot` into `out`. */
	readRotation(slot: number, out: QuatLike): void {
		const r = this.views.rotations;
		const i = slot * 4;
		out[0] = r[i] as number;
		out[1] = r[i + 1] as number;
		out[2] = r[i + 2] as number;
		out[3] = r[i + 3] as number;
	}

	/**
	 * @internal Writes the local bounding sphere of the object in `slot`. The command that follows
	 * makes the engine recompute the object.
	 */
	writeBounds(slot: number, x: number, y: number, z: number, radius: number): void {
		const { centers, radii } = this.views;
		centers[slot * 3] = x;
		centers[slot * 3 + 1] = y;
		centers[slot * 3 + 2] = z;
		radii[slot] = radius;
	}

	/** @internal The bits of `value` as a 32-bit float, for a command's argument. */
	floatBits(value: number): number {
		this.float[0] = value;
		return this.floatWord[0] as number;
	}

	/** Adds a new object to the index of names, after the live objects with the same name. */
	private remember(object: Object3D): void {
		const { name } = object;
		if (!name) return;
		const known = this.names.get(name);
		if (known === undefined) this.names.set(name, object);
		else if (known instanceof Set) known.add(object);
		else this.names.set(name, new Set([known, object]));
	}

	/** @internal Takes a destroyed object out of the index of names. */
	forget(object: Object3D): void {
		const { name } = object;
		const known = this.names.get(name);
		if (known === object) this.names.delete(name);
		else if (known instanceof Set) {
			known.delete(object);
			if (known.size === 0) this.names.delete(name);
		}
	}

	/**
	 * The first object created with `name` that is not destroyed, or undefined when no object has
	 * the name. It looks the name up in an index, so its cost does not grow with the scene. Call it
	 * at setup and keep the object it returns.
	 */
	find(name: string): Object3D | undefined {
		const known = this.names.get(name);
		return known instanceof Set ? known.values().next().value : known;
	}

	/**
	 * @internal Counts the rows of batches as they are created and destroyed, and warns once when
	 * the scene passes the limit that every device of the engine's GPU path draws.
	 */
	countBatchRows(change: number): void {
		this.batchRows += change;
		if (this.warnedPastPortable) return;
		// The core counts every scene slot, used or not, toward the limit.
		const sources = this.core.glue.sceneCapacity() + 1 + this.batchRows;
		const warning = rowLimitWarning(sources, this.webgl2);
		if (warning === undefined) return;
		this.warnedPastPortable = true;
		console.warn(warning);
	}

	/** @internal */
	lensChanged(camera: Camera): void {
		if (camera === this.activeCamera) camera.sendLens(this.core.glue);
		if (camera === this.shadowCamera) camera.sendLens(this.core.glue, C.CAMERA_TARGET_SHADOWS);
	}

	/**
	 * @internal Fits the main directional light's shadow cascades to `camera` in place of the active
	 * camera, or to the active camera again without one, for `debug.shadowCamera`.
	 */
	setShadowCamera(camera: Camera | undefined): void {
		this.shadowCamera = camera;
		if (camera) camera.sendLens(this.core.glue, C.CAMERA_TARGET_SHADOWS);
		else this.core.glue.clearShadowCamera();
	}

	/**
	 * Creates an object of class `kind` from the next frame: its slot with the transform of
	 * `options`, its create command with `flags` besides visibility and `dynamic`, its layers, and
	 * its wrapper, built with any further constructor arguments, which the index of names learns.
	 */
	private create<T extends Object3D, A extends unknown[]>(
		kind: ObjectClass<T, A>,
		options: NodeOptions,
		mesh: number,
		radius: number,
		flags: number,
		call: string,
		...extra: A
	): T {
		const { layers } = options;
		if (DEV) {
			if (options.parent) checkLive(call, options.parent, true);
			if (layers !== undefined) checkLayers(call, layers);
		}
		const handle = this.core.check(this.core.glue.reserveObject(), call, options.name);
		const slot = handle & SLOT_MASK;
		const v = this.views;
		v.positions.set(options.position ?? [0, 0, 0], slot * 3);
		v.rotations.set(options.rotation ?? [0, 0, 0, 1], slot * 4);
		v.scales.set(options.scale ?? [1, 1, 1], slot * 3);
		v.radii[slot] = radius;
		const all = flags | C.FLAG_VISIBLE | (options.dynamic ? C.FLAG_DYNAMIC : 0);
		this.command(C.COMMAND_CREATE | (all << 8), handle, options.parent?.handle ?? 0, mesh, call);
		if (layers !== undefined && layers >>> 0 !== C.LAYERS_DEFAULT)
			this.command(C.COMMAND_SET_LAYERS, handle, layers >>> 0, 0, call);
		const object = new kind(this, handle, options.name ?? '', ...extra);
		this.remember(object);
		this.objectSlots[slot] = object;
		if (DEV) this.unmarkedWrites?.watch(object, !options.dynamic);
		return object;
	}

	/** An empty node, for hierarchy. */
	createGroup(options: NodeOptions = {}): Group {
		return this.create(Group, options, C.CORE_NO_MESH, 0, 0, 'createGroup');
	}

	/** A drawn object. It is static unless `dynamic: true`. */
	createMesh(options: MeshOptions): Mesh {
		const { mesh, material } = options;
		if (DEV) {
			checkSameEngine('createMesh', 'mesh', mesh.core, this);
			checkSameEngine('createMesh', 'material', material.core, this);
		}
		const flags =
			(options.castShadows ? C.FLAG_CAST_SHADOWS : 0) |
			(options.receiveShadows ? C.FLAG_RECEIVE_SHADOWS : 0);
		const object = this.create(Mesh, options, mesh.id, mesh.radius, flags, 'createMesh');
		this.command(C.COMMAND_SET_MATERIAL, object.handle, material.id, 0, 'createMesh');
		return object;
	}

	/** Many copies of one mesh and material, with typed arrays of rows. */
	createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch {
		const { core } = this;
		const { layers } = options;
		if (DEV && layers !== undefined) checkLayers('createInstances', layers);
		const id = core.checkGrowth(
			core.glue.createBatch(
				count,
				options.dynamic ?? false,
				options.colors ?? false,
				mesh.id,
				options.material.id,
			),
			'createInstances',
		);
		if (DEV) this.countBatchRows(count);
		const batch = new InstanceBatch(this, id, count, options.colors ?? false);
		this.batchSlots[id & SLOT_MASK] = batch;
		batch.setActiveCount(count);
		if (layers !== undefined) batch.setLayers(layers);
		return batch;
	}

	/** A perspective camera; `fov` is vertical, in degrees. Cameras are dynamic by default. */
	createPerspectiveCamera(options: PerspectiveCameraOptions = {}): PerspectiveCamera {
		const call = 'createPerspectiveCamera';
		const { fov = DEFAULT_FOV, near = DEFAULT_NEAR, far = DEFAULT_FAR } = options;
		if (DEV) {
			const camera = newCamera(options.name);
			checkFov(call, fov, camera);
			checkNearFar(call, near, far, true, camera);
		}
		return this.createCamera(PerspectiveCamera, options, call, fov, near, far);
	}

	/**
	 * An orthographic camera, whose view is a box: things keep their size at every distance. Give
	 * `height`, and the width follows the canvas, or give `left`, `right`, `top` and `bottom`.
	 * Cameras are dynamic by default.
	 */
	createOrthographicCamera(options: OrthographicCameraOptions = {}): OrthographicCamera {
		const call = 'createOrthographicCamera';
		const { near = DEFAULT_NEAR, far = DEFAULT_FAR } = options;
		if (DEV) {
			const camera = newCamera(options.name);
			checkOrthographicSize(call, options, camera);
			checkNearFar(call, near, far, false, camera);
		}
		const view = orthographicView(options);
		return this.createCamera(OrthographicCamera, options, call, view, near, far);
	}

	/**
	 * Creates a camera of the given class with its lens settings, dynamic unless the options say
	 * otherwise, gives it the options' layers to draw, and turns it toward the options' target.
	 */
	private createCamera<T extends Camera, A extends unknown[]>(
		kind: ObjectClass<T, A>,
		options: CameraOptions,
		call: string,
		...lens: A
	): T {
		const node = { dynamic: true, ...options };
		const camera = this.create(kind, node, C.CORE_NO_MESH, 0, 0, call, ...lens);
		camera.layers = (options.layers ?? C.LAYERS_DEFAULT) >>> 0;
		if (options.target) camera.lookAt(...options.target);
		return camera;
	}

	/** Draws the scene from this camera. */
	setActiveCamera(camera: Camera): void {
		this.activeCamera = camera;
		this.lensChanged(camera);
	}

	/**
	 * Creates a light of class `kind` from the next frame: its object, its row in the light table,
	 * and the values of `options`. A directional or spot light turns to its target or direction.
	 */
	private createLight<T extends Light>(
		kind: ObjectClass<T>,
		type: number,
		options: AnyLightOptions,
		call: string,
	): T {
		const flags = options.castShadows ? C.FLAG_CAST_SHADOWS : 0;
		const light = this.create(kind, options, C.CORE_NO_MESH, 0, flags, call);
		const { core } = this;
		light.id = core.checkGrowth(core.glue.createLight(light.handle, type), call, options.name);
		if (options.color !== undefined) light.paint(call, C.LIGHT_COLOR_MAIN, options.color);
		const ranged = type === C.LIGHT_KIND_POINT || type === C.LIGHT_KIND_SPOT;
		for (const [key, which] of LIGHT_NUMBERS) {
			const value = options[key];
			if (value !== undefined || (ranged && which === C.LIGHT_VALUE_RANGE))
				light.write(call, which, value as number);
		}
		if (options.shadow) light.shadow(call, options.shadow);
		if (type === C.LIGHT_KIND_DIRECTIONAL || type === C.LIGHT_KIND_SPOT) {
			if (options.target) light.lookAt(...options.target);
			else if (options.direction || !options.rotation)
				light.aim(call, ...(options.direction ?? DOWN));
		}
		return light;
	}

	/** Light from one direction, like sunlight: `direction` is the way it travels. */
	createDirectionalLight(options: DirectionalLightOptions = {}): DirectionalLight {
		return this.createLight(
			DirectionalLight,
			C.LIGHT_KIND_DIRECTIONAL,
			options,
			'createDirectionalLight',
		);
	}

	/** Light from a point in every direction, out to `range` meters, which it needs. */
	createPointLight(options: PointLightOptions): PointLight {
		return this.createLight(PointLight, C.LIGHT_KIND_POINT, options, 'createPointLight');
	}

	/** Light from a point in a cone, out to `range` meters, which it needs. */
	createSpotLight(options: SpotLightOptions): SpotLight {
		return this.createLight(SpotLight, C.LIGHT_KIND_SPOT, options, 'createSpotLight');
	}

	/** Light from the sky above and the ground below. */
	createHemisphereLight(options: HemisphereLightOptions = {}): HemisphereLight {
		const call = 'createHemisphereLight';
		const light = this.createLight(
			HemisphereLight,
			C.LIGHT_KIND_HEMISPHERE,
			{ ...options, color: options.skyColor },
			call,
		);
		if (options.groundColor !== undefined)
			light.paint(call, C.LIGHT_COLOR_GROUND, options.groundColor);
		return light;
	}

	/** Light on every surface, from no direction. */
	createAmbientLight(options: LightOptions = {}): AmbientLight {
		return this.createLight(AmbientLight, C.LIGHT_KIND_AMBIENT, options, 'createAmbientLight');
	}

	/**
	 * What the camera shows behind every object: a color, or a texture. A texture fills the view and
	 * stretches to its shape, as a texture in three.js's `scene.background` does. The color set
	 * before it shows until the texture's texels are on the GPU, and again if the texture is
	 * destroyed. A color takes the place of a texture. Exposure and tone mapping change the
	 * background with the rest of the scene. Without a background, the canvas shows black, or the
	 * page behind it on a transparent canvas.
	 */
	setBackground(background: ColorInput | Texture): void {
		const { glue } = this.core;
		if (background instanceof Texture) {
			const status = glue.setBackgroundTexture(background.handle);
			this.core.check(status, 'setBackground', 'a texture', true);
			return;
		}
		const [r, g, b] = linearColor(background, 'setBackground');
		glue.setBackground(r, g, b);
		glue.setBackgroundTexture(0);
	}

	/**
	 * Fog over every object, with three.js's formulas: linear fog as its `Fog`, or exponential
	 * squared fog as its `FogExp2`. Null removes the fog. The background takes no fog, and a
	 * material created with `fog: false` keeps its color. Converting the color allocates.
	 */
	setFog(fog: FogOptions | null): void {
		setSceneFog(this.core.glue, fog);
	}

	/** The raycasts and overlap queries, made on the first call. */
	private get queries(): SceneQueries {
		if (this.sceneQueries === undefined)
			this.sceneQueries = new SceneQueries(this.core, {
				objectAt: (slot) => this.objectSlots[slot],
				batchAt: (id) => {
					const batch = this.batchSlots[id & SLOT_MASK];
					return batch?.id === id ? batch : undefined;
				},
			});
		return this.sceneQueries;
	}

	/**
	 * Casts a ray from `origin` along `direction`, and writes its closest hit into `hit`. Returns
	 * true on a hit. On a miss it sets `hit.object` to null and leaves the other fields as they
	 * were. The direction needs no unit length. The ray tests the triangles of objects and
	 * instance rows on the layers of `options.layers`, as their materials draw them: front faces,
	 * or both faces for a double-sided material. Queries see the scene as the last frame's update
	 * left it, so a move, a new object or a destroy in this frame counts from the next frame, or
	 * from `onLateUpdate`. Create `hit` and `options` once and pass them each time.
	 */
	raycast(
		origin: Vec3Like,
		direction: Vec3Like,
		options: RaycastOptions | undefined,
		hit: RaycastHit,
	): boolean {
		return this.queries.raycast(origin, direction, options, hit);
	}

	/**
	 * True when a ray from `origin` along `direction` hits anything on the layers of
	 * `options.layers`. It stops at the first hit it finds, so it is faster than `raycast`: use it
	 * for line-of-sight checks.
	 */
	raycastAny(origin: Vec3Like, direction: Vec3Like, options?: RaycastOptions): boolean {
		return this.queries.raycastAny(origin, direction, options);
	}

	/**
	 * Casts a ray as `raycast` does, writes every hit into `hits` nearest first, one hit for each
	 * triangle that the ray crosses, and returns how many. It fills the first entries of `hits`,
	 * adds hit objects when the array is too short, and leaves the entries after the hits as they
	 * were.
	 */
	raycastAll(
		origin: Vec3Like,
		direction: Vec3Like,
		options: RaycastOptions | undefined,
		hits: RaycastHit[],
	): number {
		return this.queries.raycastAll(origin, direction, options, hits);
	}

	/**
	 * Casts many rays at once on the job workers, and writes each one's closest hit into `out`.
	 * `rays` holds six numbers per ray: its origin, then its direction. Returns how many rays hit
	 * something. A miss writes -1 as its distance.
	 */
	raycastBatch(
		rays: ArrayLike<number>,
		options: RaycastOptions | undefined,
		out: RaycastBatchHits,
	): number {
		return this.queries.raycastBatch(rays, options, out);
	}

	/**
	 * Finds the objects and instance rows on the layers of `options.layers` that have a triangle
	 * within `radius` meters of `center`, writes them into `out`, and returns how many. It fills
	 * `out` as `raycastAll` fills its hits, in no set order.
	 */
	overlapSphere(
		center: Vec3Like,
		radius: number,
		options: QueryOptions | undefined,
		out: OverlapHit[],
	): number {
		return this.queries.overlapSphere(center, radius, options, out);
	}

	/**
	 * Finds the objects and instance rows on the layers of `options.layers` that have a triangle
	 * inside the box from `min` to `max` or crossing it, as `overlapSphere` does. The box's sides
	 * lie along the world's axes.
	 */
	overlapBox(
		min: Vec3Like,
		max: Vec3Like,
		options: QueryOptions | undefined,
		out: OverlapHit[],
	): number {
		return this.queries.overlapBox(min, max, options, out);
	}

	/**
	 * Builds every GPU pipeline that the scene needs as it stands, and resolves once they are all
	 * built. Hidden objects count too. After the first frame, an object whose pipeline is still
	 * building draws nothing, so create a loading stage's objects hidden, warm up, then show them.
	 * The first frame waits for its pipelines anyway. In the setup, a warm-up draws that frame once
	 * they are built, before the setup goes on.
	 */
	warmUp(): Promise<void> {
		return this.warmUpScene();
	}
}
