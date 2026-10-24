// The real-light search: the pool of point lights goes to the cars nearest the camera. Cars sit on
// straight lanes, so the search skips a lane whose line runs farther from the eye than the light's
// range before it reads a row. The cost follows the lanes near the camera, not the whole count.

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

/** The nearest cars that a search found: their distance from the eye, and their places, slot by slot. */
export interface LightPool {
	distance: Float32Array;
	place: Float32Array;
}

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
 * the pool holds the real nearest cars, whatever the count.
 */
export function moveLights(
	searches: readonly LaneSearch[],
	eye: ArrayLike<number>,
	time: number,
	range: number,
	pool: LightPool,
): void {
	const { distance: bestDistance, place: bestPlace } = pool;
	const lights = bestDistance.length;
	bestDistance.fill(Number.POSITIVE_INFINITY);
	const eyeX = eye[0] as number;
	const eyeY = eye[1] as number;
	const eyeZ = eye[2] as number;
	for (const search of searches) {
		if (search.active === 0) continue;
		const values = search.batch.values;
		if (values === undefined) continue;
		const positions = search.batch.positions;
		const along = [Math.sin(search.yaw), Math.cos(search.yaw)] as const;
		// The eye's coordinate across this heading's lanes.
		const eyeAcross = search.alongX ? eyeZ : eyeX;
		for (const group of search.groups) {
			// No car of a lane whose line runs farther from the eye than the light's range can be in
			// range, so the lane's rows are not read.
			const across = Math.abs(group.across - eyeAcross);
			const dy = eyeY < group.yMin ? group.yMin - eyeY : eyeY > group.yMax ? eyeY - group.yMax : 0;
			if (Math.hypot(across, dy) > range) continue;
			for (const k of group.rows) {
				if (k >= search.active) continue;
				const lane = values[k * 4 + 2] as number;
				const travelled = (values[k * 4] as number) + time * (values[k * 4 + 1] as number);
				const at = travelled - lane * Math.floor(travelled / lane);
				const x = (positions[k * 3] as number) + along[0] * at;
				const y = positions[k * 3 + 1] as number;
				const z = (positions[k * 3 + 2] as number) + along[1] * at;
				const gap = Math.hypot(x - eyeX, y - eyeY, z - eyeZ);
				if (gap > range) continue;
				// The farthest light that this one beats takes its place.
				let worst = -1;
				let worstDistance = gap;
				for (let slot = 0; slot < lights; slot++) {
					const held = bestDistance[slot] as number;
					if (held > worstDistance) {
						worst = slot;
						worstDistance = held;
					}
				}
				if (worst < 0) continue;
				bestDistance[worst] = gap;
				bestPlace[worst * 3] = x;
				bestPlace[worst * 3 + 1] = y;
				bestPlace[worst * 3 + 2] = z;
			}
		}
	}
}
