// Every model and step that the garden places touches its ground, with no air under any part of its
// footprint, and none stands in another's way: the statue's slab sits on its ledge, the ledge stands
// on the terrace, each step's body reaches into the ground under it, the wall stones rest on the
// ground or on the course below, and no lantern, gate or rock stands on the steps or on another's
// foot. A model or a step raised off its ground fails these tests.
import { expect, test } from 'bun:test';
import { gardenPlaces, ledgePoint, RING, SLAB_REACH } from './garden';
import { alongFlight, flights, groundHeight, STAIRS } from './land';
import { slabPlaces, wallPlaces } from './steps';

/** The ground's lowest point under a footprint, read densely: its middle and four rings. */
function lowest(x: number, z: number, reach: number): number {
	let low = groundHeight(x, z);
	for (const share of [0.25, 0.5, 0.75, 1])
		for (let k = 0; k < 24; k++) {
			const angle = (k / 24) * Math.PI * 2;
			low = Math.min(
				low,
				groundHeight(x + Math.cos(angle) * reach * share, z + Math.sin(angle) * reach * share),
			);
		}
	return low;
}

test('each lantern, the gate and every rock stands on the lowest ground under its footprint', () => {
	const { gate, lanterns, rocks, ring } = gardenPlaces();
	const models = [gate, ...lanterns, ...rocks, ...ring];
	expect(models.length).toBeGreaterThan(20);
	for (const { x, y, z, reach } of models)
		expect(
			y - lowest(x, z, reach),
			`the air under a model at ${x.toFixed(1)}, ${z.toFixed(1)}`,
		).toBeLessThan(0.02);
});

test("the statue's slab sits on the ledge's flat top, which stands over the terrace", () => {
	const { ledge, statue } = gardenPlaces();
	let [high, low] = [-Infinity, Infinity];
	for (const point of ledge.outline) {
		const [x, z] = ledgePoint(ledge, point);
		low = Math.min(low, groundHeight(x, z));
		// Where the top flight cuts into the ledge, the ground beside it is the flight's own ramp, which
		// rises to the ledge's top.
		const onSteps = flights().some((flight) => {
			const { t, side } = alongFlight(flight, x, z);
			return t > 0 && t < 1.1 && side < STAIRS.half + STAIRS.keep + STAIRS.blend;
		});
		if (!onSteps) high = Math.max(high, groundHeight(x, z));
	}
	// The top stands clear of all the ground under the outline, and the foot reaches below it.
	expect(ledge.top - high).toBeGreaterThan(0.2);
	expect(ledge.foot).toBeLessThan(low);
	// The ledge's top reaches past the slab's widest outline all round, so no part of the slab's rim
	// hangs past its edge.
	for (const [x, z] of ledge.outline) {
		const angle = Math.atan2(z, x);
		const slab =
			(statue.size * (1 + SLAB_REACH.swell)) /
			Math.hypot(Math.cos(angle) / SLAB_REACH.long, Math.sin(angle) / SLAB_REACH.wide);
		expect(Math.hypot(x, z), 'the ledge inside the slab').toBeGreaterThan(slab);
	}
	// The ring's blocks stand about level with the ledge's top, never over the highest that the ring
	// allows, so none stands up past the slab's foot.
	for (const block of gardenPlaces().ring) {
		expect(block.top - ledge.top, 'a ring block over the ledge').toBeLessThan(RING.top[1] + 0.005);
		expect(block.top - ledge.top, 'a ring block sunk out of sight').toBeGreaterThan(-0.5);
	}
	// The slab model's rim lies 5 cm under its origin: it rests on the ledge's top, with no air.
	expect(Math.abs(statue.y - 0.05 * statue.size - ledge.top)).toBeLessThan(0.01);
});

test("every step's slab reaches into the ground under it, and its tread stands above it", () => {
	const slabs = slabPlaces();
	expect(slabs.length).toBeGreaterThan(50);
	for (const slab of slabs) {
		const [fx, fz] = [Math.cos(slab.heading), Math.sin(slab.heading)];
		const [sx, sz] = [-fz, fx];
		const corner = (a: number, b: number) =>
			groundHeight(
				slab.middle[0] + sx * a * slab.half + fx * b,
				slab.middle[1] + sz * a * slab.half + fz * b,
			);
		const reach = slab.depth * 1.25;
		for (const a of [slab.from, slab.to])
			for (const b of [-reach, reach])
				expect(corner(a, b) - slab.bottom, 'the body under a corner').toBeGreaterThan(0.05);
		expect(
			slab.top - corner((slab.from + slab.to) / 2, 0),
			'the tread over the ground',
		).toBeGreaterThan(0);
	}
});

test('each wall stone rests on the ground or on the course below it', () => {
	const stones = wallPlaces();
	expect(stones.length).toBeGreaterThan(50);
	for (const { x, y, z, size } of stones) {
		// A wall stone is half as tall as it is long: its underside lies a quarter of its size down.
		const underside = y - size * 0.25;
		expect(underside - lowest(x, z, size * 1.2), 'the air under a wall stone').toBeLessThan(
			0.1 * size,
		);
	}
});

test('no lantern, rock or the statue stands on the steps, and no two models share a foot', () => {
	const { statue, gate, lanterns, rocks, ring } = gardenPlaces();
	for (const model of [statue, ...lanterns, ...rocks, ...ring])
		for (const flight of flights()) {
			const { t, side } = alongFlight(flight, model.x, model.z);
			const onFlight = t > 0 && t < 1 && side < STAIRS.half + model.reach;
			// The statue's ledge stands at the head of its flights, which reach up to its edge.
			if (model === statue) continue;
			expect(onFlight, `a model on a flight at ${model.x.toFixed(1)}, ${model.z.toFixed(1)}`).toBe(
				false,
			);
		}
	// Lanterns, the gate and the statue keep apart from each other and from every rock; the rocks of
	// one outcrop may touch, as bedrock does, and the ring's blocks stand on the ledge's own edge.
	const singles = [statue, gate, ...lanterns];
	for (const [i, a] of singles.entries())
		for (const b of [...singles.slice(i + 1), ...rocks])
			expect(Math.hypot(a.x - b.x, a.z - b.z), 'two feet that overlap').toBeGreaterThan(
				a.reach + b.reach - 0.3,
			);
});
