// The far envelope's own promises: a closed body, one that holds the leaf form's extent, and one
// that stands inside the form's own box. A body that fails closure cannot promise a covered share;
// one that fails the extent can thin against the leaves it pictures.
import { describe, expect, it } from 'bun:test';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { loadSpecies } from '../core/registry';
import type { MeshArrays } from '../asset';
import { foliageEnvelope } from './envelope';
import { dequantisePosition } from './quantise';

/** How many times each undirected edge of vertices stands in the mesh. */
function edgeCounts(mesh: MeshArrays): Map<string, number> {
	const counts = new Map<string, number>();
	for (let i = 0; i < mesh.indices.length; i += 3) {
		const a = mesh.indices[i] as number;
		const b = mesh.indices[i + 1] as number;
		const c = mesh.indices[i + 2] as number;
		for (const [from, to] of [
			[a, b],
			[b, c],
			[c, a],
		] as const) {
			const key = from < to ? `${from}|${to}` : `${to}|${from}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}

const SPECIES = ['pedunculate-oak', 'silver-birch', 'weeping-willow', 'scots-pine'] as const;

describe('the far envelope', () => {
	for (const id of SPECIES)
		it(`closes the ${id}'s leaf form and holds its extent`, async () => {
			const module = await loadSpecies(id);
			await loadPlantCode(module.record);
			const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
			const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
			const body = foliageEnvelope(kit, asset);
			expect(body.indices.length).toBeGreaterThan(0);
			// A closed body: every edge in exactly two triangles, and no vertex left on a boundary.
			const counts = edgeCounts(body);
			let open = 0;
			for (const count of counts.values()) if (count !== 2) open++;
			expect([id, open]).toEqual([id, 0]);
			// The body holds the leaf form's own extent in every direction.
			const box = (positions: Float32Array) => {
				const low = [Infinity, Infinity, Infinity];
				const high = [-Infinity, -Infinity, -Infinity];
				for (let i = 0; i < positions.length; i += 3)
					for (let k = 0; k < 3; k++) {
						low[k] = Math.min(low[k] as number, positions[i + k] as number);
						high[k] = Math.max(high[k] as number, positions[i + k] as number);
					}
				return { low, high };
			};
			const form: number[] = [];
			const parts = asset.levels[0]?.parts ?? [];
			const merged = !parts.some((part) => part.name === 'foliage' || part.name === 'cards' || part.name === 'extras');
			for (const part of parts)
				if (merged ? true : part.name === 'foliage' || part.name === 'cards' || part.name === 'extras') {
					const point: [number, number, number] = [0, 0, 0];
					for (let i = 0; i < part.arrays.positions.length / 3; i++) {
						dequantisePosition(part.arrays.positions, i, kit.box, point);
						form.push(point[0], point[1], point[2]);
					}
				}
			const own = box(new Float32Array(form));
			const far = box(body.positions);
			for (let k = 0; k < 3; k++) {
				const slack = (own.high[k] as number) - (own.low[k] as number);
				expect([id, k, (far.low[k] as number) <= (own.low[k] as number) + slack * 0.02]).toEqual([
					id,
					k,
					true,
				]);
				expect([id, k, (far.high[k] as number) >= (own.high[k] as number) - slack * 0.02]).toEqual([
					id,
					k,
					true,
				]);
			}
		});
});
