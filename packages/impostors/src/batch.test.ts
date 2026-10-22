import { describe, expect, test } from 'bun:test';
import type { InstanceBatch, MeshArrays, Texture } from '@null3d/engine';
import { createImpostors, ImpostorBatch, type ImpostorContext } from './batch';
import type { OctahedralAtlas } from './octahedral';
import { encodeImpostorSurface } from './surface';

/** A stand-in for the engine's instance batch: its row arrays, and the ranges marked dirty. */
function fakeBatch(count: number) {
	const marks: [number, number][] = [];
	return {
		count,
		positions: new Float32Array(count * 3),
		scales: new Float32Array(count * 3),
		marks,
		markDirty(start = 0, rows = count - start) {
			marks.push([start, rows]);
		},
		destroy() {},
	};
}

type FakeBatch = ReturnType<typeof fakeBatch>;

/** A context whose factories record what they were given, over a stand-in batch. */
function fakeContext(count: number) {
	const batch = fakeBatch(count);
	const seen: { quad?: MeshArrays; uniformCells?: readonly number[]; alphaMode?: string } = {};
	const ctx: ImpostorContext = {
		scene: {
			createInstances: () => batch as unknown as InstanceBatch,
		} as unknown as ImpostorContext['scene'],
		materials: {
			shader: (options: { uniforms?: { cells?: readonly number[] }; alphaMode?: string }) => {
				seen.uniformCells = options.uniforms?.cells;
				seen.alphaMode = options.alphaMode;
				return {} as never;
			},
		} as unknown as ImpostorContext['materials'],
		geometry: {
			fromArrays: (arrays: MeshArrays) => {
				seen.quad = arrays;
				return {} as never;
			},
		},
	};
	return { ctx, batch, seen };
}

const ATLAS: OctahedralAtlas = { columns: 3, rows: 3 };

/** An impostor batch over a stand-in context, with the cards at `positions`. */
function cardsOf(positions: readonly number[], atlas: OctahedralAtlas = ATLAS) {
	const { ctx, batch, seen } = fakeContext(positions.length / 3);
	const cards = createImpostors(ctx, {
		color: {} as Texture,
		surface: {} as Texture,
		atlas,
		positions,
		size: [2, 3],
	});
	return { cards, batch, seen };
}

describe('createImpostors', () => {
	test('stands one card on each position, at the size it is given', () => {
		const { cards, batch } = cardsOf([1, 2, 3, -4, 5, -6]);
		expect(cards.count).toBe(2);
		expect(Array.from(batch.positions)).toEqual([1, 2, 3, -4, 5, -6]);
		expect(Array.from(batch.scales)).toEqual([2, 3, 1, 2, 3, 1]);
		// Every card uploads once, after the setup writes.
		expect(batch.marks).toEqual([[0, 2]]);
	});

	test("gives the material the atlas's cells and the mask that a bake needs", () => {
		const { seen } = cardsOf([0, 0, 0]);
		expect(seen.uniformCells).toEqual([3, 3, 0, 0]);
		expect(seen.alphaMode).toBe('mask');
	});

	test('draws one quad that stands on its bottom edge, with its texture coordinates', () => {
		const { seen } = cardsOf([0, 0, 0]);
		const quad = seen.quad as MeshArrays;
		expect(Array.from(quad.positions as Float32Array)).toEqual([
			-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
		]);
		expect(Array.from(quad.uvs as Float32Array)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
		expect(Array.from(quad.indices as Uint16Array)).toEqual([0, 1, 2, 0, 2, 3]);
	});

	test('refuses an atlas that is not a whole number of cells', () => {
		const { ctx } = fakeContext(1);
		expect(() =>
			createImpostors(ctx, {
				color: {} as Texture,
				surface: {} as Texture,
				atlas: { columns: 2.5, rows: 3 },
				positions: [0, 0, 0],
			}),
		).toThrow(RangeError);
	});

	test('refuses positions that are not three numbers per card, or none at all', () => {
		const { ctx } = fakeContext(1);
		const options = { color: {} as Texture, surface: {} as Texture, atlas: ATLAS };
		expect(() => createImpostors(ctx, { ...options, positions: [0, 0] })).toThrow(RangeError);
		expect(() => createImpostors(ctx, { ...options, positions: [] })).toThrow(RangeError);
	});

	test('marks the cards that a change names dirty', () => {
		const { cards, batch } = cardsOf([0, 0, 0, 1, 0, 0, 2, 0, 0]);
		batch.marks.length = 0;
		cards.markDirty(1, 2);
		expect(batch.marks).toEqual([[1, 2]]);
	});

	test('wraps the engine batch it draws with', () => {
		const { cards, batch } = cardsOf([0, 0, 0]);
		expect(cards).toBeInstanceOf(ImpostorBatch);
		expect(cards.batch).toBe(batch as unknown as InstanceBatch);
		cards.destroy();
	});
});

describe('encodeImpostorSurface', () => {
	test('writes the octahedral code of a normal, its depth and its coverage', () => {
		const out = encodeImpostorSurface([0, 0, 1], 0.5, 1);
		// The front pole folds to the middle of the square, which is the byte 128 each way.
		expect(Array.from(out)).toEqual([128, 128, 128, 255]);
	});

	test('folds a back direction into the atlas corners', () => {
		const out = encodeImpostorSurface([0, 0, -1], 0, 0.5);
		// The back pole lands on the corner (1, 1) of the octahedron's square.
		expect(out[0]).toBe(255);
		expect(out[1]).toBe(255);
		expect(out[2]).toBe(0);
		expect(out[3]).toBe(128);
	});

	test('clamps a depth or coverage outside 0 and 1', () => {
		const out = encodeImpostorSurface([0, 1, 0], 2, -1);
		expect(out[2]).toBe(255);
		expect(out[3]).toBe(0);
	});
});
