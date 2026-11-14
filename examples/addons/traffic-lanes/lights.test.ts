// The real-light search: the pool of lights goes to the cars nearest the camera. The lanes near the
// camera are read in full, so the pool holds the true nearest cars, whatever the count. The search
// keeps its choice between searches, so a car near the edge does not switch on and off.
import { expect, test } from 'bun:test';
import {
	type LaneSearch,
	LIGHT_KEEP,
	LIGHT_SECONDS,
	type LightPool,
	laneGroups,
	moveLights,
} from './lights';

/** An empty pool of `slots` lights, before its first search. */
function freshPool(slots: number): LightPool {
	return {
		distance: new Float32Array(slots).fill(Number.POSITIVE_INFINITY),
		place: new Float32Array(slots * 3),
		key: new Int32Array(slots).fill(-1),
		searchedAt: Number.NEGATIVE_INFINITY,
	};
}

/** One still car on a lane that runs along x, which the eye reads from `x`. */
function stillCar(x: number, y: number, z: number): LaneSearch {
	const positions = new Float32Array([x, y, z]);
	const values = new Float32Array([0, 0, 1000, 0]);
	return {
		alongX: true,
		yaw: Math.PI / 2,
		active: 1,
		batch: { positions, values },
		groups: laneGroups(positions, 1, true),
	};
}

/** A car's place at `time`, as the vertex shader moves it along an x-aligned lane. */
function carPlace(
	positions: Float32Array,
	values: Float32Array,
	k: number,
	time: number,
): number[] {
	const length = values[k * 4 + 2] as number;
	const travelled = (values[k * 4] as number) + time * (values[k * 4 + 1] as number);
	const at = travelled - length * Math.floor(travelled / length);
	return [
		(positions[k * 3] as number) + at,
		positions[k * 3 + 1] as number,
		positions[k * 3 + 2] as number,
	];
}

/** The squared distance between two places. */
const gap = (a: ArrayLike<number>, b: ArrayLike<number>): number =>
	((a[0] as number) - (b[0] as number)) ** 2 +
	((a[1] as number) - (b[1] as number)) ** 2 +
	((a[2] as number) - (b[2] as number)) ** 2;

/** The true nearest cars within `range` of the eye, nearest first. */
function nearest(
	searches: readonly LaneSearch[],
	eye: readonly number[],
	time: number,
	range: number,
): number[][] {
	const places: number[][] = [];
	for (const search of searches) {
		const values = search.batch.values as Float32Array;
		for (let k = 0; k < search.active; k++) {
			const place = carPlace(search.batch.positions, values, k, time);
			if (gap(place, eye) <= range * range) places.push(place);
		}
	}
	return places.sort((a, b) => gap(a, eye) - gap(b, eye));
}

/**
 * One heading's traffic over lanes across the way and levels of height, with `rows` cars spread
 * evenly along each lane.
 */
function traffic(rows: number): { search: LaneSearch; truth: number[][] } {
	const across = [-40, -20, -10, -5, 0, 5, 10, 20, 40];
	const levels = [10, 20, 30, 40];
	const perLane = Math.ceil(rows / (across.length * levels.length));
	const count = perLane * across.length * levels.length;
	const positions = new Float32Array(count * 3);
	const values = new Float32Array(count * 4);
	let k = 0;
	for (const line of across)
		for (const level of levels)
			for (let slot = 0; slot < perLane; slot++, k++) {
				positions[k * 3] = 0;
				positions[k * 3 + 1] = level;
				positions[k * 3 + 2] = line;
				values[k * 4] = (slot / perLane) * 1000;
				values[k * 4 + 1] = 30;
				values[k * 4 + 2] = 1000;
				values[k * 4 + 3] = 0;
			}
	const search: LaneSearch = {
		alongX: true,
		yaw: Math.PI / 2,
		active: count,
		batch: { positions, values },
		groups: laneGroups(positions, count, true),
	};
	const eye = [3, 26, 4];
	return { search, truth: nearest([search], eye, 0, 150) };
}

test('the rows of one lane group together, whatever their order', () => {
	// Three lanes at across -2, 0 and 5, whose rows are interleaved, and two heights in the middle.
	const positions = new Float32Array(6 * 3);
	const rows = [
		[-2, 10],
		[0, 10],
		[-2, 12],
		[0, 20],
		[5, 10],
		[0, 10],
	];
	for (let k = 0; k < rows.length; k++) {
		positions[k * 3 + 1] = rows[k]?.[1] as number;
		positions[k * 3 + 2] = rows[k]?.[0] as number;
	}
	const groups = laneGroups(positions, rows.length, true);
	expect(groups.map((group) => group.across)).toEqual([-2, 0, 5]);
	expect(groups[0]?.rows).toEqual([0, 2]);
	expect(groups[1]?.rows).toEqual([1, 3, 5]);
	expect(groups[1]?.yMin).toBe(10);
	expect(groups[1]?.yMax).toBe(20);
});

for (const rows of [30_000, 100_000]) {
	test(`at ${rows} rows the pool holds the nearest cars`, () => {
		const { search, truth } = traffic(rows);
		const pool = freshPool(6);
		moveLights([search], [3, 26, 4], 0, 150, pool);
		const found = truth.slice(0, 6).map((place) => ({
			place,
			distance: Math.sqrt(gap(place, [3, 26, 4])),
		}));
		// The pool's slots are unsorted: compare the near cars as a set, by their distances.
		const held = Array.from({ length: 6 }, (_, slot) => ({
			distance: pool.distance[slot] as number,
			place: [pool.place[slot * 3], pool.place[slot * 3 + 1], pool.place[slot * 3 + 2]],
		})).sort((a, b) => a.distance - b.distance);
		for (let slot = 0; slot < 6; slot++) {
			expect(held[slot]?.distance).toBeCloseTo(found[slot]?.distance as number, 3);
			expect(gap(held[slot]?.place as number[], found[slot]?.place as number[])).toBeLessThan(1e-6);
		}
		// The nearest car itself has a light, which a fixed share of the rows often missed.
		const first = truth[0] as number[];
		expect(held.some((slot) => gap(slot.place, first) < 1e-6)).toBe(true);
	});
}

test('the pool turns off when no car is near', () => {
	const { search } = traffic(30_000);
	const pool = freshPool(4);
	moveLights([search], [0, 5000, 0], 0, 150, pool);
	expect(Array.from(pool.distance)).toEqual([Infinity, Infinity, Infinity, Infinity]);
});

test('the search keeps its choice between searches', () => {
	const { search } = traffic(30_000);
	const pool = freshPool(1);
	const eye = [3, 26, 4];
	expect(moveLights([search], eye, 0, 150, pool)).toBe(true);
	const held = pool.place[0] as number;
	// The eye moves far away, but a call inside the cadence does not search, so the light stays.
	expect(moveLights([search], [5000, 26, 4], LIGHT_SECONDS / 2, 150, pool)).toBe(false);
	expect(pool.place[0]).toBe(held);
	// Once the cadence passes, the search follows the eye and turns the light off.
	expect(moveLights([search], [5000, 26, 4], LIGHT_SECONDS, 150, pool)).toBe(true);
	expect(pool.distance[0]).toBe(Infinity);
});

test('a car at the edge keeps its light a little past the range', () => {
	const car = stillCar(0, 0, 0);
	const pool = freshPool(1);
	const range = 150;
	// The car starts inside the range, so it takes the light.
	moveLights([car], [range - 1, 0, 0], 0, range, pool);
	expect(pool.distance[0]).toBe(range - 1);
	// The eye moves so that the car is just past the range: the car keeps the light, so a camera
	// that drifts across the edge cannot blink it.
	const past = (range + range * LIGHT_KEEP) / 2;
	moveLights([car], [past, 0, 0], LIGHT_SECONDS, range, pool);
	expect(pool.distance[0]).toBe(past);
	// Past the kept range, the light goes to nobody and the car turns off.
	const beyond = range * LIGHT_KEEP + 1;
	moveLights([car], [beyond, 0, 0], LIGHT_SECONDS * 2, range, pool);
	expect(pool.distance[0]).toBe(Infinity);
	// A car that never held a light enters only inside the range.
	const fresh = freshPool(1);
	moveLights([car], [past, 0, 0], 0, range, fresh);
	expect(fresh.distance[0]).toBe(Infinity);
});
