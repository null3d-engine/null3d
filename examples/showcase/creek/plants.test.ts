// A tree that stands narrower than its form. The asset tool's quantized parts keep each part's
// lowest corner in the node's position, so narrowing must scale that offset with the part's width,
// or the tree draws off its placed foot.
import { expect, test } from 'bun:test';
import type { MeshGeometry, SketchContext } from '@null3d/engine';
import { type Part, standPart } from '../../lib/blender-models';

/** A part's rows as one placement writes them. */
interface Rows {
	readonly positions: Float32Array;
	readonly rotations: Float32Array;
	readonly scales: Float32Array;
}

/** Places one part in a context that records the batch's rows. */
function place(part: Part, stand: Parameters<typeof standPart>[2][number]): Rows {
	let rows: Rows | undefined;
	const scene = {
		createInstances: () => {
			rows = {
				positions: new Float32Array(3),
				rotations: new Float32Array(4),
				scales: new Float32Array(3),
			};
			return { ...rows, markDirty() {} };
		},
	};
	standPart({ scene } as unknown as SketchContext, part, [stand], {} as never);
	if (!rows) throw new Error('no batch');
	return rows;
}

/** A quantized part: its vertices start from the node's own lowest corner, at its position. */
const partAt = (corner: number, height: number): Part =>
	({
		mesh: {} as MeshGeometry,
		position: [corner, 0, 0],
		rotation: [0, 0, 0, 1],
		scale: [1, 1, height],
	}) as unknown as Part;

test('a narrowed tree narrows about its placed foot, its parts keeping their places', () => {
	const at = [-16.2, 0.4, 0] as const;
	const size = 1.08;
	const yaw = 0.2;
	for (const corner of [-4.731, -5.779]) {
		const part = partAt(corner, 1.5);
		const full = place(part, { x: at[0], y: at[1], z: at[2], yaw, size });
		const narrow = place(part, { x: at[0], y: at[1], z: at[2], yaw, size, width: 0.75 });
		// The part's corner lands a quarter less far from the foot, along the model's own x.
		for (let i = 0; i < 3; i++)
			expect(
				(narrow.positions[i] as number) - at[i],
				`part ${corner}, axis ${i}: its offset from the placed foot`,
			).toBeCloseTo(0.75 * ((full.positions[i] as number) - at[i]), 5);
		// Its height and depth keep their size; only its width narrows.
		expect(narrow.scales[0]).toBeCloseTo(0.75 * (full.scales[0] as number), 5);
		expect(narrow.scales[1]).toBeCloseTo(full.scales[1] as number, 5);
		expect(narrow.scales[2]).toBeCloseTo(full.scales[2] as number, 5);
	}
});
