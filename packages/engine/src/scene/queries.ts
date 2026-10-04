// Raycasts and overlap queries. A query writes its input into engine memory, makes one call into
// the core, and reads the hit records that the core writes back into the caller's own objects
// and arrays. The views on engine memory are made again only when the memory or the hit array
// grows, and new hit objects only when the caller's array is too short, so a query allocates
// nothing in steady state.

import { checkLayers, type Described } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { Vec3Like } from '../math/types';
import type { CoreMemory } from './memory';
import type { InstanceBatch, Object3D } from './scene';

/**
 * The options of every query.
 *
 * @category api/raycast
 */
export interface QueryOptions {
	/**
	 * The layers to test, as a 32-bit mask like `Object3D.setLayers` takes. A query tests an object
	 * when their masks share a layer. The default is layer 0 alone, as for a camera and for
	 * three.js's `Raycaster`.
	 */
	layers?: number;
}

/**
 * The options of a raycast.
 *
 * @category api/raycast
 */
export interface RaycastOptions extends QueryOptions {
	/** The farthest hit, in meters from the ray's origin. The default is no limit. */
	maxDistance?: number;
}

/**
 * An object that a query found: a scene object, or a row of an instance batch.
 *
 * @category api/raycast
 */
export interface OverlapHit {
	/** The object or the instance batch, or null after a raycast that hit nothing. */
	object: Object3D | InstanceBatch | null;
	/** The row of an instance batch, or -1 for an object. */
	instance: number;
}

/**
 * A raycast's hit. Create one with `point` and `normal` arrays, and pass it to each raycast.
 *
 * @category api/raycast
 */
export interface RaycastHit extends OverlapHit {
	/** Where the ray hit, in world space. */
	point: Vec3Like;
	/** The unit normal of the hit triangle in world space, on the side that faces the ray. */
	normal: Vec3Like;
	/** The distance from the ray's origin to the hit, in meters. */
	distance: number;
	/** The index of the hit triangle in its mesh, as three.js's `faceIndex`. */
	triangle: number;
}

/**
 * The arrays that `scene.raycastBatch` fills: one entry per ray, or three numbers per ray for
 * points and normals. Only `distances` is required; the call fills each other array you give.
 *
 * @category api/raycast
 */
export interface RaycastBatchHits {
	/** The distance to each ray's closest hit in meters, or -1 when the ray hits nothing. */
	distances: Float32Array | Float64Array;
	/** The object or instance batch that each ray hit, or null. */
	objects?: (Object3D | InstanceBatch | null)[];
	/** The instance batch row that each ray hit, or -1. */
	instances?: Int32Array;
	/** Each hit's point in world space, three numbers per ray. */
	points?: Float32Array | Float64Array;
	/** Each hit triangle's unit normal in world space, facing the ray, three numbers per ray. */
	normals?: Float32Array | Float64Array;
}

/** The objects and batches that hit records name, by their slots. */
export interface QueryTargets {
	/** The object in a slot, or undefined. */
	objectAt(slot: number): Object3D | undefined;
	/** The live batch with an id, or undefined. */
	batchAt(id: number): InstanceBatch | undefined;
}

/** Names for the values that error messages describe. */
const described = (name: string): Described => ({ describe: () => name });
const ORIGIN = described('the origin');
const DIRECTION = described('the direction');
const CENTER = described('the center');
const MIN = described('the lowest corner');
const MAX = described('the highest corner');

const AXES = ['x', 'y', 'z'] as const;

/**
 * The largest 32-bit float. The core holds query points and radii in 32 bits, where a number past
 * it becomes infinite. Directions become unit vectors in 64 bits first, so they take any finite
 * number.
 */
const F32_MAX = 3.4028234663852886e38;

// Every query checks its input in every build, not only in development builds: a query input
// that is not finite in 32 bits would give the core's trees nothing to stand on. A check that
// passes costs a few comparisons and allocates nothing; messages are built only on failure.

/** Throws E1203 for a number that is not finite, and E1108 for a finite one past `F32_MAX`. */
function badNumber(call: string, value: number, what: string): never {
	if (!Number.isFinite(value))
		throw new EngineError('E1203', `${call}() got ${value} for ${what}.`);
	throw new EngineError(
		'E1108',
		`${call}() got ${value} for ${what}: pass a number from -3.4e38 to 3.4e38, the range of 32-bit floats.`,
	);
}

/**
 * Checks each part of a point or vector: `badNumber` throws for a part that is not finite or lies
 * past `limit` either way.
 */
function checkPoint(call: string, what: Described, v: Vec3Like, limit: number): void {
	for (let k = 0; k < 3; k++) {
		const value = v[k] as number;
		if (!(Math.abs(value) <= limit)) badNumber(call, value, `${AXES[k]} of ${what.describe()}`);
	}
}

/** Throws E1108 for a direction of length 0. `which` names the ray in a batch. */
function checkDirection(call: string, x: number, y: number, z: number, which: string): void {
	if (x === 0 && y === 0 && z === 0)
		throw new EngineError(
			'E1108',
			`${call}() got a direction of length 0${which}: pass a direction of any length above 0.`,
		);
}

/** Throws E1108 for a number that is NaN, below 0 or past `limit`. */
function checkNotBelowZero(call: string, name: string, value: number, limit: number): void {
	if (value >= 0 && value <= limit) return;
	const range = limit === Infinity ? '0 or more' : 'a number from 0 to 3.4e38';
	throw new EngineError('E1108', `${call}() got ${value} for ${name}: pass ${range}.`);
}

/** Checks a raycast's far limit and layers. */
function checkOptions(call: string, options: RaycastOptions | undefined): void {
	if (options?.maxDistance !== undefined)
		checkNotBelowZero(call, 'maxDistance', options.maxDistance, Infinity);
	if (options?.layers !== undefined) checkLayers(call, options.layers);
}

/** Checks a raycast's ray and options. */
function checkRay(call: string, origin: Vec3Like, direction: Vec3Like, options?: RaycastOptions) {
	checkPoint(call, ORIGIN, origin, F32_MAX);
	checkPoint(call, DIRECTION, direction, Number.MAX_VALUE);
	checkDirection(call, direction[0] as number, direction[1] as number, direction[2] as number, '');
	checkOptions(call, options);
}

/** Checks each of the first `count` rays of a batch as `checkRay` checks one ray. */
function checkRays(call: string, rays: ArrayLike<number>, count: number): void {
	for (let i = 0; i < count; i++) {
		const at = i * C.QUERY_RAY_FLOATS;
		for (let k = 0; k < C.QUERY_RAY_FLOATS; k++) {
			const value = rays[at + k] as number;
			const limit = k < 3 ? F32_MAX : Number.MAX_VALUE;
			if (!(Math.abs(value) <= limit)) badNumber(call, value, `index ${at + k} of its rays`);
		}
		const x = rays[at + 3] as number;
		checkDirection(call, x, rays[at + 4] as number, rays[at + 5] as number, ` for ray ${i}`);
	}
}

/** Throws E1108 when an output array is shorter than a batch of `count` rays needs. */
function checkLength(call: string, name: string, length: number, needed: number): void {
	if (length < needed)
		throw new EngineError(
			'E1108',
			`${call}() got ${name} of length ${length}, but its rays need ${needed}.`,
		);
}

/** The layer mask of a query's options, as an unsigned 32-bit number. */
const layersOf = (options?: QueryOptions): number => (options?.layers ?? C.LAYERS_DEFAULT) >>> 0;

/** A hit object for a list that a query fills, made when the list is too short. */
function newHit(): RaycastHit {
	return {
		object: null,
		instance: -1,
		point: [0, 0, 0],
		normal: [0, 0, 0],
		distance: 0,
		triangle: -1,
	};
}

/** The scene's queries: see the module comment. */
export class SceneQueries {
	private generation = -1;
	private input!: Float64Array;
	private hits!: Float64Array;
	/** The hit records that `hits` holds. */
	private hitCapacity = 0;
	private rays!: Float64Array;
	/** The rays that the core's ray array has room for. */
	private rayCapacity = 0;

	constructor(
		private readonly core: CoreMemory,
		private readonly targets: QueryTargets,
	) {}

	/** Makes the views on engine memory again after the memory or the hit array grew. */
	private views(): void {
		const { core } = this;
		core.refresh();
		if (this.generation === core.generation) return;
		const { glue } = core;
		this.input = core.f64(glue.queryArrays(C.QUERY_INPUT), C.QUERY_INPUT_FLOATS);
		this.hitCapacity = glue.queryArrays(C.QUERY_HIT_CAPACITY);
		this.hits = core.f64(glue.queryArrays(C.QUERY_HITS), this.hitCapacity * C.QUERY_HIT_FLOATS);
		this.rays = core.f64(glue.queryArrays(C.QUERY_RAYS), this.rayCapacity * C.QUERY_RAY_FLOATS);
		this.generation = core.generation;
	}

	/** Checks a query's result, and makes the views again when it wrote more hits than they hold. */
	private finish(result: number, call: string): number {
		if (result === C.QUERY_FAILED) this.core.fail(call);
		this.views();
		if (result > this.hitCapacity) {
			this.generation = -1;
			this.views();
		}
		return result;
	}

	/** Writes a ray and its far limit into the input array. */
	private writeRay(origin: Vec3Like, direction: Vec3Like, options?: RaycastOptions): void {
		this.views();
		const input = this.input;
		for (let k = 0; k < 3; k++) {
			input[k] = origin[k] as number;
			input[3 + k] = direction[k] as number;
		}
		input[C.QUERY_INPUT_LIMIT] = options?.maxDistance ?? Infinity;
	}

	/** The object or batch that the hit record at `at` names, or null for a miss. */
	private targetAt(at: number): Object3D | InstanceBatch | null {
		const r = this.hits;
		const slot = r[at + C.QUERY_HIT_SLOT] as number;
		const { targets } = this;
		return (
			(slot !== 0
				? targets.objectAt(slot)
				: targets.batchAt(r[at + C.QUERY_HIT_BATCH] as number)) ?? null
		);
	}

	/** Copies the object and row of hit record `i` into `out`. */
	private readTarget(i: number, out: OverlapHit): void {
		const at = i * C.QUERY_HIT_FLOATS;
		out.object = this.targetAt(at);
		out.instance = this.hits[at + C.QUERY_HIT_ROW] as number;
	}

	/** Copies hit record `i` into `out`. */
	private readHit(i: number, out: RaycastHit): void {
		this.readTarget(i, out);
		const r = this.hits;
		const at = i * C.QUERY_HIT_FLOATS;
		out.distance = r[at + C.QUERY_HIT_DISTANCE] as number;
		out.triangle = r[at + C.QUERY_HIT_TRIANGLE] as number;
		const { point, normal } = out;
		for (let k = 0; k < 3; k++) {
			point[k] = r[at + C.QUERY_HIT_POINT + k] as number;
			normal[k] = r[at + C.QUERY_HIT_NORMAL + k] as number;
		}
	}

	/** Fills `out` with the first `count` hit records, adding hit objects where it is too short. */
	private readList(count: number, out: OverlapHit[], full: boolean): void {
		for (let i = 0; i < count; i++) {
			let hit = out[i];
			if (hit === undefined) {
				hit = newHit();
				out[i] = hit;
			}
			if (full) this.readHit(i, hit as RaycastHit);
			else this.readTarget(i, hit);
		}
	}

	raycast(
		origin: Vec3Like,
		direction: Vec3Like,
		options: RaycastOptions | undefined,
		hit: RaycastHit,
	): boolean {
		checkRay('raycast', origin, direction, options);
		this.writeRay(origin, direction, options);
		const found = this.finish(
			this.core.glue.raycast(C.QUERY_CLOSEST, layersOf(options)),
			'raycast',
		);
		if (found === 0) {
			hit.object = null;
			return false;
		}
		this.readHit(0, hit);
		return true;
	}

	raycastAny(origin: Vec3Like, direction: Vec3Like, options?: RaycastOptions): boolean {
		checkRay('raycastAny', origin, direction, options);
		this.writeRay(origin, direction, options);
		return this.finish(this.core.glue.raycast(C.QUERY_ANY, layersOf(options)), 'raycastAny') !== 0;
	}

	raycastAll(
		origin: Vec3Like,
		direction: Vec3Like,
		options: RaycastOptions | undefined,
		hits: RaycastHit[],
	): number {
		checkRay('raycastAll', origin, direction, options);
		this.writeRay(origin, direction, options);
		const count = this.finish(this.core.glue.raycast(C.QUERY_ALL, layersOf(options)), 'raycastAll');
		this.readList(count, hits, true);
		return count;
	}

	raycastBatch(
		rays: ArrayLike<number>,
		options: RaycastOptions | undefined,
		out: RaycastBatchHits,
	): number {
		const call = 'raycastBatch';
		const count = rays.length / C.QUERY_RAY_FLOATS;
		if (!Number.isInteger(count))
			throw new EngineError(
				'E1108',
				`${call}() got ${rays.length} numbers for its rays: pass six numbers per ray, its origin and then its direction.`,
			);
		checkRays(call, rays, count);
		checkOptions(call, options);
		checkLength(call, 'distances', out.distances.length, count);
		if (out.objects) checkLength(call, 'objects', out.objects.length, count);
		if (out.instances) checkLength(call, 'instances', out.instances.length, count);
		if (out.points) checkLength(call, 'points', out.points.length, count * 3);
		if (out.normals) checkLength(call, 'normals', out.normals.length, count * 3);
		const { core } = this;
		if (count > this.rayCapacity) {
			core.checkGrowth(core.glue.reserveRays(count), 'raycastBatch', undefined, true);
			this.rayCapacity = count;
			this.generation = -1;
		}
		this.views();
		this.rays.set(rays);
		this.input[C.QUERY_INPUT_LIMIT] = options?.maxDistance ?? Infinity;
		const found = this.finish(core.glue.raycastBatch(count, layersOf(options)), 'raycastBatch');
		const r = this.hits;
		const { distances, objects, instances, points, normals } = out;
		for (let i = 0; i < count; i++) {
			const at = i * C.QUERY_HIT_FLOATS;
			distances[i] = r[at + C.QUERY_HIT_DISTANCE] as number;
			if (objects) objects[i] = this.targetAt(at);
			if (instances) instances[i] = r[at + C.QUERY_HIT_ROW] as number;
			for (let k = 0; k < 3; k++) {
				if (points) points[i * 3 + k] = r[at + C.QUERY_HIT_POINT + k] as number;
				if (normals) normals[i * 3 + k] = r[at + C.QUERY_HIT_NORMAL + k] as number;
			}
		}
		return found;
	}

	overlapSphere(
		center: Vec3Like,
		radius: number,
		options: QueryOptions | undefined,
		out: OverlapHit[],
	): number {
		checkPoint('overlapSphere', CENTER, center, F32_MAX);
		checkNotBelowZero('overlapSphere', 'radius', radius, F32_MAX);
		checkOptions('overlapSphere', options);
		this.views();
		const input = this.input;
		for (let k = 0; k < 3; k++) input[k] = center[k] as number;
		input[C.QUERY_INPUT_LIMIT] = radius;
		return this.overlap(C.QUERY_SPHERE, options, out, 'overlapSphere');
	}

	overlapBox(
		min: Vec3Like,
		max: Vec3Like,
		options: QueryOptions | undefined,
		out: OverlapHit[],
	): number {
		checkPoint('overlapBox', MIN, min, F32_MAX);
		checkPoint('overlapBox', MAX, max, F32_MAX);
		for (let k = 0; k < 3; k++)
			if ((min[k] as number) > (max[k] as number))
				throw new EngineError(
					'E1108',
					`overlapBox() got a lowest corner above the highest on ${AXES[k]}: ${min[k]} > ${max[k]}.`,
				);
		checkOptions('overlapBox', options);
		this.views();
		const input = this.input;
		for (let k = 0; k < 3; k++) {
			input[k] = min[k] as number;
			input[3 + k] = max[k] as number;
		}
		return this.overlap(C.QUERY_BOX, options, out, 'overlapBox');
	}

	private overlap(
		kind: number,
		options: QueryOptions | undefined,
		out: OverlapHit[],
		call: string,
	): number {
		const count = this.finish(this.core.glue.overlap(kind, layersOf(options)), call);
		this.readList(count, out, false);
		return count;
	}
}
