// The card levels: each shoot row becomes its prototype's three card planes in the first card
// level, in plant space. The second level keeps every second card of the first in the rows'
// space-filling order, and each kept card grows about its middle by the square root of that step,
// so the thinned crown covers about as much as the full one (D-241's card rule).
//
// A card vertex carries its row's wind record (high and low byte, global in the species' table), the
// row's flutter phase, and the row's sky visibility. Its second texture coordinate holds the share
// of the way up the card, for the shoot's bend, and the plane: 0 and 1 for the crossed vertical
// planes, 2 for the horizontal one, over 2.
import type { MeshArrays } from '../asset';
import { normalize3, quatRotate, type Vector3 } from '../core/math';
import { MeshWriter } from '../leaf/writer';
import type { MeshInput } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';

/** A card's corners: signs of its right and up half-extents. */
const CORNERS = [
	[-1, -1],
	[1, -1],
	[1, 1],
	[-1, 1],
] as const;

/**
 * Whether a card level keeps a row, and how much it grows the row's cards: every second row of the
 * level above in the space-filling order, grown by the square root of the step.
 *
 * @param order The row's rank on the space-filling curve.
 * @param level The card level.
 * @returns The growth of the row's cards, or 0 when the level drops it.
 * @category api/vegetation
 */
export function cardKeep(order: number, level: 1 | 2): number {
	const every = 2 ** (level - 1);
	if (order % every !== 0) return 0;
	const grow = Math.sqrt(every);
	return grow;
}

/**
 * The shoot cards of one variant at a card level.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns The cards' mesh.
 */
export function cardMesh(input: MeshInput, level: 1 | 2): MeshArrays {
	const { rows, kit } = input;
	const mesh = new MeshWriter();
	const size = kit.cards.size || 1;
	const base = input.variant * VARIANT_RECORDS;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	for (let r = 0; r < rows.count; r++) {
		const grow = cardKeep(rows.order[r] as number, level);
		if (grow === 0) continue;
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		const scale = rows.scale[r] as number;
		const record = base + (rows.record[r] as number);
		const colour = [
			(record >>> 8) & 255,
			record & 255,
			rows.phase[r] as number,
			rows.sky[r] as number,
		];
		const px = rows.position[r * 3] as number;
		const py = rows.position[r * 3 + 1] as number;
		const pz = rows.position[r * 3 + 2] as number;
		prototype.card.planes.forEach((plane, k) => {
			const n = normalize3([
				plane.right[1] * plane.up[2] - plane.right[2] * plane.up[1],
				plane.right[2] * plane.up[0] - plane.right[0] * plane.up[2],
				plane.right[0] * plane.up[1] - plane.right[1] * plane.up[0],
			]);
			const normal = quatRotate(rows.rotation, r * 4, n, [0, 0, 0]);
			const first = mesh.vertices;
			const [rx, ry, rw, rh] = plane.front;
			for (const [sx, sy] of CORNERS) {
				for (let c = 0; c < 3; c++)
					local[c] =
						((plane.centre[c] as number) +
							grow * (sx * (plane.right[c] as number) + sy * (plane.up[c] as number))) *
						scale;
				quatRotate(rows.rotation, r * 4, local, world);
				mesh.vertex(
					[px + world[0], py + world[1], pz + world[2]],
					normal,
					[(rx + ((sx + 1) / 2) * rw) / size, (ry + ((sy + 1) / 2) * rh) / size],
					[(sy + 1) / 2, k / 2],
					colour,
				);
			}
			mesh.quad(first, first + 1, first + 2, first + 3);
		});
	}
	return mesh.finishMesh();
}
