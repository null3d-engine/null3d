// The cliff's wall hangs from the land's own rim and closes round it: the ring's last column must
// stand exactly where its first does, with the same normal, at every height, or the view would pass
// through the cliff at the seam.
import { expect, test } from 'bun:test';
import { wallArrays } from './cliff';
import { landArrays } from './land';

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
