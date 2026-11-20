// The cliff's wall hangs from the land's own rim and closes round it: the ring's last column must
// stand exactly where its first does, with the same normal, at every height, or the view would pass
// through the cliff at the seam, and the noise that shapes the rock must wrap round the ring, or the
// rock would step where the ring joins. Where the camera may stand past the rim, the rock must stay
// within the reach that the camera's floor keeps clear of.
import { expect, test } from 'bun:test';
import { aroundNoise, pillars, relief, wallArrays } from './cliff';
import { bearingOf, landArrays, OVER_WATER, rimRadius, WALL_REACH, WATER } from './land';

/** The land's detail for the test: coarse, since the seam does not depend on it. */
const QUADS = 48;

test("the wall's top row is the land's rim, and its last column closes on its first", () => {
	const { rim } = landArrays(QUADS);
	const wall = wallArrays(rim);
	const positions = wall.positions as Float32Array;
	const normals = wall.normals as Float32Array;
	const count = rim.length / 3;
	const columns = count + 1;
	const rows = positions.length / 3 / columns;
	expect(rows).toBeGreaterThan(30);
	// The top row: the rim's own vertices, so the wall meets the land with no seam.
	for (let k = 0; k < count; k++)
		for (let axis = 0; axis < 3; axis++)
			expect(positions[k * 3 + axis]).toBe(rim[k * 3 + axis] as number);
	let widest = 0;
	for (let row = 0; row < rows; row++) {
		const first = row * columns * 3;
		const last = (row * columns + count) * 3;
		for (let axis = 0; axis < 3; axis++) {
			expect(positions[last + axis]).toBe(positions[first + axis] as number);
			expect(normals[last + axis]).toBeCloseTo(normals[first + axis] as number, 6);
		}
		// The relief does move the rock off the rim's line below the top, so the check has teeth.
		widest = Math.max(
			widest,
			Math.hypot(
				(positions[first] as number) - (rim[0] as number),
				(positions[first + 2] as number) - (rim[2] as number),
			),
		);
	}
	expect(widest).toBeGreaterThan(0.3);
});

test('the noise along the rim wraps round, so the rock runs on across the ring with no step', () => {
	// The rim's length and the scales and heights that shape the rock: each reading at the ring's end
	// is the reading at its start, and the readings just either side of the join stay close.
	const length = 163.4;
	for (const scale of [0.025, 0.05, 0.08, 0.35, 1.2, 4])
		for (const y of [0, 3.7, 11.2]) {
			expect(aroundNoise(length, length, scale, y, 3)).toBeCloseTo(
				aroundNoise(0, length, scale, y, 3),
				6,
			);
			const step = 0.01;
			const across = Math.abs(
				aroundNoise(length - step, length, scale, y, 3) - aroundNoise(step, length, scale, y, 3),
			);
			expect(across, `the step across the join at scale ${scale}`).toBeLessThan(0.02);
		}
});

test('the rock repeats after a whole turn of the ring, so every noise along the rim wraps', () => {
	// A noise read straight along the rim, rather than round the ring, gives a different rock a turn
	// later, and so a step where the ring joins.
	const length = 163.4;
	const list = pillars(length);
	for (let k = 0; k < 240; k++) {
		const along = (k / 240) * length;
		for (const depth of [0.4, 3.7, 11.2, 19]) {
			const here = relief(list, length, along, depth);
			const turned = relief(list, length, along + length, depth);
			expect(turned.offset, `the rock a turn later at ${along.toFixed(1)} m`).toBeCloseTo(
				here.offset,
				6,
			);
			expect(turned.crack).toBeCloseTo(here.crack, 6);
			expect(turned.tone).toBeCloseTo(here.tone, 6);
		}
	}
});

test('at the heights the camera reaches past the rim, the rock stands within the walls’ reach', () => {
	const { rim } = landArrays(QUADS);
	const positions = wallArrays(rim).positions as Float32Array;
	// The camera keeps above the water's level past the rim, by its floor and its clearance.
	const lowest = WATER + OVER_WATER;
	let checked = 0;
	for (let v = 0; v < positions.length / 3; v++) {
		const [x, y, z] = [
			positions[v * 3] as number,
			positions[v * 3 + 1] as number,
			positions[v * 3 + 2] as number,
		];
		if (y < lowest) continue;
		checked++;
		expect(Math.hypot(x, z) - rimRadius(bearingOf(x, z))).toBeLessThan(WALL_REACH);
	}
	expect(checked).toBeGreaterThan(100);
});
