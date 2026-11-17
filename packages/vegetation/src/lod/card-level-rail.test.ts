// The second card level is the band the plan cannot move. Its clump cards keep three pictures a
// side and the mesh the shipped head drew, while the first card level tiles four. The figures below
// are frozen from the shipped head, so a change to a tile constant, or to the second level's card
// placement, fails here before a picture reaches a reviewer.
//
// The mesh is the planned oak's, at the standard seed and variant and the low tier: the species that
// draws the tiled clump cards at both card levels. Its positions and indices are quantised, so the
// counts and the digests are the same on every run of the same head.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset } from '../asset';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { tilesAt } from './cards';

/** A species grows its three levels; a busy machine takes a while. */
const LONG = scaledBudget(120_000);

/** The species and the standard plant whose second card level is frozen. */
const SPECIES = 'pedunculate-oak';
const SEED = 11;
const VARIANT = 0;

/** A digest of a mesh array's values, little-endian, so a moved vertex or a changed index shows. */
function digest(array: Uint16Array | Uint32Array): string {
	const bytes = array.BYTES_PER_ELEMENT;
	let hash = 0x811c9dc5;
	for (let i = 0; i < array.length; i++) {
		let value = array[i] as number;
		for (let byte = 0; byte < bytes; byte++) {
			hash ^= value & 0xff;
			hash = Math.imul(hash, 0x01000193) >>> 0;
			value >>>= 8;
		}
	}
	return hash.toString(16).padStart(8, '0');
}

/** The card mesh of one card level: its counts, its bounding box in metres, and its digests. */
async function cardMesh(level: 1 | 2): Promise<{
	vertices: number;
	triangles: number;
	box: readonly number[];
	positions: string;
	indices: string;
}> {
	const module = await loadSpecies(SPECIES as Parameters<typeof loadSpecies>[0]);
	await loadPlantCode(module.record);
	const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
	const asset: PlantAsset = growPlantNow(kit, { seed: SEED, variant: VARIANT, near: true });
	const { min, max } = kit.box;
	let vertices = 0;
	let triangles = 0;
	const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
	const parts: string[] = [];
	const indexParts: string[] = [];
	for (const part of asset.levels[level].parts) {
		if (part.name !== 'cards') continue;
		const { positions, indices } = part.arrays;
		vertices += positions.length / 3;
		triangles += indices.length / 3;
		parts.push(digest(positions));
		indexParts.push(digest(indices));
		for (let i = 0; i < positions.length; i += 3)
			for (let k = 0; k < 3; k++) {
				const at =
					(min[k] as number) +
					(positions[i + k] as number) * (((max[k] as number) - (min[k] as number)) / 65535);
				box[k] = Math.min(box[k] as number, at);
				box[k + 3] = Math.max(box[k + 3] as number, at);
			}
	}
	return {
		vertices,
		triangles,
		box: box.map((value) => Number(value.toFixed(4))),
		positions: parts.join(' '),
		indices: indexParts.join(' '),
	};
}

describe('the card levels the plan cannot move', () => {
	it('tiles the first card level four pictures a side and the second level three', () => {
		expect(tilesAt(1)).toBe(4);
		expect(tilesAt(2)).toBe(3);
	});

	it(
		'draws the second card level with the mesh the shipped head draws',
		async () => {
			const mesh = await cardMesh(2);
			expect([mesh.vertices, mesh.triangles]).toEqual([28_836, 14_418]);
			expect(mesh.box).toEqual([-16.3839, 2.3277, -17.5329, 18.8966, 20.4127, 17.2093]);
			expect([mesh.positions, mesh.indices]).toEqual(['1ae8dfb7', 'd62bf227']);
		},
		LONG,
	);
});
