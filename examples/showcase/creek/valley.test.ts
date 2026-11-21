// The garden's planting: the trees stand by hand where the concept has them, so the test holds each
// to ground where things grow, seated on it, apart from the others and out of the view to the
// statue; and the ground cover keeps off the masks that the rules score zero.
import { expect, test } from 'bun:test';
import { groundHeight } from './land';
import { bare, blocksStatue, placeValley, SIZES, TREES, type TreeKind } from './valley';

const valley = placeValley();

test('each tree stands by hand on ground that grows, seated, apart and out of the view to the statue', () => {
	// Every tree of the list stands: none is dropped for the camera's route.
	expect(valley.trees.length).toBe(TREES.length);
	for (const tree of valley.trees) {
		const at = `the ${tree.kind} at ${tree.x}, ${tree.z}`;
		expect(bare(tree.x, tree.z), `${at} on bare ground`).toBe(false);
		// Its foot lies a little into the ground, so no root shows air under it.
		expect(tree.y - groundHeight(tree.x, tree.z), `${at} over the ground`).toBeLessThan(0);
		expect(blocksStatue(tree), `${at} in the view to the statue`).toBe(false);
		for (const other of valley.trees) {
			if (other === tree) continue;
			// Crowns may touch, as the concept's do, but no two trunks stand within each other's crown.
			const room =
				(SIZES[tree.kind as TreeKind].reach * tree.size +
					SIZES[other.kind as TreeKind].reach * other.size) *
				0.4;
			expect(
				Math.hypot(tree.x - other.x, tree.z - other.z),
				`${at} crowding another`,
			).toBeGreaterThan(room);
		}
	}
});

test('the ground cover grows only where the masks allow, out of the view to the statue', () => {
	expect(valley.plants.length).toBeGreaterThan(30);
	for (const plant of valley.plants) {
		expect(bare(plant.x, plant.z), `a ${plant.kind} on bare ground at ${plant.x}, ${plant.z}`).toBe(
			false,
		);
		expect(blocksStatue(plant), `a ${plant.kind} in the view to the statue`).toBe(false);
	}
});
