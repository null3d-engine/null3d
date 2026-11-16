// Skyway's roaming cars: flown for minutes of sketch time, they stay on the streets and inside the
// city, never enter a tower, turn at junctions, change height, and stop at the kerb now and then.
import { expect, test } from 'bun:test';
import { cityTowers } from './drive';
import { BLOCKS, STREET, streetLine } from './layout';
import { makeRoamer, ROAMING, type Roamer, stepRoamer } from './roamers';

/** A small seeded random source, so a run is the same every time. */
function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};
}

const LINES = Array.from({ length: BLOCKS + 1 }, (_, k) => streetLine(k));
const TOWERS = cityTowers();
/** How far a car may stray from a street's middle line: the kerb, and a turn's corner cut. */
const STREET_REACH = STREET / 2;

/** True when the place is over a street: near a street's middle line along x or along z. */
const onStreet = (x: number, z: number): boolean =>
	LINES.some((line) => Math.abs(x - line) <= STREET_REACH || Math.abs(z - line) <= STREET_REACH);

/** True when the place is inside a tower's box, under its roof. */
function inTower(x: number, y: number, z: number): boolean {
	for (let k = 0; k < TOWERS.length; k += 5) {
		if (y >= (TOWERS[k + 4] as number)) continue;
		if (
			Math.abs(x - (TOWERS[k] as number)) < (TOWERS[k + 2] as number) &&
			Math.abs(z - (TOWERS[k + 1] as number)) < (TOWERS[k + 3] as number)
		)
			return true;
	}
	return false;
}

test('roamers stay on the streets, in the city and out of the towers, and turn, climb and park', () => {
	const random = seeded(7);
	const roamers: Roamer[] = Array.from({ length: 40 }, () => makeRoamer(random));
	const FRAME = 1 / 60;
	const seen = { turns: 0, parks: 0, climbs: 0 };
	const was = roamers.map((r) => ({ mode: r.mode, height: r.height }));
	// A roamer on an outer street may park at its outer kerb, still on the street.
	const low = (LINES[0] as number) - STREET / 2;
	const high = (LINES[BLOCKS] as number) + STREET / 2;
	for (let frame = 0; frame < 120 * 60; frame++) {
		roamers.forEach((r, k) => {
			stepRoamer(r, FRAME, random);
			const before = was[k] as { mode: string; height: number };
			if (r.mode === 'turn' && before.mode !== 'turn') seen.turns++;
			if (r.mode === 'parked' && before.mode !== 'parked') seen.parks++;
			if (r.height !== before.height) seen.climbs++;
			before.mode = r.mode;
			before.height = r.height;
			expect(r.x).toBeGreaterThanOrEqual(low);
			expect(r.x).toBeLessThanOrEqual(high);
			expect(r.z).toBeGreaterThanOrEqual(low);
			expect(r.z).toBeLessThanOrEqual(high);
			if (!onStreet(r.x, r.z)) throw new Error(`a roamer left the streets at ${r.x}, ${r.z}`);
			if (inTower(r.x, r.y, r.z))
				throw new Error(`a roamer flew into a tower at ${r.x}, ${r.y}, ${r.z}`);
		});
	}
	expect(seen.turns).toBeGreaterThan(40);
	expect(seen.parks).toBeGreaterThan(3);
	expect(seen.climbs).toBeGreaterThan(20);
});

test('a parked roamer sits at the kerb, near the street, and still', () => {
	const random = seeded(3);
	const roamers: Roamer[] = Array.from({ length: 40 }, () => makeRoamer(random));
	for (let frame = 0; frame < 120 * 60; frame++) {
		for (const r of roamers) {
			stepRoamer(r, 1 / 60, random);
			if (r.mode === 'parked') {
				expect(r.y).toBeCloseTo(ROAMING.ground, 3);
				expect(r.side).toBe(ROAMING.kerb);
				expect(r.speed).toBe(0);
				return;
			}
		}
	}
	throw new Error('no roamer parked in two minutes');
});
