// The row assembler: the leaf form's instanced rows joined into one mesh a prototype at one tier,
// so the far bake and a per-view coverage measure read what the near form draws on the GPU. Each
// row's copy must land where the instance draws it, and its picture coordinates, colours and
// triangles must come through whole.
import { describe, expect, it } from 'bun:test';
import type { ShootRows } from '../asset';
import { quatRotate } from '../core/math';
import { placeholderSkeleton } from '../core/placeholder';
import { DETAILS } from '../core/types';
import { assembleRows, placeShoots } from './instancer';
import { oakRecord, testKit } from './oak.test-support';

/** The oak's kit, its placed rows, and the record they stand on. */
function fixture(): { kit: ReturnType<typeof testKit>; rows: ShootRows } {
	const record = oakRecord();
	const kit = testKit(record);
	const skeleton = placeholderSkeleton({ record, seed: 11, variant: 0, season: 'summer' });
	const rows = placeShoots({ record, seed: 11, variant: 0, season: 'summer', kit, skeleton });
	return { kit, rows };
}

/** The first row of one prototype. */
function firstRow(rows: ShootRows, prototype: number): number {
	for (let r = 0; r < rows.count; r++) if ((rows.prototype[r] as number) === prototype) return r;
	return -1;
}

/** The rows one prototype draws, as the assembler copies them. */
function rowCount(rows: ShootRows, prototype: number): number {
	let count = 0;
	for (let r = 0; r < rows.count; r++) if ((rows.prototype[r] as number) === prototype) count++;
	return count;
}

describe('the row assembler', () => {
	it('places each row where the near form’s instance draws it, at two tiers', () => {
		const { kit, rows } = fixture();
		for (const tier of ['low', 'high'] as const) {
			const index = DETAILS.indexOf(tier);
			const meshes = assembleRows(kit, rows, tier);
			expect(meshes.length).toBeGreaterThan(0);
			for (const mesh of meshes) {
				const arrays = kit.prototypes[mesh.prototype]?.tiers[index];
				expect(arrays).toBeDefined();
				if (!arrays) continue;
				const r = firstRow(rows, mesh.prototype);
				expect(r).toBeGreaterThanOrEqual(0);
				const scale = rows.scale[r] as number;
				const local = [
					(arrays.positions[0] as number) * scale,
					(arrays.positions[1] as number) * scale,
					(arrays.positions[2] as number) * scale,
				] as [number, number, number];
				const want = quatRotate(rows.rotation, r * 4, local, [0, 0, 0]);
				for (let k = 0; k < 3; k++) {
					want[k] = (want[k] as number) + (rows.position[r * 3 + k] as number);
					expect(mesh.positions[k] as number).toBeCloseTo(want[k] as number, 5);
				}
				// A turned normal keeps its length; the picture and the colour bytes are the
				// prototype's own, since the plant shader reads the row's picture coordinates.
				const length = Math.hypot(
					mesh.normals[0] as number,
					mesh.normals[1] as number,
					mesh.normals[2] as number,
				);
				expect(length).toBeCloseTo(1, 4);
				for (let k = 0; k < 2; k++) {
					expect(mesh.uvs[k]).toBe(arrays.uvs[k] as number);
					expect(mesh.uvs1[k]).toBe(arrays.uvs1[k] as number);
				}
				for (let k = 0; k < 4; k++) expect(mesh.colors[k]).toBe(arrays.colors[k] as number);
				// Every row's triangles join, and each index meets its own copy's vertices.
				const copies = rowCount(rows, mesh.prototype);
				expect(mesh.indices.length).toBe(arrays.indices.length * copies);
				if (copies > 1)
					expect(mesh.indices[arrays.indices.length]).toBe(
						arrays.positions.length / 3 + (arrays.indices[0] as number),
					);
			}
		}
	});

	it('keeps a share of the rows when the caller asks for one', () => {
		const { kit, rows } = fixture();
		const all = assembleRows(kit, rows, 'medium');
		const quarter = assembleRows(kit, rows, 'medium', (r) => r % 4 === 0);
		const sum = (meshes: ReturnType<typeof assembleRows>) =>
			meshes.reduce((total, mesh) => total + mesh.indices.length / 3, 0);
		expect(sum(quarter)).toBeGreaterThan(0);
		expect(sum(quarter)).toBeLessThan(sum(all) / 3);
	});
});
