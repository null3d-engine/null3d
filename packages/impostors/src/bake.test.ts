import { describe, expect, test } from 'bun:test';
import { bakeImpostorAtlas, type ImpostorBakePart } from './bake';
import { frameDirection, impostorFrame, octahedralAtlas } from './octahedral';

/** A square from (-0.5, 0) to (0.5, 1) in the xy plane, facing +z, in two triangles. */
const SQUARE: ImpostorBakePart = {
	positions: [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	colors: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
	indices: [0, 1, 2, 0, 2, 3],
};

/** A one-cell atlas that looks from +z. */
const FRONT = { columns: 1, rows: 1 };
const BOUNDS = { min: [-0.5, 0, 0] as const, max: [0.5, 1, 0] as const };

describe('bakeImpostorAtlas', () => {
	test('draws the object into a cell, with its colour and coverage', () => {
		const bake = bakeImpostorAtlas({
			atlas: FRONT,
			texels: 4,
			parts: [SQUARE],
			...BOUNDS,
		});
		const middle = (2 * 4 + 2) * 4;
		// The colour is stored in sRGB, and the coverage fills the cell.
		expect(Array.from(bake.color.data.slice(middle, middle + 4))).toEqual([255, 0, 0, 255]);
		// The surface's red and green hold the octahedral code of +z, at the square's middle.
		expect(Array.from(bake.surface.data.slice(middle, middle + 2))).toEqual([128, 128]);
		// The square's points all lie at one depth, so the depth is 0 at the view's front.
		expect(bake.surface.data[middle + 2]).toBe(0);
	});

	test('stores the normal that the part gives, in the object frame, not the view frame', () => {
		// The part faces the +z view, but its own normals point along +x. A view-frame bake would
		// store +z; the object frame stores the part's own normal.
		const bake = bakeImpostorAtlas({
			atlas: FRONT,
			texels: 4,
			parts: [{ ...SQUARE, normals: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] }],
			...BOUNDS,
		});
		const middle = (2 * 4 + 2) * 4;
		expect(Array.from(bake.surface.data.slice(middle, middle + 2))).toEqual([255, 128]);
	});

	test('draws a back face of a double-sided part, with the mesh’s own normal', () => {
		const backwards: ImpostorBakePart = {
			...SQUARE,
			// The winding turns the other way, and the normals point away from the front view.
			indices: [0, 2, 1, 0, 3, 2],
			normals: [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
			doubleSided: true,
		};
		const bake = bakeImpostorAtlas({ atlas: FRONT, texels: 4, parts: [backwards], ...BOUNDS });
		const middle = (2 * 4 + 2) * 4;
		expect(Array.from(bake.color.data.slice(middle, middle + 4))).toEqual([255, 0, 0, 255]);
		// The engine's materials keep the mesh's normal on both sides, so the card does too.
		expect(Array.from(bake.surface.data.slice(middle, middle + 2))).toEqual([255, 255]);
	});

	test('draws nothing from the back of a one-sided part', () => {
		const backwards: ImpostorBakePart = { ...SQUARE, indices: [0, 2, 1, 0, 3, 2] };
		const bake = bakeImpostorAtlas({ atlas: FRONT, texels: 4, parts: [backwards], ...BOUNDS });
		expect(bake.color.data.every((byte) => byte === 0)).toBe(true);
	});

	test('cuts a texel whose coverage falls under the part’s cutoff', () => {
		// A coverage map with four columns: the right half is clear.
		const data = new Uint8Array(4 * 1 * 4);
		for (let x = 0; x < 4; x++) data[x * 4 + 2] = x < 2 ? 255 : 0;
		const bake = bakeImpostorAtlas({
			atlas: FRONT,
			texels: 4,
			parts: [
				{
					...SQUARE,
					colors: undefined,
					uvs: [0, 0, 1, 0, 1, 1, 0, 1],
					color: { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) },
					coverage: { width: 4, height: 1, data },
					alphaCutoff: 0.5,
				},
			],
			...BOUNDS,
		});
		const at = (x: number, y: number) => (y * 4 + x) * 4;
		expect(bake.color.data[at(0, 2) + 3]).toBe(255);
		expect(bake.color.data[at(3, 2) + 3]).toBe(0);
	});

	test('gives a card the object’s widest reach and its full height', () => {
		const bake = bakeImpostorAtlas({
			atlas: FRONT,
			texels: 4,
			parts: [SQUARE],
			min: [-2, 0, -1],
			max: [2, 3, 1],
		});
		expect(bake.size[0]).toBeCloseTo(2 * Math.hypot(2, 1));
		expect(bake.size[1]).toBe(3);
		// The picture holds the object from every view, so its height is that of the box's diagonal.
		expect(bake.room).toBeCloseTo(Math.hypot(2 * Math.hypot(2, 1), 3) / 3);
	});

	test('refuses a part with no colour and no map, a map without texture coordinates, and none at all', () => {
		const options = { atlas: FRONT, texels: 4, parts: [SQUARE], ...BOUNDS };
		expect(() =>
			bakeImpostorAtlas({ ...options, parts: [{ ...SQUARE, colors: undefined }] }),
		).toThrow(RangeError);
		expect(() =>
			bakeImpostorAtlas({
				...options,
				parts: [
					{
						...SQUARE,
						uvs: undefined,
						color: { width: 1, height: 1, data: new Uint8Array(4) },
					},
				],
			}),
		).toThrow(RangeError);
		expect(() => bakeImpostorAtlas({ ...options, parts: [] })).toThrow(RangeError);
	});

	test('refuses bounds of no height and an atlas past the size limit', () => {
		const options = { atlas: FRONT, texels: 4, parts: [SQUARE], ...BOUNDS };
		expect(() => bakeImpostorAtlas({ ...options, min: [0, 0, 0], max: [1, 0, 0] })).toThrow(
			RangeError,
		);
		expect(() =>
			bakeImpostorAtlas({ ...options, atlas: { columns: 64, rows: 64 }, texels: 128 }),
		).toThrow(RangeError);
	});
});

describe('a card must read as its mesh', () => {
	// The island's hand-baked tree cards measured against their meshes at one light: 34 to 79 per
	// cent brighter, their crown's shading spread 31 to 44 per cent lower, and their silhouette 8 to
	// 20 per cent off, because they bake one side view with fixed normals. The limits here sit well
	// inside those failures: a bake that misses them reads as another tree at its distance.
	test('stores a mid-tone in sRGB, so a card’s colour matches its mesh’s under the same light', () => {
		const mid = 0.5;
		const grey: ImpostorBakePart = {
			...SQUARE,
			colors: [mid, mid, mid, 1, mid, mid, mid, 1, mid, mid, mid, 1, mid, mid, mid, 1],
		};
		const bake = bakeImpostorAtlas({ atlas: FRONT, texels: 4, parts: [grey], ...BOUNDS });
		const middle = (2 * 4 + 2) * 4;
		const [r, g, b] = bake.color.data.slice(middle, middle + 3) as Uint8Array;
		// sRGB of one half is 188; a linear store would read 128, 60 levels away.
		expect(Math.abs((r as number) - 188)).toBeLessThanOrEqual(3);
		expect(g).toBe(r);
		expect(b).toBe(r);
	});

	test('draws the object at the share of its bounds that the mesh covers', () => {
		// Bounds four times the square's area: the square covers a quarter of the cell.
		const bake = bakeImpostorAtlas({
			atlas: FRONT,
			texels: 8,
			parts: [SQUARE],
			min: [-1, 0, 0],
			max: [1, 2, 0],
		});
		let covered = 0;
		for (let at = 3; at < bake.color.data.length; at += 4)
			if ((bake.color.data[at] as number) > 127) covered++;
		const share = covered / (8 * 8);
		// Within a sixteenth of the quarter: a bake from the wrong mesh or bounds moves it further.
		expect(Math.abs(share - 0.25)).toBeLessThanOrEqual(0.0625);
	});

	test('stores enough views that no direction lies far from one of them', () => {
		/** The largest angle, over a spread of directions, to the stored view nearest each. */
		const worst = (views: number) => {
			const atlas = octahedralAtlas(views);
			let far = 0;
			const count = 512;
			for (let i = 0; i < count; i++) {
				// A Fibonacci sphere, so the sample spreads over every direction.
				const y = 1 - (2 * (i + 0.5)) / count;
				const radius = Math.sqrt(1 - y * y);
				const angle = i * Math.PI * (3 - Math.sqrt(5));
				const direction: [number, number, number] = [
					Math.cos(angle) * radius,
					y,
					Math.sin(angle) * radius,
				];
				const view = frameDirection(impostorFrame(direction, atlas), atlas);
				const dot = Math.min(
					1,
					direction[0] * view[0] + direction[1] * view[1] + direction[2] * view[2],
				);
				far = Math.max(far, (Math.acos(dot) * 180) / Math.PI);
			}
			return far;
		};
		// The octahedral grid's cells sit far apart: 4×4 holds 53 degrees at worst and 5×5 holds 42.5,
		// where the island's hand-made card holds one side view for every horizontal direction, 90
		// degrees at worst. A far crown needs about 25 cells; a hundred hold 23 degrees.
		expect(worst(25)).toBeLessThanOrEqual(45);
		expect(worst(16)).toBeGreaterThan(45);
	});
});
