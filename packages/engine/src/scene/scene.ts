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
import type { ErrorCode } from '../errors/fixes';
import { reasonOf } from '../errors/message';
import * as C from '../generated/core';
import {
	compose as composeMatrix,
	copy as copyMatrix,
	decompose,
	identity as identityMatrix,
	multiply as multiplyMatrices,
} from '../math/mat4';
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
import { controlViews, createControlBuffer } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import type { Animator, SceneAnimations } from './animation';
import { type ColorInput, linearColor } from './color';
import { type Environment, type EnvironmentOptions, SceneEnvironment } from './environment';
import { type FogOptions, setSceneFog } from './fog';
import {
	FrameCameras,
	LENS_CENTER_X,
	LENS_CENTER_Y,
	LENS_FAR,
	LENS_FLOATS,
	LENS_HALF_HEIGHT,
	LENS_HALF_WIDTH,
	LENS_NEAR,
	LENS_ORTHO,
	type Ray,
} from './frame-cameras';
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
import type { LineBatch, LineChecks, LineMode, LineOptions, LineValues } from './lines';
import type { CoreMemory } from './memory';
import {
	type ObjectEventHandler,
	type ObjectEventType,
	PointerEvents,
	type PointerInput,
	type PointerListeners,
	type PointerTarget,
} from './pointer-events';
import type { InstancingTemplate, PartTemplate, Prefab, TemplateNode } from './prefab';
import {
	type OverlapHit,
	type QueryOptions,
	type RaycastBatchHits,
	type RaycastHit,
	type RaycastOptions,
	SceneQueries,
} from './queries';
import type { AlphaMode, Material, MeshGeometry } from './resources';
import { quaternionLookAt } from './rotation';
import type {
	PointBatch,
	PointChecks,
	PointOptions,
	SpriteBatch,
	SpriteLook,
	SpriteMakers,
	SpriteOptions,
} from './sprites';
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
	/**
	 * True makes the mesh block the view for software occlusion culling on WebGL2, like
	 * `setOccluder(true)`. The default is false.
	 */
	occluder?: boolean;
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
	/**
	 * The point that every row's position is relative to. The default is (0, 0, 0). The engine keeps
	 * the origin at full precision, so rows near it keep the precision of 32-bit floats at any
	 * distance from the world's origin. Give a batch far from the origin, such as a forest on a
	 * planet, an origin among its rows.
	 */
	origin?: Vec3;
}

/**
 * Options for `scene.instantiate`: where the copy's group goes, and settings for all its meshes.
 *
 * @category api/scene
 */
export interface InstantiateOptions extends NodeOptions {
	/** True makes every mesh of the copy cast the shadows of a directional light. The default is false. */
	castShadows?: boolean;
	/** True makes shadows fall on every mesh of the copy. The default is false. */
	receiveShadows?: boolean;
	/**
	 * True makes every mesh of the copy block the view for software occlusion culling on WebGL2,
	 * like `setOccluder(true)`, and false makes none block. Left out, the meshes that the asset
	 * tool gave blockers block, and the others do not.
	 */
	occluder?: boolean;
	/**
	 * The layers of every object of the copy and of its instance batches, as a 32-bit mask. Left
	 * out, they keep the default, 1, which is layer 0.
	 */
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
	/**
	 * A factor that scales the color, in three.js's units unless the options name another unit.
	 * The default is 1.
	 */
	intensity?: number;
}

/**
 * Options for `scene.createAmbientLight`.
 *
 * @category api/lights
 */
export interface AmbientLightOptions extends LightOptions {
	/**
	 * The unit of the intensity: `'lux'`, the light that reaches every surface. It is three.js's
	 * unit too, so the intensity stays as it is.
	 */
	intensityUnit?: 'lux';
}

/**
 * Options for `scene.createDirectionalLight`.
 *
 * @category api/lights
 */
export interface DirectionalLightOptions extends LightOptions {
	/**
	 * The unit of the intensity: `'lux'`, the light that reaches a surface facing the light, such
	 * as 100,000 for direct sunlight. It is three.js's unit too, so the intensity stays as it is.
	 */
	intensityUnit?: 'lux';
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
	 * The unit of the intensity and of `setIntensity`: `'lumen'`, the light's whole output, such
	 * as 800 for a 60 W bulb. The engine divides it by 4π for a point light, and by π for a spot
	 * light at any cone angle, as three.js's `power` and Filament do. Without it, the intensity is
	 * in candela, three.js's unit.
	 */
	intensityUnit?: 'lumen';
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
	/**
	 * The unit of the intensity: `'lux'`, the light that reaches a surface. It is three.js's unit
	 * too, so the intensity stays as it is.
	 */
	intensityUnit?: 'lux';
}

/** The options of any light, as the scene's shared create path reads them. */
type AnyLightOptions = LightOptions &
	Partial<Omit<SpotLightOptions, keyof LightOptions | 'intensityUnit'>> &
	Pick<DirectionalLightOptions, 'shadow'> & { intensityUnit?: 'lumen' | 'lux' };

/**
 * The candela of one lumen of a point or spot light, by kind, as three.js's `power` and Filament
 * convert them: a point light spreads its lumens over the whole sphere, 4π steradians, and a spot
 * light over π, whatever its cone, so a narrower cone keeps the light's brightness.
 */
const CANDELA_PER_LUMEN: Readonly<Record<number, number>> = {
	[C.LIGHT_KIND_POINT]: 1 / (4 * Math.PI),
	[C.LIGHT_KIND_SPOT]: 1 / Math.PI,
};

/** The unit that each kind of light takes besides three.js's own. */
const LIGHT_UNITS: Readonly<Record<number, 'lumen' | 'lux'>> = {
	[C.LIGHT_KIND_DIRECTIONAL]: 'lux',
	[C.LIGHT_KIND_POINT]: 'lumen',
	[C.LIGHT_KIND_SPOT]: 'lumen',
	[C.LIGHT_KIND_HEMISPHERE]: 'lux',
	[C.LIGHT_KIND_AMBIENT]: 'lux',
};

/**
 * The factor that turns an intensity in `unit` into three.js's unit for a light of `kind`: candela
 * for point and spot lights, and lux for the others. Without a unit, or in lux, the factor is 1.
 */
function intensityScale(kind: number, unit: 'lumen' | 'lux' | undefined): number {
	return unit === 'lumen' ? (CANDELA_PER_LUMEN[kind] ?? 1) : 1;
}

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

/** The point (0, 0, 0), for objects created without a position. */
const ORIGIN: Vec3 = [0, 0, 0];

/**
 * Writes `value` at `i` as a whole number of cells in `cells` and the rest in `rest`, as the engine
 * core splits a 64-bit position: the nearest whole number of cells, so the rest is about half a
 * cell long at most, and a 32-bit float holds it to 0.03 mm or better.
 */
function splitPosition(rest: Float32Array, cells: Int32Array, i: number, value: number): void {
	const cell = Math.floor(value / C.CELL_SIZE + 0.5);
	cells[i] = cell;
	rest[i] = value - cell * C.CELL_SIZE;
}

/** Views of the per-slot arrays and the command ring. */
class SceneViews {
	/** Positions, 3 per slot: in large-world mode, the part that `positionCells` leaves. */
	readonly positions: Float32Array;
	/**
	 * In large-world mode, the whole cells of each position, 3 per slot: a position is these cells
	 * times the cell's size plus its 32-bit part. Undefined without the mode.
	 */
	readonly positionCells: Int32Array | undefined;
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
		const cells = glue.sceneArrays(C.SCENE_FIELD_POSITION_CELLS);
		this.positionCells = cells ? core.i32(cells, rows * 3) : undefined;
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
	/**
	 * @internal The object's parent, as its create options or its last `setParent` gave it. A
	 * destroyed parent leaves the object a root, as in the engine core. `attachTo` sets it.
	 */
	parentObject: Object3D | null = null;
	/**
	 * @internal The objects whose `parentObject` this object is, from its first child on, so
	 * `scene.clone` walks a tree without a pass over the scene. Destroyed children leave it.
	 */
	childObjects: Set<Object3D> | undefined;
	/** @internal The object's flags (`FLAG_*`), as its create options and its setters gave them. */
	flags: number = C.FLAG_VISIBLE;
	/** @internal The object's layer mask, as its create options and `setLayers` gave it. */
	layerMask: number = C.LAYERS_DEFAULT;
	/** @internal The object's animator, when a model with animations created the object. */
	animation: Animator | undefined;
	/** @internal The object's pointer event handlers, from its first `on`. */
	pointerListeners: PointerListeners | undefined = undefined;

	/** @internal */
	constructor(
		/** @internal */ readonly scene: Scene,
		/**
		 * @internal The object's handle. Once the object is destroyed, it holds a generation that the
		 * core never gives a live object, so a later call never reaches another object in its slot.
		 */
		public handle: number,
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
		this.scene.writePosition(this.row, x, y, z);
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
		const eye = this.scene.eye;
		this.scene.readPosition(this.row, eye);
		const target = this.scene.target;
		target[0] = x;
		target[1] = y;
		target[2] = z;
		quaternionLookAt(this.scene.scratch, eye, target, this.looksDownMinusZ);
		this.scene.views.rotations.set(this.scene.scratch, this.row * 4);
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
		const p = scene.target;
		scene.readPosition(this.row, p);
		scene.writePosition(
			this.row,
			(p[0] as number) + (v[0] as number),
			(p[1] as number) + (v[1] as number),
			(p[2] as number) + (v[2] as number),
		);
		scene.markDirty(this.row);
	}

	/** Copies the position relative to the parent into `out`. */
	getPosition(out: Vec3Like): void {
		if (DEV) checkLive('getPosition', this);
		this.scene.readPosition(this.row, out);
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
		this.attachTo(parent);
	}

	/** @internal Records `parent` as the object's parent, in both objects. */
	attachTo(parent: Object3D | null): void {
		this.parentObject?.childObjects?.delete(this);
		this.parentObject = parent;
		if (parent) {
			parent.childObjects ??= new Set();
			parent.childObjects.add(this);
		}
	}

	/** @internal The live parent, or null for a root. */
	get liveParent(): Object3D | null {
		const parent = this.parentObject;
		return parent && parent.destroyedFrame === -1 ? parent : null;
	}

	/**
	 * @internal A new wrapper of the same kind for the object with `handle`, with the settings that
	 * live on the wrapper, for `scene.clone`.
	 */
	twin(handle: number): Object3D {
		const kind = this.constructor as ObjectClass<Object3D>;
		return new kind(this.scene, handle, this.name);
	}

	/** @internal Sets or clears flags on the wrapper's copy of the object's flags. */
	keepFlag(flag: number, on: boolean): void {
		this.flags = on ? this.flags | flag : this.flags & ~flag;
	}

	/** Hides or shows the object and everything under it. */
	setVisible(visible: boolean): void {
		if (DEV) checkLive('setVisible', this);
		this.scene.command(C.COMMAND_SET_VISIBLE, this.handle, visible ? 1 : 0, 0, 'setVisible');
		this.keepFlag(C.FLAG_VISIBLE, visible);
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
		this.layerMask = mask >>> 0;
	}

	/** Makes the object dynamic or static from the next frame. See `NodeOptions.dynamic`. */
	setDynamic(dynamic: boolean): void {
		if (DEV) {
			checkLive('setDynamic', this);
			this.scene.unmarkedWrites?.watch(this, !dynamic);
		}
		this.scene.command(C.COMMAND_SET_DYNAMIC, this.handle, dynamic ? 1 : 0, 0, 'setDynamic');
		this.keepFlag(C.FLAG_DYNAMIC, dynamic);
	}

	/**
	 * The object's animator, which plays the clips of the model that created the object. An object
	 * without animation clips has none, and the call throws.
	 */
	animator(): Animator {
		if (DEV) checkLive('animator', this);
		if (this.animation === undefined)
			throw new EngineError(
				'E1218',
				`animator() was called on ${this.describe()}, which has no animation clips.`,
			);
		return this.animation;
	}

	/** Removes the object at the next frame. Its children become roots. */
	destroy(): void {
		if (DEV) {
			checkLive('destroy', this);
			this.scene.unmarkedWrites?.watch(this, false);
		}
		this.animation?.release();
		this.scene.forgetListeners(this);
		// The core checks the handle's generation, so a second destroy frees no other object, even
		// once the slot's generations have come round.
		this.scene.command(C.COMMAND_DESTROY, this.handle, 0, 0, 'destroy');
		this.destroyedFrame = this.scene.frame;
		this.row = 0;
		this.parentObject?.childObjects?.delete(this);
		this.scene.forget(this);
		this.handle |= C.HANDLE_DEAD_GENERATION << C.HANDLE_SLOT_BITS;
	}

	/**
	 * Calls `handler` for each pointer event of `type` on the object: 'click', 'pointerdown',
	 * 'pointerup', 'pointermove', 'pointerenter' or 'pointerleave'. An event on a child goes on to
	 * its parents, so a handler on a model's group hears clicks on all its parts. The engine casts
	 * a ray from the frame that was on screen at each event, against objects where they are now.
	 * Handlers run on the sketch's thread at the start of the next frame, before `onUpdate`.
	 */
	on(type: ObjectEventType, handler: ObjectEventHandler): void {
		if (DEV) checkLive('on', this);
		this.scene.pointerEvents.add(this, type, handler);
	}

	/** Removes a handler that `on` added for events of `type`. */
	off(type: ObjectEventType, handler: ObjectEventHandler): void {
		this.scene.pointerEvents.remove(this, type, handler);
	}

	/** @internal The parent that the object's pointer events go on to. */
	pointerParent(): PointerTarget | null {
		return this.liveParent;
	}

	/** @internal Sets or clears one of the object's flags from the next frame. */
	protected setFlag(call: string, flag: number, on: boolean): void {
		if (DEV) checkLive(call, this);
		this.scene.command(C.COMMAND_SET_FLAGS, this.handle, flag, on ? flag : 0, call);
		this.keepFlag(flag, on);
	}
}

/**
 * An empty node, for hierarchy.
 *
 * @category api/objects
 */
export class Group extends Object3D {}

/**
 * The group that holds a copy of a model, which `scene.instantiate` returns. Its children are the
 * copies of the file's root nodes.
 *
 * @category api/scene
 */
export class PrefabInstance extends Group {
	/** @internal The copy's objects: this group, then one for each node, in the file's order. */
	objects: readonly Object3D[] = [];
	/**
	 * The instance batches of the nodes with instancing of their own, as the file gives them. Their
	 * rows are placed in the world when the copy is created, and they do not move with the group.
	 */
	batches: readonly InstanceBatch[] = [];

	/**
	 * The copy's first object with `name`, in the file's order, which is not destroyed, or
	 * undefined. It searches the copy's objects, so call it at setup.
	 */
	find(name: string): Object3D | undefined {
		for (const object of this.objects)
			if (object !== this && object.name === name && object.destroyedFrame === -1) return object;
		return undefined;
	}

	/**
	 * Removes the whole copy at the next frame: this group, every object that the copy created and
	 * that is not destroyed yet, and its instance batches. Objects that the sketch put under the
	 * copy later become roots, as children of any destroyed object do.
	 */
	override destroy(): void {
		super.destroy();
		for (const object of this.objects)
			if (object !== this && object.destroyedFrame < 0) object.destroy();
		for (const batch of this.batches) if (batch.destroyedFrame < 0) batch.destroy();
	}

	/**
	 * Outlines every mesh of the copy, or stops, as `Mesh.setOutlined` does for one mesh: the
	 * whole model takes one outline, as three.js's `OutlinePass` outlines a selected group. The
	 * copy's instance batches take none.
	 */
	setOutlined(outlined: boolean): void {
		for (const object of this.objects)
			if (object instanceof Mesh && object.destroyedFrame < 0) object.setOutlined(outlined);
	}
}

/**
 * A drawn object: a mesh and a material.
 *
 * @category api/objects
 */
export class Mesh extends Object3D {
	/** @internal The shape, as the create options or `setMesh` gave it. */
	mesh: MeshGeometry | undefined;
	/** @internal The material, as the create options or `setMaterial` gave it. */
	material: Material | undefined;
	/** @internal The render order, as `setRenderOrder` gave it. */
	renderOrder = 0;
	/** @internal The mesh's block of morph weights in the engine core, plus one, or 0 for none. */
	morphBlock = 0;
	/** @internal The place of the block's first weight in the core's table of morph weights. */
	morphFirst = 0;
	/** @internal The weights that the block holds: the mesh's morph targets, or 0. */
	morphCount = 0;
	/**
	 * @internal The first joint of the model's skeleton that animates the weights, or -1 when no
	 * clip of the model animates them.
	 */
	morphJoint = -1;

	/** @internal */
	override twin(handle: number): Object3D {
		const twin = super.twin(handle) as Mesh;
		twin.mesh = this.mesh;
		twin.material = this.material;
		twin.renderOrder = this.renderOrder;
		twin.morphJoint = this.morphJoint;
		return twin;
	}

	/**
	 * Sets how far the mesh moves toward one of its morph targets, from the next frame: 0 keeps
	 * the target's shape out, 1 adds all of it, and other numbers scale it. Like setting three.js's
	 * `morphTargetInfluences[target]`. `target` is the target's number, from 0, or its name. A clip
	 * that animates the weight blends its own value with this one while it plays, as three.js's
	 * mixer does, and this one holds when no clip moves it. A WebGL2 device draws a preset's count
	 * of each mesh's largest weights (the `morphTargets` quality setting). Throws E1218 for a
	 * target that the mesh does not have, and E1203 for a weight that is not a finite number.
	 */
	setMorphWeight(target: number | string, weight: number): void {
		const k = this.morphIndex('setMorphWeight', target);
		if (DEV) checkNumber('setMorphWeight', 'weight', weight, this);
		this.scene.morphWeights()[this.morphFirst + k] = weight;
	}

	/**
	 * The weight of one of the mesh's morph targets, as `setMorphWeight` or the model's file set
	 * it, without what a playing clip adds. Throws E1218 for a target that the mesh does not have.
	 */
	getMorphWeight(target: number | string): number {
		return this.scene.morphWeights()[
			this.morphFirst + this.morphIndex('getMorphWeight', target)
		] as number;
	}

	/**
	 * The number of the morph target that `target` names. A whole number below the target count
	 * takes the short path, which the browser can inline into a sketch's frame code.
	 */
	private morphIndex(call: string, target: number | string): number {
		return typeof target === 'number' && target >>> 0 === target && target < this.morphCount
			? target
			: this.morphTarget(call, target);
	}

	/** The number of a morph target that `target` names, or E1218 when the mesh lacks it. */
	private morphTarget(call: string, target: number | string): number {
		if (DEV) checkLive(call, this);
		const names = this.mesh?.morphTargetNames ?? [];
		const k = typeof target === 'string' ? names.indexOf(target) : target;
		if (Number.isInteger(k) && k >= 0 && k < this.morphCount) return k;
		const has =
			this.morphCount === 0
				? 'which has no morph targets'
				: `which has ${this.morphCount} morph targets${names.length > 0 ? `: ${names.join(', ')}` : ''}`;
		throw new EngineError(
			'E1218',
			`${call}() got ${typeof target === 'string' ? `"${target}"` : target}, which names no morph target of ${this.describe()}, ${has}.`,
		);
	}

	/** Removes the object at the next frame, and frees its morph weights. Its children become roots. */
	override destroy(): void {
		super.destroy();
		this.scene.releaseMorph(this);
	}

	/** Changes the material from the next frame. */
	setMaterial(material: Material): void {
		if (DEV) {
			checkLive('setMaterial', this);
			checkSameEngine('setMaterial', 'material', material.core, this.scene);
		}
		this.scene.command(C.COMMAND_SET_MATERIAL, this.handle, material.id, 0, 'setMaterial');
		this.material = material;
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
		this.mesh = mesh;
		this.keepFlag(C.FLAG_CUSTOM_BOUNDS, false);
		// A mesh of as many morph targets keeps its weights; another gets weights of its own.
		if (mesh.morphTargets !== this.morphCount) {
			this.scene.releaseMorph(this);
			const block = this.scene.makeMorph(this, mesh, undefined, 'setMesh');
			if (block !== 0) this.scene.command(C.COMMAND_SET_MORPH, this.handle, block, 0, 'setMesh');
		}
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
	 * Draws an outline around the mesh, or stops, as adding it to three.js's
	 * `OutlinePass.selectedObjects` does. The outline shows while `post.set({ outline })` turns
	 * outlines on, and every outlined mesh takes its settings. The default is false. A change
	 * rebuilds the engine's tables of what it draws, as a new material does.
	 */
	setOutlined(outlined: boolean): void {
		this.setFlag('setOutlined', C.FLAG_OUTLINED, outlined);
	}

	/**
	 * Makes the mesh block the view, or stop. The default is false, except for the meshes of a
	 * model file that the asset tool gave blockers. On WebGL2, while the `softwareOcclusion`
	 * quality setting is on, the job workers draw each blocker into a small depth buffer every
	 * frame, and the engine skips every object that lies wholly behind the blockers. Mark large,
	 * solid meshes that hide much of the scene, such as buildings and walls, whose mesh has at most
	 * 4,096 triangles. A mesh that the asset tool gave a blocker draws that blocker instead, a few
	 * boxes inside the mesh, whatever the mesh's own size. A blocker's mesh must lie inside what
	 * the object draws, as the object's own mesh does. Objects that blend, cut holes with an alpha
	 * mask, use a custom material or are skinned never block, whatever this says. WebGPU culls
	 * hidden objects on the GPU, and ignores it. A change needs no rebuild of the engine's tables.
	 */
	setOccluder(occluder: boolean): void {
		this.setFlag('setOccluder', C.FLAG_OCCLUDER, occluder);
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
		this.renderOrder = order;
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
	kind: 'mesh' | 'material' | 'model',
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
	/** @internal The lens as the frame cameras keep it, which `updateLens` writes. */
	readonly lens = new Float64Array(LENS_FLOATS);

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
	 * Writes the ray from the camera through a point on the canvas into `out`: `x` and `y` are CSS
	 * pixels from the canvas's top-left corner, as `input.pointer` gives them. A perspective ray
	 * starts at the camera, and an orthographic ray on the near plane. The direction has length 1.
	 *
	 * When the point is the position of the pointer or a finger from `input`, the ray uses the
	 * camera of the frame that was on screen at that event, if the engine still keeps it. It keeps
	 * the last four views, and frames in a row with the same view count as one. So a click during
	 * a fast pan picks what the user saw. Any other point uses the camera of the
	 * frame that last ran, with its lens as it is now. Objects stay where they are now, so a moving
	 * object can be up to a frame of its motion away from where the user saw it.
	 */
	screenToRay(x: number, y: number, out: Ray): void {
		if (DEV) {
			checkLive('screenToRay', this);
			checkNumber('screenToRay', 'x', x, this);
			checkNumber('screenToRay', 'y', y, this);
		}
		this.scene.frameCameras.screenToRay(this, x, y, out, 'screenToRay');
	}

	/**
	 * Writes where a point in the world lies on the canvas into `out`: x and y in CSS pixels from the
	 * canvas's top-left corner, then the point's depth, its distance in front of the camera along the
	 * view. A depth below 0 puts the point behind the camera, where x and y have no meaning. It uses
	 * the camera of the frame that last ran, with its lens as it is now, so in `onLateUpdate` it
	 * places points where the frame draws them.
	 */
	worldToScreen(point: Vec3Like, out: Vec3Like): void {
		if (DEV) {
			checkLive('worldToScreen', this);
			checkVector(
				'worldToScreen',
				this,
				point[0] as number,
				point[1] as number,
				point[2] as number,
			);
		}
		this.scene.frameCameras.worldToScreen(this, point, out, 'worldToScreen');
	}

	/** @internal Writes the lens into `lens`, after each change of its values. */
	updateLens(): void {
		const lens = this.lens;
		this.writeLensShape(lens);
		lens[LENS_NEAR] = this.nearPlane;
		lens[LENS_FAR] = this.farPlane;
	}

	/** @internal Writes the lens's kind, its view's size and its center into `lens`. */
	protected abstract writeLensShape(lens: Float64Array): void;

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
		this.updateLens();
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
	protected writeLensShape(lens: Float64Array): void {
		lens[LENS_ORTHO] = 0;
		lens[LENS_HALF_HEIGHT] = Math.tan((this.verticalFov * Math.PI) / 360);
		lens[LENS_HALF_WIDTH] = 0;
		lens[LENS_CENTER_X] = 0;
		lens[LENS_CENTER_Y] = 0;
	}

	/** @internal */
	override twin(handle: number): Object3D {
		const twin = new PerspectiveCamera(
			this.scene,
			handle,
			this.name,
			this.verticalFov,
			this.near,
			this.far,
		);
		twin.layers = this.layers;
		return twin;
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
		this.updateLens();
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
	protected writeLensShape(lens: Float64Array): void {
		const view = this.view;
		lens[LENS_ORTHO] = 1;
		lens[LENS_HALF_HEIGHT] = view.height / 2;
		lens[LENS_HALF_WIDTH] = view.width / 2;
		lens[LENS_CENTER_X] = view.centerX;
		lens[LENS_CENTER_Y] = view.centerY;
	}

	/** @internal */
	override twin(handle: number): Object3D {
		const twin = new OrthographicCamera(
			this.scene,
			handle,
			this.name,
			{ ...this.view },
			this.near,
			this.far,
		);
		twin.layers = this.layers;
		return twin;
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
	/**
	 * @internal What an intensity in the light's unit is in three.js's unit: 1, or the candela of
	 * one lumen for a point or spot light in lumens.
	 */
	unitScale = 1;

	protected override get looksDownMinusZ(): boolean {
		return true;
	}

	/** @internal */
	override twin(handle: number): Object3D {
		const twin = super.twin(handle) as Light;
		const { core } = this.scene;
		twin.id = core.checkGrowth(core.glue.copyLight(this.id, handle), 'clone', this.label);
		twin.linear.set(this.linear);
		twin.unitScale = this.unitScale;
		return twin;
	}

	/** Sets the color. Converting a color allocates, so per-frame code sets the intensity instead. */
	setColor(color: ColorInput): void {
		this.paint('setColor', C.LIGHT_COLOR_MAIN, color);
	}

	/** Sets the factor that scales the color, in the unit that the light was created with. */
	setIntensity(intensity: number): void {
		this.write('setIntensity', C.LIGHT_VALUE_INTENSITY, intensity * this.unitScale);
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
	/** @internal The batch's pointer event handlers, from its first `on`. */
	pointerListeners: PointerListeners | undefined = undefined;

	/** @internal */
	constructor(
		private readonly scene: Scene,
		/** @internal */ readonly id: number,
		/** The number of rows: the batch's capacity. */
		readonly count: number,
		private readonly hasColors: boolean,
		/** @internal The batches of a model's other meshes, which read this batch's rows. */
		readonly parts: readonly number[] = [],
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
		for (const part of this.parts) core.glue.setBatchLayers(part, mask >>> 0);
	}

	/**
	 * Calls `handler` for each pointer event of `type` on a row of the batch, as `Object3D.on` does.
	 * The event's `instance` names the row.
	 */
	on(type: ObjectEventType, handler: ObjectEventHandler): void {
		if (DEV) checkLive('on', { destroyedFrame: this.destroyedFrame, describe: () => 'a batch' });
		this.scene.pointerEvents.add(this, type, handler);
	}

	/** Removes a handler that `on` added for events of `type`. */
	off(type: ObjectEventType, handler: ObjectEventHandler): void {
		this.scene.pointerEvents.remove(this, type, handler);
	}

	/** @internal A batch has no parent for its pointer events to go on to. */
	pointerParent(): PointerTarget | null {
		return null;
	}

	/** @internal Places the origin that the rows of the batch and of its parts are relative to. */
	setOrigin([x, y, z]: Vec3, call: string): void {
		const { core } = this.scene;
		core.check(core.glue.setBatchOrigin(this.id, x, y, z), call, undefined, true);
		for (const part of this.parts) core.glue.setBatchOrigin(part, x, y, z);
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
		for (const part of this.parts) core.glue.destroyBatch(part, this.scene.frame);
		if (DEV) this.scene.countBatchRows(-this.count * (1 + this.parts.length));
		this.scene.forgetListeners(this);
		this.destroyedFrame = this.scene.frame;
		// The next read of the arrays asks the core for them again, and the core refuses a
		// destroyed batch.
		this.generation = -1;
	}
}

/** The class of each kind of light that a model's node can create, by the core's light kind. */
const LIGHT_CLASSES: Readonly<Record<number, ObjectClass<Light>>> = {
	[C.LIGHT_KIND_DIRECTIONAL]: DirectionalLight,
	[C.LIGHT_KIND_POINT]: PointLight,
	[C.LIGHT_KIND_SPOT]: SpotLight,
};

/** Imports the sprite code, which a page downloads with its first sprite batch, or throws E1406. */
async function loadSprites(call: string): Promise<typeof import('./sprites')> {
	try {
		return await import('./sprites');
	} catch (error) {
		throw new EngineError(
			'E1406',
			`the sprite code did not download for ${call}(): ${reasonOf(error)}.`,
		);
	}
}

/** Imports the line code, which a page downloads with its first line batch, or throws E1406. */
async function loadLines(call: string): Promise<typeof import('./lines')> {
	try {
		return await import('./lines');
	} catch (error) {
		throw new EngineError(
			'E1406',
			`the line code did not download for ${call}(): ${reasonOf(error)}.`,
		);
	}
}

/** The segments that each line mode makes of a number of points. */
const LINE_SEGMENTS: Readonly<Record<LineMode, (points: number) => number>> = {
	segments: (points) => Math.floor(points / 2),
	strip: (points) => Math.max(points - 1, 0),
	loop: (points) => (points >= 2 ? points : 0),
};

/**
 * The number of points of `scene.createLines`, after checking that they make a line: whole points,
 * at least one segment, and one color for each point. Throws E1217 for an unknown mode and E1206
 * for points or colors that make no line, and in development builds, for numbers that are not
 * finite.
 */
function linePoints(
	call: string,
	mode: LineMode,
	positions: ArrayLike<number>,
	colors: ArrayLike<number> | undefined,
): number {
	if (!Object.hasOwn(LINE_SEGMENTS, mode))
		throw new EngineError(
			'E1217',
			`${call}() got the mode ${JSON.stringify(mode)}; it takes 'segments', 'strip' or 'loop'.`,
		);
	const points = positions.length / 3;
	const bad = (problem: string) => new EngineError('E1206', `${call}() got ${problem}.`);
	if (!Number.isInteger(points) || LINE_SEGMENTS[mode](points) < 1)
		throw bad(
			`${positions.length} numbers in positions; a ${mode} line takes 3 numbers per point, and at least 2 points`,
		);
	if (mode === 'segments' && points % 2 !== 0)
		throw bad(`${points} points for segments, which join points in pairs`);
	if (colors && colors.length !== positions.length)
		throw bad(`${colors.length} numbers in colors for ${points} points, not ${positions.length}`);
	checkFinitePoints(call, positions, colors);
	return points;
}

/**
 * The points of `scene.createPoints`'s arrays: 3 numbers per point in `positions`, and 3 or 4 in
 * `colors`. Throws E1206 for arrays that make no points.
 */
function pointCount(
	call: string,
	positions: ArrayLike<number>,
	colors: ArrayLike<number> | undefined,
): number {
	const points = positions.length / 3;
	if (!Number.isInteger(points) || points < 1)
		throw new EngineError(
			'E1206',
			`${call}() got ${positions.length} numbers in positions; points take 3 numbers each, and at least 1 point.`,
		);
	if (colors && colors.length !== points * 3 && colors.length !== points * 4)
		throw new EngineError(
			'E1206',
			`${call}() got ${colors.length} numbers in colors for ${points} points, not ${points * 3} or ${points * 4}.`,
		);
	checkFinitePoints(call, positions, colors);
	return points;
}

/** Development builds: throws E1206 for a number of `positions` or `colors` that is not finite. */
function checkFinitePoints(
	call: string,
	positions: ArrayLike<number>,
	colors: ArrayLike<number> | undefined,
): void {
	if (!DEV) return;
	for (const [name, values] of [
		['positions', positions],
		['colors', colors ?? []],
	] as const)
		for (let k = 0; k < values.length; k++)
			if (!Number.isFinite(values[k]))
				throw new EngineError('E1206', `${call}() got ${values[k]} at index ${k} of ${name}.`);
}

/** Development builds: throws E1203 for a `name` value that is not finite, and E1108 for one not above 0. */
function checkPositive(call: string, name: string, value: number): void {
	if (!DEV) return;
	if (!Number.isFinite(value))
		throw new EngineError('E1203', `${call}() got ${value} for ${name}.`);
	if (!(value > 0))
		throw new EngineError(
			'E1108',
			`${call}() got the ${name} ${value}; it takes a number above 0.`,
		);
}

/** The checks of line batches' calls, which the line code takes from the scene. */
const LINE_CHECKS: LineChecks = {
	width(width: number, call: string): void {
		checkPositive(call, 'width', width);
	},
	values(values: LineValues, call: string): void {
		if (!DEV) return;
		for (const key of ['dashSize', 'gapSize', 'dashScale', 'dashOffset'] as const) {
			const value = values[key];
			if (value === undefined) continue;
			if (!Number.isFinite(value))
				throw new EngineError('E1203', `${call}() got ${value} for ${key}.`);
			if (key !== 'dashOffset' && value < 0)
				throw new EngineError('E1108', `${call}() got the ${key} ${value}; it takes 0 or more.`);
		}
	},
};

/** The checks of a point batch's later calls. */
const POINT_CHECKS: PointChecks = {
	size(size: number, call: string): void {
		checkPositive(call, 'size', size);
	},
};

/**
 * The transform of a model's copy: the position, rotation and scale of `options`, with the position
 * at full precision.
 */
function rootTransform(options: NodeOptions): Float64Array {
	const transform = new Float64Array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
	if (options.position) transform.set(options.position, 0);
	if (options.rotation) transform.set(options.rotation, 3);
	if (options.scale) transform.set(options.scale, 7);
	return transform;
}

/**
 * @internal The scene API's checks and errors, which code that loads on first use, such as the
 * animator, takes from the scene. That code imports no engine module but constants, so a bundle
 * never moves these modules into a file of their own, which every page would download at its start.
 */
export const SCENE_CHECKS = {
	// Code that takes these calls them in development builds only, so release builds hold none.
	checkLive: DEV ? checkLive : () => {},
	checkNumber: DEV ? checkNumber : () => {},
	error: (code: ErrorCode, message: string): EngineError => new EngineError(code, message),
};

/** @internal The type of `SCENE_CHECKS`. */
export type SceneChecks = typeof SCENE_CHECKS;

/**
 * The scene: every object, the active camera, the lights and the background.
 *
 * @category api/scene
 */
export class Scene {
	/** @internal The scene API's checks and errors, for code that loads on first use. */
	readonly checks: SceneChecks = SCENE_CHECKS;
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
	/** The quad meshes of sprite batches, by their center, which batches with one center share. */
	private readonly spriteQuads = new Map<string, MeshGeometry>();
	/** The segment mesh of line batches, which every line batch shares, made with the first. */
	private lineMesh: MeshGeometry | undefined;
	/** Raycasts and overlap queries, made on the first query. */
	private sceneQueries: SceneQueries | undefined;
	/** The environment's values in the core, made on the first `setEnvironment`. */
	private sceneEnvironment: SceneEnvironment | undefined;
	/** Pointer events on objects, made on the first `on`. */
	private objectEvents: PointerEvents | undefined;
	/** Rows of the live instance batches, which development builds count. */
	private batchRows = 0;
	/** @internal The batches of command records published so far, which tests count. */
	commandBatches = 0;
	private warnedPastPortable = false;
	/**
	 * @internal Development builds: finds static objects whose transform changed without a setter.
	 * Declared without a value, so release builds hold no trace of it.
	 */
	declare readonly unmarkedWrites: UnmarkedWrites | undefined;
	/** @internal The scene's animated objects, from the first model with animations on. */
	animations: SceneAnimations | undefined;
	/** @internal True once an object has morph weights, so each frame's animation step runs. */
	morphed = false;
	/** The core's table of morph weights, made again after the engine's memory grew. */
	private morphTable: Float32Array = new Float32Array(0);
	private morphGeneration = -1;

	/** @internal */
	constructor(
		/** @internal */ readonly core: CoreMemory,
		private readonly time: { readonly frame: number },
		/** True when the engine draws with WebGL2, whose devices draw fewer rows than WebGPU's. */
		private readonly webgl2: boolean,
		private readonly warmUpScene: () => Promise<void> = () => Promise.resolve(),
		/** The cameras of the last frames, which the sketch runner gives; tests get a stand-in. */
		private cameras?: FrameCameras,
		/**
		 * What sprite and line batches make their meshes and materials with, which the sketch runner
		 * gives.
		 */
		private readonly makers?: SpriteMakers,
		/** The input reader, whose pointer events reach objects' handlers. */
		private readonly pointerInput?: PointerInput,
	) {
		if (DEV) this.unmarkedWrites = new UnmarkedWrites(this);
	}

	/** @internal The cameras of the last frames, for `screenToRay` and `worldToScreen`. */
	get frameCameras(): FrameCameras {
		this.cameras ??= new FrameCameras(this.core, controlViews(createControlBuffer(false)), {
			frameAt: () => -1,
		});
		return this.cameras;
	}

	/** @internal Pointer events on objects, made on the first call. */
	get pointerEvents(): PointerEvents {
		this.objectEvents ??= new PointerEvents(
			{ pick: (frame, numbers, ray) => this.pick(frame, numbers, ray) },
			this.pointerInput,
		);
		return this.objectEvents;
	}

	/**
	 * Casts the ray of a pointer event from the camera of engine frame `frame`, or from the active
	 * camera as it stands when the ring no longer holds the frame, on the camera's layers.
	 */
	private pick(frame: number, numbers: Float64Array, ray: Ray): PointerTarget | null {
		const camera = this.activeCamera;
		const live = camera !== undefined && camera.destroyedFrame === -1 ? camera : undefined;
		const layers = this.frameCameras.frameRay(frame, numbers, ray, live);
		return layers < 0 ? null : this.queries.pick(ray, layers, numbers);
	}

	/** @internal Calls the handlers of the pointer events that the input of this frame brought. */
	dispatchPointerEvents(report: (error: unknown) => void): void {
		this.objectEvents?.dispatch(report);
	}

	/** @internal Removes the pointer event handlers of an object or a batch that is destroyed. */
	forgetListeners(target: PointerTarget): void {
		if (target.pointerListeners !== undefined) this.objectEvents?.forget(target);
	}

	/**
	 * @internal Keeps the active camera of engine frame `frame`, which drew on a canvas of `width`
	 * by `height` device pixels, so rays from that frame's input use it. The engine's count includes
	 * the frames that ran no sketch code, such as the setup's.
	 */
	keepFrameCamera(frame: number, width: number, height: number): void {
		this.frameCameras.record(frame, this.activeCamera, width, height);
	}

	/** @internal */
	get frame(): number {
		return this.time.frame;
	}

	/** @internal The camera that the canvas shows, which each frame draws from. */
	get shownCamera(): Camera | undefined {
		return this.activeCamera;
	}

	/** @internal */
	get views(): SceneViews {
		if (this.viewsGeneration !== this.core.generation) {
			this.currentViews = new SceneViews(this.core);
			this.viewsGeneration = this.core.generation;
		}
		return this.currentViews;
	}

	/**
	 * @internal Writes the position of the object in `slot`, relative to its parent. In large-world
	 * mode it splits each number into whole cells and a rest of about half a cell at most, so the
	 * 32-bit rest keeps the number's full precision.
	 */
	writePosition(slot: number, x: number, y: number, z: number): void {
		const { positions, positionCells } = this.views;
		const i = slot * 3;
		if (positionCells === undefined) {
			positions[i] = x;
			positions[i + 1] = y;
			positions[i + 2] = z;
			return;
		}
		splitPosition(positions, positionCells, i, x);
		splitPosition(positions, positionCells, i + 1, y);
		splitPosition(positions, positionCells, i + 2, z);
	}

	/** @internal Copies the position of the object in `slot`, relative to its parent, into `out`. */
	readPosition(slot: number, out: Vec3Like): void {
		const { positions, positionCells } = this.views;
		const i = slot * 3;
		out[0] = positions[i] as number;
		out[1] = positions[i + 1] as number;
		out[2] = positions[i + 2] as number;
		if (positionCells === undefined) return;
		out[0] = (out[0] as number) + (positionCells[i] as number) * C.CELL_SIZE;
		out[1] = (out[1] as number) + (positionCells[i + 1] as number) * C.CELL_SIZE;
		out[2] = (out[2] as number) + (positionCells[i + 2] as number) * C.CELL_SIZE;
	}

	/** @internal Flags a static object for recomputation. */
	markDirty(slot: number): void {
		const dirty = this.views.dirty;
		dirty[slot >>> 5] = (dirty[slot >>> 5] as number) | (1 << (slot & 31));
	}

	/** @internal Appends a command record for the next frame. */
	command(op: number, handle: number, a: number, b: number, call: string): void {
		const write = this.reserveCommands(1, call);
		this.writeCommand(write, op, handle, a, b);
		this.publishCommands(write + 1);
	}

	/**
	 * The ring's write index, after a check that `count` more records fit. Throws E1102 when they
	 * do not, before anything is written.
	 */
	private reserveCommands(count: number, call: string): number {
		const v = this.views;
		const write = Atomics.load(v.writeIndex, 0);
		const read = Atomics.load(v.readIndex, 0);
		if (((write - read) >>> 0) + count > v.ringCapacity)
			throw new EngineError(
				'E1102',
				`${call}() failed: the command ring holds ${v.ringCapacity} changes for the next frame, and it has no room for ${count} more.`,
			);
		return write;
	}

	/** Writes a record at write index `at`, which the next publish makes visible. */
	private writeCommand(at: number, op: number, handle: number, a: number, b: number): void {
		const v = this.views;
		const i = (at & (v.ringCapacity - 1)) * C.COMMAND_WORDS;
		v.records[i] = op;
		v.records[i + 1] = handle;
		v.records[i + 2] = a;
		v.records[i + 3] = b;
	}

	/** Makes the records up to write index `end` visible to the core, as one batch. */
	private publishCommands(end: number): void {
		Atomics.store(this.views.writeIndex, 0, end >>> 0);
		this.commandBatches++;
	}

	/** @internal The world matrix of the frame that last ran: 12 numbers, row by row. */
	worldMatrix(object: Object3D, call: string): Float64Array {
		// The core's error adds the slot to the object's name.
		this.core.check(
			this.core.readWorldMatrix(object.handle, this.matrix),
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
	 * @internal The core's table of morph weights. Sketches set weights every frame, so the check
	 * stays small enough for the browser to inline into their code.
	 */
	morphWeights(): Float32Array {
		if (this.morphGeneration !== this.core.generation) this.morphView();
		return this.morphTable;
	}

	private morphView(): void {
		const { core } = this;
		this.morphTable = core.f32(core.glue.morphWeightsAddress(), C.MORPH_MAX_WEIGHTS);
		this.morphGeneration = core.generation;
	}

	/**
	 * @internal Gives `mesh` a block of morph weights for `geometry`'s targets, which start at
	 * `weights` or at 0, and returns the block's id plus one for its `SET_MORPH` command, or 0 for
	 * a geometry without morph targets.
	 */
	makeMorph(
		mesh: Mesh,
		geometry: MeshGeometry,
		weights: ArrayLike<number> | undefined,
		call: string,
	): number {
		const count = geometry.morphTargets;
		if (!count) return 0;
		const { core } = this;
		const block = core.checkGrowth(core.glue.createMorphWeights(count), call, mesh.label);
		this.morphed = true;
		mesh.morphBlock = block;
		mesh.morphFirst = core.glue.morphWeightsFirst(block - 1);
		mesh.morphCount = count;
		this.morphView();
		if (weights)
			for (let k = 0; k < count; k++) this.morphTable[mesh.morphFirst + k] = weights[k] ?? 0;
		return block;
	}

	/** @internal The weights of `mesh`'s block, copied, or none for a mesh without one. */
	morphWeightsOf(mesh: Mesh): Float32Array | undefined {
		if (mesh.morphBlock === 0) return undefined;
		return this.morphWeights().slice(mesh.morphFirst, mesh.morphFirst + mesh.morphCount);
	}

	/** @internal Frees `mesh`'s block of morph weights, if it has one. */
	releaseMorph(mesh: Mesh): void {
		if (mesh.morphBlock === 0) return;
		this.core.glue.destroyMorphWeights(mesh.morphBlock - 1);
		mesh.morphBlock = 0;
		mesh.morphCount = 0;
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

	/**
	 * Adds a new object to the index of slots that queries read, and to the index of names after
	 * those with its name.
	 */
	private remember(object: Object3D): void {
		this.objectSlots[object.slot] = object;
		const { name } = object;
		if (!name) return;
		const known = this.names.get(name);
		if (known === undefined) this.names.set(name, object);
		else if (known instanceof Set) known.add(object);
		else this.names.set(name, new Set([known, object]));
	}

	/** Adds a new batch to the index that queries read, by the slot of each of its core batches. */
	private rememberBatch(batch: InstanceBatch): void {
		this.batchSlots[batch.id & SLOT_MASK] = batch;
		for (const part of batch.parts) this.batchSlots[part & SLOT_MASK] = batch;
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
		camera.updateLens();
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
	 * `options`, its create command with `flags` besides visibility and `dynamic`, its layers, the
	 * material `material` names when it is not 0, and its wrapper, built with any further
	 * constructor arguments, which the index of names learns. It checks that the command ring has
	 * room for every record before it reserves the slot, and publishes the records at once, so a
	 * failure leaves nothing behind.
	 */
	private create<T extends Object3D, A extends unknown[]>(
		kind: ObjectClass<T, A>,
		options: NodeOptions,
		mesh: number,
		radius: number,
		flags: number,
		material: number,
		call: string,
		...extra: A
	): T {
		const { layers } = options;
		if (DEV) {
			if (options.parent) checkLive(call, options.parent, true);
			if (layers !== undefined) checkLayers(call, layers);
		}
		const layered = layers !== undefined && layers >>> 0 !== C.LAYERS_DEFAULT;
		let write = this.reserveCommands(1 + (layered ? 1 : 0) + (material ? 1 : 0), call);
		const handle = this.core.check(this.core.glue.reserveObject(), call, options.name);
		const slot = handle & SLOT_MASK;
		const v = this.views;
		const [x, y, z] = options.position ?? ORIGIN;
		this.writePosition(slot, x, y, z);
		v.rotations.set(options.rotation ?? [0, 0, 0, 1], slot * 4);
		v.scales.set(options.scale ?? [1, 1, 1], slot * 3);
		v.radii[slot] = radius;
		const all = flags | C.FLAG_VISIBLE | (options.dynamic ? C.FLAG_DYNAMIC : 0);
		const parent = options.parent?.handle ?? 0;
		this.writeCommand(write++, C.COMMAND_CREATE | (all << 8), handle, parent, mesh);
		if (layered) this.writeCommand(write++, C.COMMAND_SET_LAYERS, handle, layers >>> 0, 0);
		if (material) this.writeCommand(write++, C.COMMAND_SET_MATERIAL, handle, material, 0);
		this.publishCommands(write);
		const object = new kind(this, handle, options.name ?? '', ...extra);
		object.attachTo(options.parent ?? null);
		object.flags = all;
		object.layerMask = (layers ?? C.LAYERS_DEFAULT) >>> 0;
		this.remember(object);
		if (DEV) this.unmarkedWrites?.watch(object, !options.dynamic);
		return object;
	}

	/** An empty node, for hierarchy. */
	createGroup(options: NodeOptions = {}): Group {
		return this.create(Group, options, C.CORE_NO_MESH, 0, 0, 0, 'createGroup');
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
			(options.receiveShadows ? C.FLAG_RECEIVE_SHADOWS : 0) |
			(options.occluder ? C.FLAG_OCCLUDER : 0);
		const object = this.create(
			Mesh,
			options,
			mesh.id,
			mesh.radius,
			flags,
			material.id,
			'createMesh',
		);
		object.mesh = mesh;
		object.material = material;
		const block = this.makeMorph(object, mesh, undefined, 'createMesh');
		if (block !== 0) this.command(C.COMMAND_SET_MORPH, object.handle, block, 0, 'createMesh');
		return object;
	}

	/**
	 * Creates the objects of a model that `assets.loadGltf` loaded, under one new group that
	 * `options` places, and returns that group. All the objects are created with one batch of
	 * commands, and every copy shares the model's meshes, materials and textures. The group's
	 * `find` gives the copy's object of a node, by the node's name. A model with clips or skins
	 * gives the group an animator, which plays the clips: `copy.animator().play('Walk')`. Throws
	 * E1102 when the scene, the animation table or the batch table has no room for the copy. Then
	 * no part of the copy stays. `destroy()` on the group removes the whole copy.
	 */
	instantiate(prefab: Prefab, options: InstantiateOptions = {}): PrefabInstance {
		const call = 'instantiate';
		const { template } = prefab;
		if (DEV) {
			checkSameEngine(call, 'model', prefab.core, this);
			if (options.parent) checkLive(call, options.parent, true);
			if (options.layers !== undefined) checkLayers(call, options.layers);
		}
		const extra =
			(options.castShadows ? C.FLAG_CAST_SHADOWS : 0) |
			(options.receiveShadows ? C.FLAG_RECEIVE_SHADOWS : 0) |
			(options.occluder ? C.FLAG_OCCLUDER : 0);
		const root: TemplateNode = {
			...(template[0] as TemplateNode),
			name: options.name ?? template[0]?.name ?? '',
			transform: rootTransform(options),
			flags: C.FLAG_VISIBLE | (options.dynamic ? C.FLAG_DYNAMIC : 0),
			layers: (options.layers ?? C.LAYERS_DEFAULT) >>> 0,
			root: true,
		};
		const cleared = options.occluder === false ? C.FLAG_OCCLUDER : 0;
		// Layers reach every object of the copy and its batches, as the shadow flags reach every mesh.
		const nodes =
			options.layers === undefined
				? template
				: template.map((node) => ({ ...node, layers: root.layers }));
		const objects = this.createNodes(nodes, call, options.parent ?? null, root, extra, cleared);
		const instance = objects[0] as PrefabInstance;
		instance.objects = objects;
		const batches: InstanceBatch[] = [];
		try {
			prefab.animate(objects);
			for (const spec of prefab.instancing)
				batches.push(this.placeInstancing(instance, spec, call, options.layers));
		} catch (error) {
			// The animation table or the batch table is full: the copy goes whole, so the sketch
			// holds no part of it that it cannot reach.
			instance.batches = batches;
			instance.destroy();
			throw error;
		}
		instance.batches = batches;
		return instance;
	}

	/**
	 * Copies an object and every object below it, as three.js's `clone` does, with their meshes,
	 * materials, lights, cameras and settings, and returns the copy of the object. The copy has the
	 * same parent, so it starts in the same place. The copies are created with one batch of
	 * commands. An animated object's copy gets an animator of its own, with no clip playing, which
	 * moves the copies of its meshes, as three.js's `SkeletonUtils.clone` does. Instance batches are
	 * not objects, so they are not copied. Throws E1102 when the scene or the animation table has
	 * no room for the copies. Then no copy stays.
	 */
	clone<T extends Object3D>(object: T): T {
		const call = 'clone';
		if (DEV) checkLive(call, object);
		const nodes = this.subtree(object);
		const objects = this.createNodes(nodes, call, object.liveParent);
		const copy = objects[0] as T;
		if (copy instanceof PrefabInstance) copy.objects = objects;
		// Animated objects in the tree give their copies animators, which skin the copied meshes.
		const copies = new Map(
			nodes.map((node, k) => [node.source as Object3D, objects[k] as Object3D]),
		);
		try {
			for (const [source, made] of copies) source.animation?.copyTo(made, copies);
		} catch (error) {
			// The animation table is full: the copies go, so the sketch holds none it cannot reach.
			for (const made of objects) if (made.destroyedFrame < 0) made.destroy();
			throw error;
		}
		return copy;
	}

	/**
	 * The objects at and below `object` as template nodes, parents first, each with its object as
	 * the source of its copy. It walks each object's children, so it visits only the tree.
	 */
	private subtree(object: Object3D): TemplateNode[] {
		const order: Object3D[] = [object];
		const parents: number[] = [-1];
		for (let k = 0; k < order.length; k++)
			for (const child of (order[k] as Object3D).childObjects ?? [])
				if (child.destroyedFrame < 0) {
					order.push(child);
					parents.push(k);
				}
		const v = this.views;
		return order.map((each, k): TemplateNode => {
			const row = each.row;
			const transform = new Float64Array(10);
			this.readPosition(row, transform);
			transform.set(v.rotations.subarray(row * 4, row * 4 + 4), 3);
			transform.set(v.scales.subarray(row * 3, row * 3 + 3), 7);
			const mesh = each instanceof Mesh ? each : undefined;
			const bounds = new Float32Array(4);
			bounds.set(v.centers.subarray(row * 3, row * 3 + 3));
			bounds[3] = v.radii[row] as number;
			return {
				name: each.name,
				parent: parents[k] as number,
				transform,
				mesh: mesh?.mesh,
				material: mesh?.material,
				flags: each.flags,
				layers: each.layerMask,
				renderOrder: mesh?.renderOrder ?? 0,
				bounds,
				source: each,
			};
		});
	}

	/**
	 * Creates an object for each template node, with one core call that reserves their slots and
	 * one batch of command records, and returns them in the nodes' order. A node whose parent is -1
	 * goes under `parent`. `root`, when given, takes the place of the first node, `extra` adds
	 * flags to every node with a mesh, and `cleared` takes flags away from them. Throws E1102 before it creates anything when the scene or
	 * the command ring has no room.
	 */
	private createNodes(
		nodes: readonly TemplateNode[],
		call: string,
		parent: Object3D | null,
		root?: TemplateNode,
		extra = 0,
		cleared = 0,
	): Object3D[] {
		const count = nodes.length;
		const node = (k: number) => (k === 0 && root ? root : (nodes[k] as TemplateNode));
		let records = 0;
		for (let k = 0; k < count; k++) {
			const { mesh, layers, renderOrder } = node(k);
			records += 1 + (mesh ? 1 : 0) + (layers !== C.LAYERS_DEFAULT ? 1 : 0);
			if (mesh && mesh.morphTargets > 0) records++;
			if (renderOrder !== 0) records++;
		}
		let write = this.reserveCommands(records, call);
		const { core } = this;
		const at = core.checkGrowth(core.glue.reserveObjects(count), call);
		const handles = core.u32(at, count).slice();
		const v = this.views;
		const objects: Object3D[] = [];
		for (let k = 0; k < count; k++) {
			const n = node(k);
			const handle = handles[k] as number;
			const slot = handle & SLOT_MASK;
			const t = n.transform;
			this.writePosition(slot, t[0] as number, t[1] as number, t[2] as number);
			for (let i = 0; i < 3; i++) v.scales[slot * 3 + i] = t[7 + i] as number;
			for (let i = 0; i < 4; i++) v.rotations[slot * 4 + i] = t[3 + i] as number;
			const flags = n.mesh ? (n.flags | extra) & ~cleared : n.flags;
			const bounds = n.bounds;
			if (bounds && flags & C.FLAG_CUSTOM_BOUNDS) {
				for (let i = 0; i < 3; i++) v.centers[slot * 3 + i] = bounds[i] as number;
				v.radii[slot] = bounds[3] as number;
			} else v.radii[slot] = n.mesh?.radius ?? 0;
			const up = n.parent < 0 ? (parent?.handle ?? 0) : (handles[n.parent] as number);
			const mesh = n.mesh?.id ?? C.CORE_NO_MESH;
			this.writeCommand(write++, C.COMMAND_CREATE | (flags << 8), handle, up, mesh);
			if (n.mesh && n.material)
				this.writeCommand(write++, C.COMMAND_SET_MATERIAL, handle, n.material.id, 0);
			if (n.layers !== C.LAYERS_DEFAULT)
				this.writeCommand(write++, C.COMMAND_SET_LAYERS, handle, n.layers, 0);
			if (n.renderOrder !== 0) {
				const bits = this.floatBits(n.renderOrder);
				this.writeCommand(write++, C.COMMAND_SET_RENDER_ORDER, handle, bits, 0);
			}
			const object = this.makeObject(n, handle, call);
			if (n.mesh && n.mesh.morphTargets > 0) {
				const source = n.source as Mesh | undefined;
				const weights = source ? this.morphWeightsOf(source) : n.morph?.weights;
				const block = this.makeMorph(object as Mesh, n.mesh, weights, call);
				this.writeCommand(write++, C.COMMAND_SET_MORPH, handle, block, 0);
				if (n.morph) (object as Mesh).morphJoint = n.morph.joint;
			}
			object.attachTo(n.parent < 0 ? parent : (objects[n.parent] as Object3D));
			object.flags = flags;
			object.layerMask = n.layers;
			objects.push(object);
		}
		this.publishCommands(write);
		for (const object of objects) {
			this.remember(object);
			if (DEV) this.unmarkedWrites?.watch(object, (object.flags & C.FLAG_DYNAMIC) === 0);
		}
		return objects;
	}

	/** The wrapper of a new object for a template node, with the light row that a light needs. */
	private makeObject(node: TemplateNode, handle: number, call: string): Object3D {
		const { name, light } = node;
		if (node.root) return new PrefabInstance(this, handle, name);
		if (node.source) return node.source.twin(handle);
		if (light) {
			const kind = LIGHT_CLASSES[light.kind] as ObjectClass<Light>;
			const object = new kind(this, handle, name);
			const { core } = this;
			object.id = core.checkGrowth(core.glue.createLight(handle, light.kind), call, name);
			const [r, g, b] = light.color;
			object.linear.set(light.color);
			core.glue.setLightColor(object.id, C.LIGHT_COLOR_MAIN, r, g, b);
			for (const [which, value] of light.values) core.glue.setLightValue(object.id, which, value);
			return object;
		}
		if (!node.mesh) return new Group(this, handle, name);
		const mesh = new Mesh(this, handle, name);
		mesh.mesh = node.mesh;
		mesh.material = node.material;
		mesh.renderOrder = node.renderOrder;
		return mesh;
	}

	/**
	 * The instance batch of a node of a model with instancing of its own. Each row takes its
	 * transform from the file, after the node's place in the world when the copy is created. The
	 * node's place is the batch's origin, so the rows keep their precision far from the world's
	 * origin.
	 */
	private placeInstancing(
		instance: PrefabInstance,
		spec: InstancingTemplate,
		call: string,
		layers?: number,
	): InstanceBatch {
		const v = this.views;
		const world = identityMatrix(new Float64Array(16));
		const local = new Float64Array(16);
		const position = [0, 0, 0];
		const rotation = [0, 0, 0, 1];
		const scale = [1, 1, 1];
		const trs = (p: Vec3Like, q: Float32Array, s: Float32Array, row: number) =>
			composeMatrix(local, p, q.subarray(row * 4, row * 4 + 4), s.subarray(row * 3, row * 3 + 3));
		let object: Object3D | null = instance.objects[spec.node] as Object3D;
		while (object) {
			this.readPosition(object.row, position);
			multiplyMatrices(world, trs(position, v.rotations, v.scales, object.row), world);
			object = object.liveParent;
		}
		const origin: Vec3 = [world[12] as number, world[13] as number, world[14] as number];
		const batch = this.createParts(spec.parts, spec.count, { origin, layers }, call);
		const { positions, rotations, scales } = batch;
		for (let r = 0; r < spec.count; r++) {
			trs(spec.positions.subarray(r * 3, r * 3 + 3), spec.rotations, spec.scales, r);
			decompose(position, rotation, scale, multiplyMatrices(local, world, local));
			for (let k = 0; k < 3; k++) position[k] = (position[k] as number) - (origin[k] as number);
			positions.set(position, r * 3);
			rotations.set(rotation, r * 4);
			scales.set(scale, r * 3);
		}
		batch.markDirty();
		return batch;
	}

	/**
	 * One instance batch for each part of a model, which share one set of rows: the first part owns
	 * them, and the others read them.
	 */
	private createParts(
		parts: readonly PartTemplate[],
		count: number,
		options: Omit<InstanceOptions, 'material'>,
		call: string,
	): InstanceBatch {
		const { core } = this;
		const colors = options.colors ?? false;
		const ids: number[] = [];
		try {
			for (const part of parts)
				ids.push(
					core.checkGrowth(
						core.glue.createBatchPart(
							ids[0] ?? 0,
							count,
							options.dynamic ?? false,
							colors,
							part.mesh.id,
							part.material.id,
							part.matrix,
						),
						call,
					),
				);
		} catch (error) {
			for (const id of ids.reverse()) core.glue.destroyBatch(id, this.frame);
			throw error;
		}
		if (DEV) this.countBatchRows(count * ids.length);
		const batch = new InstanceBatch(this, ids[0] as number, count, colors, ids.slice(1));
		this.rememberBatch(batch);
		if (options.layers !== undefined) batch.setLayers(options.layers);
		if (options.origin) batch.setOrigin(options.origin, call);
		return batch;
	}

	/**
	 * Many copies of one mesh and material, with typed arrays of rows. Or many copies of a model
	 * that `assets.loadGltf` loaded, without a material: one batch for each mesh of the model, which
	 * share one set of rows, so one row places a whole copy. The model's lights are left out.
	 * Throws E1417 for a model with no meshes, or with instancing of its own.
	 */
	createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch;
	createInstances(
		prefab: Prefab,
		count: number,
		options?: Omit<InstanceOptions, 'material'>,
	): InstanceBatch;
	createInstances(
		source: MeshGeometry | Prefab,
		count: number,
		options: Partial<InstanceOptions> = {},
	): InstanceBatch {
		const call = 'createInstances';
		const { core } = this;
		const { layers } = options;
		if (DEV && layers !== undefined) checkLayers(call, layers);
		if ('template' in source) {
			const problem =
				source.instancing.length > 0
					? 'has instancing of its own. Use scene.instantiate for it'
					: source.parts.length === 0
						? 'has no meshes'
						: undefined;
			if (problem)
				throw new EngineError('E1417', `${call}() got ${source.describe()}, which ${problem}.`);
			return this.createParts(source.parts, count, options, call);
		}
		const mesh = source;
		const material = options.material as Material;
		const id = core.checkGrowth(
			core.glue.createBatch(
				count,
				options.dynamic ?? false,
				options.colors ?? false,
				mesh.id,
				material.id,
			),
			call,
		);
		if (DEV) this.countBatchRows(count);
		const batch = new InstanceBatch(this, id, count, options.colors ?? false);
		this.rememberBatch(batch);
		batch.setActiveCount(count);
		if (layers !== undefined) batch.setLayers(layers);
		if (options.origin) batch.setOrigin(options.origin, call);
		return batch;
	}

	/**
	 * Many sprites in one batch: quads that face the camera, like three.js's `Sprite` with a
	 * `SpriteMaterial`. Typed arrays give each sprite its position, size, rotation, color and atlas
	 * frame, as an instance batch's arrays give its rows. Sprites blend by default, and blended
	 * sprites draw back to front with the other blended objects. The first call downloads the
	 * sprite code. Throws E1108 for an atlas side that is not a whole number from 1 to 2048, E1203
	 * for a center that is not two finite numbers, and E1406 when the sprite code does not download.
	 */
	async createSprites(options: SpriteOptions): Promise<SpriteBatch> {
		const call = 'createSprites';
		const { columns = 1, rows = 1 } = options.atlas ?? {};
		for (const [name, side] of [
			['columns', columns],
			['rows', rows],
		] as const)
			if (!Number.isInteger(side) || side < 1 || side > C.SPRITE_MAX_ATLAS_SIDE)
				throw new EngineError(
					'E1108',
					`${call}() got ${side} atlas ${name}. An atlas has from 1 to ${C.SPRITE_MAX_ATLAS_SIDE} whole ${name}.`,
				);
		const { center } = options;
		if (DEV && center && !(Number.isFinite(center[0]) && Number.isFinite(center[1])))
			throw new EngineError('E1203', `${call}() got [${center}] for center.`);
		const [, batch] = await this.spriteBatch(call, options.count, options, columns, rows, 'blend');
		return batch;
	}

	/**
	 * Many points in one batch: squares that face the camera, all of one size, like three.js's
	 * `Points` with a `PointsMaterial`. Each point is a sprite: typed arrays give each point its
	 * position and color, as an instance batch's arrays give its rows. Sizes above one pixel work on
	 * every GPU path. Points are opaque by default, and blended points draw back to front with the
	 * other blended objects. The first call downloads the sprite code. Throws E1206 for points or
	 * colors that make no points, E1108 for a size that is not above 0, E1203 for a size that is not
	 * finite, and E1406 when the sprite code does not download.
	 */
	async createPoints(options: PointOptions): Promise<PointBatch> {
		const call = 'createPoints';
		const { positions, colors, size = 1 } = options;
		const count = pointCount(call, positions, colors);
		POINT_CHECKS.size(size, call);
		const [sprites, batch] = await this.spriteBatch(call, count, options, 1, 1, 'opaque');
		return sprites.pointBatch(batch, POINT_CHECKS, positions, colors, size);
	}

	/**
	 * Downloads the sprite code on first use, and creates a sprite batch of `count` rows with the
	 * look, layers and origin of `options`, an atlas of `columns` by `rows` frames, and `alphaMode`
	 * when the options give none.
	 */
	private async spriteBatch(
		call: string,
		count: number,
		options: SpriteLook,
		columns: number,
		rows: number,
		alphaMode: AlphaMode,
	): Promise<[typeof import('./sprites'), SpriteBatch]> {
		const { core, makers } = this;
		const { layers } = options;
		if (DEV && layers !== undefined) checkLayers(call, layers);
		if (!makers) throw new Error(`${call}() needs a scene that the engine made`);
		makers.materials.shaders.need('sprites');
		const sprites = await loadSprites(call);
		const parts = sprites.spriteParts(
			makers,
			this.spriteQuads,
			options,
			[columns, rows],
			alphaMode,
			call,
		);
		const id = core.checkGrowth(
			core.glue.createSpriteBatch(
				count,
				options.dynamic ?? false,
				parts.mesh.id,
				parts.material.id,
				columns,
				rows,
				options.sizeAttenuation === false,
			),
			call,
		);
		if (DEV) this.countBatchRows(count);
		const instances = new InstanceBatch(this, id, count, false);
		this.rememberBatch(instances);
		if (options.origin) instances.setOrigin(options.origin, call);
		const batch = new sprites.SpriteBatch(core, id, count, parts.material, instances);
		if (layers !== undefined) batch.setLayers(layers);
		return [sprites, batch];
	}

	/**
	 * Lines of any width in one batch, like three.js's `Line2` and `LineSegments2` with a
	 * `LineMaterial`, and its `Line`, `LineSegments` and `LineLoop`. Each segment between two points
	 * draws as a quad with round ends that faces the camera, `width` CSS pixels wide, or world units
	 * wide with `worldUnits`. A typed array gives each point its position and color, as an instance
	 * batch's arrays give its rows. The first call downloads the line code. Throws E1206 for points
	 * or colors that make no line, E1217 for an unknown mode, E1108 for a width that is not positive
	 * or a dash or gap below 0, E1203 for a value that is not finite, and E1406 when the line code
	 * does not download.
	 */
	async createLines(options: LineOptions): Promise<LineBatch> {
		const call = 'createLines';
		const { core, makers } = this;
		const { positions, colors, layers, mode = 'strip', width = 1 } = options;
		if (DEV && layers !== undefined) checkLayers(call, layers);
		const points = linePoints(call, mode, positions, colors);
		LINE_CHECKS.width(width, call);
		LINE_CHECKS.values(options, call);
		if (!makers) throw new Error(`${call}() needs a scene that the engine made`);
		makers.materials.shaders.need('lines');
		const lines = await loadLines(call);
		const parts = lines.lineParts(makers, core, this.lineMesh, options, LINE_CHECKS, call);
		this.lineMesh = parts.mesh;
		const id = core.checkGrowth(
			core.glue.createLineBatch(
				points,
				options.dynamic ?? false,
				parts.mesh.id,
				parts.material.id,
				lines.modeCode(mode),
				width,
				options.worldUnits ?? false,
				options.dashed ?? false,
			),
			call,
		);
		const rows = LINE_SEGMENTS[mode](points);
		if (DEV) this.countBatchRows(rows);
		const instances = new InstanceBatch(this, id, rows, false);
		this.rememberBatch(instances);
		if (options.origin) instances.setOrigin(options.origin, call);
		const batch = new lines.LineBatch(core, id, points, parts.material, instances, LINE_CHECKS);
		batch.positions.set(positions);
		if (colors) batch.colors.set(colors);
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
		const camera = this.create(kind, node, C.CORE_NO_MESH, 0, 0, 0, call, ...lens);
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
		const { intensityUnit } = options;
		if (DEV && intensityUnit !== undefined && intensityUnit !== LIGHT_UNITS[type])
			throw new EngineError(
				'E1213',
				`${call}() got the intensity unit ${JSON.stringify(intensityUnit)}, and this light takes only '${LIGHT_UNITS[type]}'.`,
			);
		const flags = options.castShadows ? C.FLAG_CAST_SHADOWS : 0;
		const light = this.create(kind, options, C.CORE_NO_MESH, 0, flags, 0, call);
		const { core } = this;
		try {
			light.id = core.checkGrowth(core.glue.createLight(light.handle, type), call, options.name);
		} catch (error) {
			// The object has no light row, so it goes before the sketch could reach it.
			light.destroy();
			throw error;
		}
		light.unitScale = intensityScale(type, intensityUnit);
		if (options.color !== undefined) light.paint(call, C.LIGHT_COLOR_MAIN, options.color);
		const ranged = type === C.LIGHT_KIND_POINT || type === C.LIGHT_KIND_SPOT;
		for (const [key, which] of LIGHT_NUMBERS) {
			const value = options[key];
			if (which === C.LIGHT_VALUE_INTENSITY) {
				// An intensity in another unit, even the default of 1, is that unit's.
				if (value !== undefined || light.unitScale !== 1)
					light.write(call, which, (value ?? 1) * light.unitScale);
			} else if (value !== undefined || (ranged && which === C.LIGHT_VALUE_RANGE))
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
	createAmbientLight(options: AmbientLightOptions = {}): AmbientLight {
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
			this.makers?.materials.shaders.need('background');
			const status = glue.setBackgroundTexture(background.handle);
			this.core.check(status, 'setBackground', 'a texture', true);
			return;
		}
		const [r, g, b] = linearColor(background, 'setBackground');
		glue.setBackground(r, g, b);
		glue.setBackgroundTexture(0);
	}

	/**
	 * Lights the scene with an environment from `assets.loadEnvironment` or
	 * `assets.builtinEnvironment`, as three.js's `scene.environment` does with a texture from
	 * `PMREMGenerator`, or with none for null. Standard materials reflect it, sharply when smooth
	 * and blurred when rough, and take its diffuse light, each times its `envIntensity`. The scene
	 * draws without a file's environment until its map is on the GPU. The built-in room's map is
	 * whole in the first frame that uses it. It allocates nothing, so a sketch
	 * can turn the environment every frame. Throws E1203 for a number that is not finite, E1108 for
	 * a negative intensity, E1213 for a value that is not an environment, and E1101 for an
	 * environment that was destroyed.
	 */
	setEnvironment(environment: Environment | null, options?: EnvironmentOptions): void {
		this.sceneEnvironment ??= new SceneEnvironment(this.core);
		this.sceneEnvironment.set(environment, options);
	}

	/**
	 * Fog over every object, by each object's straight-line distance from the camera along a curve:
	 * exponential by default, exponential squared or linear. The fog can thin with height and glow
	 * toward the main directional light. Null removes the fog. The background takes no fog, and a
	 * material created with `fog: false` keeps its color. Throws E1108 for an unknown curve or a
	 * value out of its range, and E1203 for a value that is not finite. Converting the color
	 * allocates.
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
					return batch && (batch.id === id || batch.parts.includes(id)) ? batch : undefined;
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
