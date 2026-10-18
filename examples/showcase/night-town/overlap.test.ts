// The night town's own geometry must not overlap ([D-170](../../../.dev/decisions/D-170-showcase-camera.md),
// owner, 14 October 2026): two pieces that cross or lie coplanar over one another z-fight and
// shimmer. The test builds every house at its lot, with its roof and a chimney, and fails when a
// pair overlaps, apart from the chimney sunk through the roof on purpose.
import { expect, test } from 'bun:test';
import { findOverlaps, type OverlapPart } from '../../lib/overlap';
import { chimney, house, LOTS } from './houses';

/** A set of vertices moved to a lot: turned about y by `yaw`, then placed at `x` and `z`. */
function placed(positions: readonly number[], x: number, z: number, yaw: number): number[] {
	const c = Math.cos(yaw);
	const s = Math.sin(yaw);
	const out: number[] = [];
	for (let i = 0; i < positions.length; i += 3) {
		const vx = positions[i] as number;
		const vy = positions[i + 1] as number;
		const vz = positions[i + 2] as number;
		out.push(x + vx * c + vz * s, vy, z - vx * s + vz * c);
	}
	return out;
}

/** Every house's walls, roof and chimney, at its own lot. */
function houseParts(): OverlapPart[] {
	const parts: OverlapPart[] = [];
	const pot = chimney();
	LOTS.forEach(([x, z, yaw, width, depth, floors], index) => {
		const { walls, roof } = house(width, depth, floors);
		parts.push({
			name: `h${index}-walls`,
			positions: placed(walls.positions, x, z, yaw),
			indices: walls.indices,
		});
		parts.push({
			name: `h${index}-roof`,
			positions: placed(roof.positions, x, z, yaw),
			indices: roof.indices,
		});
		parts.push({
			name: `h${index}-chimney`,
			positions: placed(pot.positions, x, z, yaw),
			indices: pot.indices,
		});
	});
	return parts;
}

test('the night town houses do not overlap themselves', () => {
	const parts = houseParts();
	// A chimney is sunk through its roof on purpose, so that pair may cross. Every other pair must
	// meet exactly or leave a gap.
	const ignore: string[] = [];
	for (let index = 0; index < LOTS.length; index++)
		for (const side of ['roof', 'walls']) ignore.push(`h${index}-chimney|h${index}-${side}`);
	const found = findOverlaps(parts, { ignore });
	// The report names each fault, so a new one is easy to place.
	expect(
		found.map(
			(overlap) =>
				`${overlap.a} / ${overlap.b} (${overlap.kind}) at ${overlap.at.map((v) => v.toFixed(2)).join(',')}`,
		),
	).toEqual([]);
});
