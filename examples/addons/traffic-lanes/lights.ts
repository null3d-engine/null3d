// The real-light search: the pool of point lights goes to the cars nearest the camera. Cars sit on
// straight lanes, so the search skips a lane whose line runs farther from the eye than the light's
// range before it reads a row. The cost follows the lanes near the camera, not the whole count.
//
// The search runs at a fixed cadence, and a car that already holds a light keeps it a little past
// the range. A car near the edge therefore cannot switch on and off as the eye moves: the shortest
// time it spends lit or dark is one cadence, and the cadence is what the cost is paid at.

/** The rows of one lane, which the search skips or walks as a whole. */
export interface LaneGroup {
	/** The lane's line across the way, which every row of the lane shares. */
	across: number;
	/** The lowest and highest a row of the lane sits above the ground. */
	yMin: number;
	yMax: number;
	/** The rows of the lane, in the batch's own order. */
	rows: number[];
}

/** One heading's rows, as the search reads them. */
export interface LaneSearch {
	/** True when the lane runs along x, so its fixed coordinate is z. */
	alongX: boolean;
	/** The heading, as the yaw that turns a vehicle's nose from +Z onto its lane. */
	yaw: number;
	/** The rows that draw now: the first ones of the batch. */
	active: number;
	batch: { positions: Float32Array; values: Float32Array | undefined };
	groups: readonly LaneGroup[];
}

/** A place in the scene, read by index, which the engine's vectors and plain arrays both are. */
export type Place = { [index: number]: number };

/**
 * The nearest cars that a search found: their distance from the eye, their places and their rows,
 * slot by slot, and when the search last ran.
 */
export interface LightPool {
	distance: Float32Array;
	place: Float32Array;
	/** The row that each slot holds, or -1 where the slot is empty. */
	key: Int32Array;
	/** The time of the last search, in seconds, or -Infinity before the first. */
	searchedAt: number;
}

/** How far from the camera a real light may sit, in meters. */
export const LIGHT_RANGE = 150;

/** How long the pool waits between searches, in seconds. */
export const LIGHT_SECONDS = 0.25;

/**
 * How much farther than the range a car keeps the light it already holds, as a share of the range.
 * The margin is wider than the distance a car covers in one search, so a crossing is settled once.
 */
export const LIGHT_KEEP = 1.2;

/**
 * The number of rows that one search's keys leave room for. A key packs the search's place in the
 * list and the row into one number, so rows far past any real count cannot share a key.
 */
const ROWS_PER_SEARCH = 2 ** 21;

/**
 * Groups the rows of a batch by the lane's line. The rows of one lane share the exact coordinate
 * across the way, so a map of that value finds them, and each group keeps the height range that its
 * rows span.
 */
export function laneGroups(positions: Float32Array, rows: number, alongX: boolean): LaneGroup[] {
	const groups: LaneGroup[] = [];
	const byAcross = new Map<number, LaneGroup>();
	for (let k = 0; k < rows; k++) {
		const y = positions[k * 3 + 1] as number;
		const across = (alongX ? positions[k * 3 + 2] : positions[k * 3]) as number;
		let group = byAcross.get(across);
		if (group === undefined) {
			group = { across, yMin: y, yMax: y, rows: [] };
			byAcross.set(across, group);
			groups.push(group);
		} else {
			if (y < group.yMin) group.yMin = y;
			if (y > group.yMax) group.yMax = y;
		}
		group.rows.push(k);
	}
	return groups;
}

/**
 * Moves the pool to the cars nearest `eye` at `time`, within `range`, and leaves a slot at an
 * infinite distance when no car fills it. The search reads every car of the lanes near the eye, so
 * the pool holds the real nearest cars, whatever the count. It runs at most once per
 * `LIGHT_SECONDS`, and returns false on the calls between, which leave the pool as it was. The
 * searches are read in the order given, which must not change between calls, because a slot's row
 * is what carries a light from one search to the next.
 */
export function moveLights(
	searches: readonly LaneSearch[],
	eye: Place,
	time: number,
	range: number,
	pool: LightPool,
): boolean {
	if (time - pool.searchedAt < LIGHT_SECONDS) return false;
	pool.searchedAt = time;
	const { distance: bestDistance, place: bestPlace, key: bestKey } = pool;
	const lights = bestDistance.length;
	// The cars that hold a light now, read before the search clears the slots. One of them keeps its
	// light out to a little past the range, so a car at the edge does not switch as the eye moves.
	const kept = bestKey.slice();
	const keepRange = range * LIGHT_KEEP;
	const keepSquared = keepRange * keepRange;
	const rangeSquared = range * range;
	// The slots hold squared distances while the search compares them, which saves a square root for
	// every row it reads. They turn back into distances for the caller once the search ends.
	bestDistance.fill(Number.POSITIVE_INFINITY);
	bestKey.fill(-1);
	const eyeX = eye[0] as number;
	const eyeY = eye[1] as number;
	const eyeZ = eye[2] as number;
	for (let s = 0; s < searches.length; s++) {
		const search = searches[s] as LaneSearch;
		if (search.active === 0) continue;
		const values = search.batch.values;
		if (values === undefined) continue;
		const positions = search.batch.positions;
		const along = [Math.sin(search.yaw), Math.cos(search.yaw)] as const;
		// The eye's coordinate across this heading's lanes.
		const eyeAcross = search.alongX ? eyeZ : eyeX;
		for (const group of search.groups) {
			// No car of a lane whose line runs farther from the eye than even a kept light reaches can
			// be in range, so the lane's rows are not read.
			const across = Math.abs(group.across - eyeAcross);
			const dy = eyeY < group.yMin ? group.yMin - eyeY : eyeY > group.yMax ? eyeY - group.yMax : 0;
			if (across * across + dy * dy > keepSquared) continue;
			for (const k of group.rows) {
				if (k >= search.active) continue;
				const key = s * ROWS_PER_SEARCH + k;
				let reachSquared = rangeSquared;
				for (let slot = 0; slot < lights; slot++) {
					if (kept[slot] === key) {
						reachSquared = keepSquared;
						break;
					}
				}
				const lane = values[k * 4 + 2] as number;
				const travelled = (values[k * 4] as number) + time * (values[k * 4 + 1] as number);
				const at = travelled - lane * Math.floor(travelled / lane);
				const x = (positions[k * 3] as number) + along[0] * at;
				const y = positions[k * 3 + 1] as number;
				const z = (positions[k * 3 + 2] as number) + along[1] * at;
				const dx = x - eyeX;
				const dyToCar = y - eyeY;
				const dz = z - eyeZ;
				const gapSquared = dx * dx + dyToCar * dyToCar + dz * dz;
				if (gapSquared > reachSquared) continue;
				// The farthest light that this one beats takes its place.
				let worst = -1;
				let worstSquared = gapSquared;
				for (let slot = 0; slot < lights; slot++) {
					const held = bestDistance[slot] as number;
					if (held > worstSquared) {
						worst = slot;
						worstSquared = held;
					}
				}
				if (worst < 0) continue;
				bestDistance[worst] = gapSquared;
				bestPlace[worst * 3] = x;
				bestPlace[worst * 3 + 1] = y;
				bestPlace[worst * 3 + 2] = z;
				bestKey[worst] = key;
			}
		}
	}
	for (let slot = 0; slot < lights; slot++) {
		bestDistance[slot] = Math.sqrt(bestDistance[slot] as number);
	}
	return true;
}
