// The near pool: one per scene, the scene's budget of real pieces. The page gives it its camera and
// calls `update` once a frame; when the camera has moved half a metre, the pool hands its budget out
// over every placement that joined it, nearest copy first, and each placement writes the grants
// into its pools of slots and its copies' card edges. A stand-in kit's pool draws no real shoots.
import type { SketchContext, Vec3Like } from '@null3d/engine';
import { NEAR_CAPS } from '../core/caps';
import { length3 } from '../core/math';
import {
	type BudgetCandidate,
	GRANT_NONE,
	GRANT_SWITCH,
	GRANT_TEXEL,
	handOut,
	nearestFirst,
} from './plant-budget';
import type { PoolMember } from './pooled-shoots';
import { standInNearPool } from './stand-in';

/** Metres the camera moves before the pool hands its budget out again. */
const MOVE = 0.5;

/** The most copies one placement in a pool holds, which spaces the copies' keys. */
const COPIES_PER_PLACEMENT = 16_777_216;

/**
 * The near pool's caps, the preset's by default, and the camera it hands pieces out from.
 *
 * @category api/vegetation
 */
export interface NearPoolOptions {
	/** Copies that draw real pieces at once. */
	readonly copies?: number;
	/** Triangles those copies' pieces may draw together: the scene's budget of real pieces. */
	readonly triangles?: number;
	/** The camera the page draws from, whose place sets the nearest copies. */
	readonly camera?: { getWorldPosition(out: Vec3Like): void };
	/**
	 * The clock the crossfades run on, in seconds: the sketch's time by default. A page that records
	 * a walk frame by frame gives its own.
	 */
	readonly clock?: () => number;
	/** A pool for stand-in kits, which draws no real shoots. */
	readonly placeholders?: boolean;
}

/**
 * The scene's near pool: which copies draw real pieces.
 *
 * @category api/vegetation
 */
export interface NearPool {
	/**
	 * Moves every crossfade on, and reads the camera: hands the budget out again when it has moved
	 * 0.5 m or a slot has finished fading out. Call it once a frame.
	 */
	update(): void;
	/** Copies drawing real pieces now, for the stats overlay and the tests. */
	readonly copies: number;
	/** Triangles of real pieces drawn now, by each copy's own count drawn at once. */
	readonly triangles: number;
	/** Removes the pool's batches and stops its task. */
	destroy(): void;
}

/** The pool as a placement joins it. */
export interface NearPoolHost extends NearPool {
	/** The scene's budget of real pieces. */
	readonly budget: number;
	/**
	 * Adds a placement's copies to the hand-out.
	 *
	 * @returns A call that takes them out again.
	 */
	join(member: PoolMember): () => void;
}

/**
 * Whether a pool is one that placements join, not a stand-in kit's.
 *
 * @param pool The pool.
 * @returns Whether it hands out real pieces.
 */
export function isPoolHost(pool: NearPool | undefined): pool is NearPoolHost {
	return pool !== undefined && 'join' in pool;
}

/**
 * Makes the scene's near pool.
 *
 * @param ctx The sketch's context.
 * @param options The caps, the preset's by default, and the camera.
 * @returns The pool.
 * @category api/vegetation
 */
export function createNearPool(ctx: SketchContext, options: NearPoolOptions = {}): NearPool {
	if (options.placeholders) return standInNearPool();
	const camera = options.camera;
	const clock = options.clock ?? (() => ctx.time.now);
	if (!camera)
		throw new Error('@null3d/vegetation: a near pool needs the camera the page draws from.');
	const caps = NEAR_CAPS[ctx.quality.preset];
	const budget = options.triangles ?? caps.triangles;
	const most = options.copies ?? caps.copies;
	if (!Number.isFinite(budget) || budget < 0)
		throw new Error(`@null3d/vegetation: a near pool of ${budget} triangles is no budget.`);
	const members: { member: PoolMember; serial: number; last: Uint8Array }[] = [];
	let serials = 0;
	const eye = new Float64Array(3);
	const handed = new Float64Array(3);
	let fresh = true;
	let copies = 0;
	let triangles = 0;

	const handAll = (now: number) => {
		const list: BudgetCandidate[] = [];
		const last = new Map<number, number>();
		members.forEach(({ member, serial, last: held }) => {
			const place = member.copies.position;
			for (let copy = 0; copy < member.copies.count; copy++) {
				const costs = member.costOf(copy);
				// A copy's key is its placement's serial and its own index, so its grant stays its own
				// however the list is ordered or culled.
				const id = serial * COPIES_PER_PLACEMENT + copy;
				list.push({
					id,
					distance: length3(
						(place[copy * 3] as number) - (eye[0] as number),
						(place[copy * 3 + 1] as number) - (eye[1] as number),
						(place[copy * 3 + 2] as number) - (eye[2] as number),
					),
					toSwitch: costs.toSwitch,
					toTexel: costs.toTexel,
				});
				if ((held[copy] as number) !== GRANT_NONE) last.set(id, held[copy] as number);
			}
		});
		const grants = handOut(list, budget, last);
		// The nearest copies first, and no more of them than the pool's count of copies.
		const order = nearestFirst(list, last);
		let granted = 0;
		for (const i of order) {
			if (grants[i] === GRANT_NONE) continue;
			if (granted >= most) grants[i] = GRANT_NONE;
			else granted++;
		}
		copies = 0;
		triangles = 0;
		let first = 0;
		members.forEach((entry) => {
			const count = entry.member.copies.count;
			const own = grants.subarray(first, first + count);
			const ownOrder = order.filter((i) => i >= first && i < first + count).map((i) => i - first);
			entry.last = entry.member.apply(own, ownOrder, now);
			entry.last.forEach((grant, copy) => {
				if (grant === GRANT_NONE) return;
				const costs = entry.member.costOf(copy);
				copies++;
				triangles +=
					grant === GRANT_TEXEL ? costs.toTexel : grant === GRANT_SWITCH ? costs.toSwitch : 0;
			});
			first += count;
		});
	};

	const pool: NearPoolHost = {
		budget,
		get copies() {
			return copies;
		},
		get triangles() {
			return triangles;
		},
		join(member) {
			if (member.copies.count > COPIES_PER_PLACEMENT)
				throw new Error(
					`@null3d/vegetation: a placement of ${member.copies.count} copies passes the near pool's ${COPIES_PER_PLACEMENT}.`,
				);
			const entry = { member, serial: serials++, last: new Uint8Array(member.copies.count) };
			members.push(entry);
			fresh = true;
			return () => {
				const at = members.indexOf(entry);
				if (at >= 0) members.splice(at, 1);
				fresh = true;
			};
		},
		update() {
			// The fades move on every frame; a slot whose rows have faded out may go to a waiting copy.
			const now = clock();
			for (const { member } of members) if (member.advance(now)) fresh = true;
			camera.getWorldPosition(eye);
			const moved = length3(
				(eye[0] as number) - (handed[0] as number),
				(eye[1] as number) - (handed[1] as number),
				(eye[2] as number) - (handed[2] as number),
			);
			if (!fresh && moved < MOVE) return;
			fresh = false;
			handed.set(eye);
			handAll(now);
		},
		destroy() {
			members.length = 0;
			copies = 0;
			triangles = 0;
		},
	};
	return pool;
}
