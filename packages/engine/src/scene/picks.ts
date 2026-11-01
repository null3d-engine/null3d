// GPU picking on the sketch's thread: a pick asks the next recorded frame to draw the scene's
// opaque objects into an id target around the point, and answers through a promise once the frame
// has copied the point's ids back into engine memory. A frame records one read, so the picks wait
// in a queue of their own; each lands a frame or more later and raises its control slot, which the
// frame loop checks.
//
// A scene whose sources the pass cannot draw whole, such as one with a custom material without a
// vertex offset, a blended surface or a sprite, answers with a raycast instead: the ray tests
// triangles, so it ignores the masks that the count of pixels would honor. An engine that runs no
// frame loop, as hold mode does, answers with a raycast too. A pick's texture coordinates come
// from a raycast through the same pixel, with the camera of the frame that recorded the pick: the
// id target names the source of the pixel, and the ray names its triangle and blends the corners.

import { EngineError } from '../errors/engine-error';
import type { Vec2Like } from '../math/types';
import { GpuEpoch, PickRead0 } from '../shared/slot';
import type { CoreMemory, ViewHolder } from './memory';
import type { QueryTarget, QueryTargets } from './queries';

/**
 * What a pick found: an object or the batch of a row, the row of an instance batch, and where on
 * the surface the pixel landed.
 *
 * @category api/raycast
 */
export interface PickHit {
	/** The object or the batch of a row. */
	object: QueryTarget;
	/** The row of a batch, or -1 for an object of the scene. */
	instance: number;
	/**
	 * Where on the surface the pixel landed, as the first texture coordinates of the hit triangle
	 * blended across its three corners, as three.js's `intersection.uv`. Read `hasUv` first: the
	 * numbers mean nothing when it is false.
	 */
	uv?: Vec2Like;
	/**
	 * True when the picked surface has a first texture coordinate set, so `uv` holds where on the
	 * surface the pixel landed. False for a mesh that has no such coordinates, and when the ray
	 * that finds them met another source than the pick's.
	 */
	hasUv?: boolean;
}

/** How many reads of the pick ring may wait for the GPU at once. */
const RING = 4;

/** The words that one read's bytes land in. */
const RESULT_WORDS = 4;

/** The row that a pick's answer gives an object of the scene. */
const NO_ROW = 0xffffffff;

/** The frame that a pick names when its ray must use the camera as it stands. */
const NO_FRAME = -1;

/** A pick that waits for its frame. */
interface Job {
	x: number;
	y: number;
	resolve(hit: PickHit | null): void;
	reject(error: unknown): void;
}

/** A pick that the core took, at the ring entry that answers it, on the device it recorded for. */
interface InFlight extends Job {
	ring: number;
	epoch: number;
}

/** The picks that a scene waits for, and the answers that the GPU copied back. */
export class ScenePicks implements ViewHolder {
	private slots: Int32Array | undefined;
	private results: Uint32Array | undefined;
	private resultAddress = 0;
	private generation = -1;
	private ring = 0;
	private inFlight: InFlight | undefined;
	private readonly queue: Job[] = [];
	private stopped = false;

	/**
	 * `byRay` answers a pick that the GPU pass cannot draw: it casts a ray through the point with
	 * the camera of the frame that last ran. It also finds the texture coordinates of a pixel that
	 * the GPU pass picked, from the camera of the frame that recorded the pick.
	 */
	constructor(
		private readonly core: CoreMemory,
		private readonly targets: QueryTargets,
		private readonly byRay: (x: number, y: number, frame: number) => PickHit | null,
	) {
		core.holdViews(this);
	}

	/** Forgets the view of the ring's results, which the next answer makes again. */
	dropViews(): void {
		this.results = undefined;
		this.generation = -1;
	}

	/** @internal Gives the picks the engine's control block, when the frame loop starts. */
	attach(slots: Int32Array): void {
		this.slots = slots;
	}

	/**
	 * Finds the object or the batch row that the camera draws at a point: `x` and `y` are CSS
	 * pixels from the canvas's top-left corner, as `camera.screenToRay` takes them. The frame that
	 * records the pick draws its ids, so the answer is the pixel of that frame, and a camera that
	 * moves meanwhile can differ from the frame that the click saw.
	 */
	pick(x: number, y: number): Promise<PickHit | null> {
		if (this.stopped)
			return Promise.reject(new EngineError('E1420', 'pick() ran after the engine stopped.'));
		if (!this.slots) {
			// A pick always answers through the promise, even when the ray path throws before the
			// first frame.
			try {
				return Promise.resolve(this.byRay(x, y, NO_FRAME));
			} catch (error) {
				return Promise.reject(error);
			}
		}
		return new Promise((resolve, reject) => {
			this.queue.push({ x, y, resolve, reject });
			this.send();
		});
	}

	/** @internal Answers each read that landed, at the end of a frame. */
	poll(slots: Int32Array): void {
		this.slots = slots;
		const job = this.inFlight;
		if (job && Atomics.load(slots, GpuEpoch) !== job.epoch) {
			// The new device cannot finish a read that the lost one recorded, so the pick settles
			// rather than waits. It is not asked again on the new device.
			this.inFlight = undefined;
			job.reject(
				new EngineError('E1436', 'pick() was waiting for its read when the GPU was lost.'),
			);
		} else if (job && Atomics.load(slots, PickRead0 + job.ring) !== 0) {
			this.inFlight = undefined;
			let hit: PickHit | null = null;
			try {
				hit = this.answer(job);
			} catch (error) {
				job.reject(error);
				this.send();
				return;
			}
			job.resolve(hit);
		}
		this.send();
	}

	/** @internal Fails the picks that wait, when the engine stops. */
	stop(): void {
		this.stopped = true;
		// A stop with no pick waiting raises no error, which would load the fixes' text for nothing.
		if (!this.inFlight && this.queue.length === 0) return;
		const error = new EngineError('E1420', 'pick() waited when the engine stopped.');
		this.inFlight?.reject(error);
		for (const job of this.queue) job.reject(error);
		this.inFlight = undefined;
		this.queue.length = 0;
	}

	/** Gives the core the first pick of the queue, while no read waits. */
	private send(): void {
		const slots = this.slots;
		if (!slots || this.inFlight || this.queue.length === 0) return;
		const job = this.queue.shift() as Job;
		const ring = this.ring;
		this.ring = (ring + 1) % RING;
		const slot = PickRead0 + ring;
		Atomics.store(slots, slot, 0);
		// The pass tests the pixel that the camera draws, so a point between pixels takes the
		// pixel it lies in. A point beyond the core call's whole-number range names no pixel.
		const x = Math.floor(job.x);
		const y = Math.floor(job.y);
		if (x < -0x8000_0000 || x > 0x7fff_ffff || y < -0x8000_0000 || y > 0x7fff_ffff) {
			job.resolve(null);
			this.send();
			return;
		}
		if (this.core.glue.requestPick(x, y, ring, slot) !== 0) {
			// A pick still waits for its frame, as a lost device can leave it: try again next frame.
			this.queue.unshift(job);
			return;
		}
		this.inFlight = { ...job, ring, epoch: Atomics.load(slots, GpuEpoch) };
	}

	/** Reads the ids that the job's read landed, and names the object or row that they name. */
	private answer(job: InFlight): PickHit | null {
		if (this.core.glue.pickCoversScene() === 0) return this.byRay(job.x, job.y, NO_FRAME);
		const results = this.resultView();
		const key = results[job.ring * RESULT_WORDS] as number;
		if (key === 0) return null;
		const id = this.core.glue.pickTargetId(key);
		if (id === 0) return null;
		const row = this.core.glue.pickTargetRow(key);
		if (row === NO_ROW) {
			const object = this.targets.objectAt(id);
			return object === undefined ? null : this.withUv({ object, instance: -1 }, job);
		}
		const batch = this.targets.batchAt(id);
		return batch === undefined ? null : this.withUv({ object: batch, instance: row }, job);
	}

	/**
	 * Adds the texture coordinates that the picked pixel lies under. The id target names the source
	 * of the pixel but not its triangle, so a ray from the camera of the frame that recorded the
	 * pick finds them. A ray that meets another source, or none, leaves them unknown: the pick
	 * stays the id target's answer, which is exact at the pixel.
	 */
	private withUv(hit: PickHit, job: Job): PickHit {
		let ray: PickHit | null = null;
		const frame = this.core.glue.pickFrame();
		// A pick that named no frame leaves the coordinates unknown, rather than casting from a
		// camera that did not draw the pixel.
		if (frame >= 0) {
			try {
				ray = this.byRay(job.x, job.y, frame);
			} catch {
				// A ray that cannot run leaves the coordinates unknown: the id target still answered.
			}
		}
		const uv = ray?.uv;
		hit.hasUv =
			ray !== null &&
			ray.object === hit.object &&
			ray.instance === hit.instance &&
			ray.hasUv === true;
		// Fresh numbers for each answer, as a raycast's hit object holds its own: the next pick
		// reuses the ray and its hit.
		hit.uv = [
			hit.hasUv ? (uv?.[0] ?? Number.NaN) : Number.NaN,
			hit.hasUv ? (uv?.[1] ?? Number.NaN) : Number.NaN,
		];
		return hit;
	}

	/** The view of the pick ring's results, made again when the memory grows. */
	private resultView(): Uint32Array {
		const { core } = this;
		core.refresh();
		if (!this.results || this.generation !== core.generation) {
			if (this.resultAddress === 0) this.resultAddress = core.glue.pickResultAddress();
			this.results = core.view(Uint32Array, this.resultAddress, RING * RESULT_WORDS);
			this.generation = core.generation;
		}
		return this.results;
	}
}
