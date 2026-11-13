// The card bake and the card levels: three cells a prototype in the atlas, a leaf colour whose mean
// is the texture's mean, coverage and colour that keep through the mip levels the GPU averages, and
// card levels that place each row's planes and keep every second card in the thinned level.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { SpeciesKitData } from '../asset';
import { quatRotate, type Vector3 } from '../core/math';
import { placeholderSkeleton } from '../core/placeholder';
import { standInSpecies } from '../core/stand-in';
import { STAND_IN_BARK, type TextureManifest } from '../core/textures';
import type { Rgb } from '../core/types';
import { placeShoots } from '../leaf/instancer';
import { OAK_MANIFEST, oakRecord, testKit } from '../leaf/oak.test-support';
import { record as oak } from '../species/pedunculate-oak/record';
import { bakeCards, paletteOf } from './card-bake';
import { cardKeep, cardMesh, cardRows, connectedCards, foliageHull } from './cards';

/** sRGB byte to linear. */
const linear = (byte: number) => {
	const s = byte / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** The kit of a record and manifest, with its card atlas baked and joined to its prototypes. */
function bakedKit(manifest: TextureManifest = OAK_MANIFEST): {
	kit: SpeciesKitData;
	atlas: ReturnType<typeof bakeCards>['atlas'];
} {
	const record = oakRecord();
	const kit = testKit(record);
	const { atlas, cells } = bakeCards(record, manifest, 'high', kit.prototypes);
	const prototypes = kit.prototypes.map((prototype, k) => ({
		...prototype,
		card: cells[k] ?? prototype.card,
	}));
	return { kit: { ...kit, manifest, prototypes, cards: atlas }, atlas };
}

/** One mip level of a cell, as the GPU makes it: the mean of each 2 by 2 block in linear colour. */
function mip(pixels: Float64Array, size: number): { pixels: Float64Array; size: number } {
	const half = size / 2;
	const out = new Float64Array(half * half * 4);
	for (let y = 0; y < half; y++)
		for (let x = 0; x < half; x++)
			for (let k = 0; k < 4; k++) {
				let sum = 0;
				for (const [dx, dy] of [
					[0, 0],
					[1, 0],
					[0, 1],
					[1, 1],
				] as const)
					sum += pixels[((y * 2 + dy) * size + x * 2 + dx) * 4 + k] as number;
				out[(y * half + x) * 4 + k] = sum / 4;
			}
	return { pixels: out, size: half };
}

describe('the card bake', () => {
	const { kit, atlas } = bakedKit();

	it('gives each prototype three planes whose cells lie apart inside the atlas', () => {
		const taken = new Uint8Array(atlas.size * atlas.size);
		for (const prototype of kit.prototypes) {
			expect(prototype.card.planes).toHaveLength(3);
			for (const plane of prototype.card.planes) {
				const [x, y, w, h] = plane.front;
				expect(plane.back).toEqual(plane.front);
				expect(x + w).toBeLessThanOrEqual(atlas.size);
				expect(y + h).toBeLessThanOrEqual(atlas.size);
				for (let j = y; j < y + h; j++)
					for (let i = x; i < x + w; i++) {
						expect(taken[j * atlas.size + i]).toBe(0);
						taken[j * atlas.size + i] = 1;
					}
			}
		}
		expect(atlas.color.length).toBe(atlas.size * atlas.size * 8);
	});

	it(
		"keeps a leaf's mean colour within 3 per cent of the texture's mean",
		() => {
			const one: TextureManifest = {
				...OAK_MANIFEST,
				leaf: {
					...(OAK_MANIFEST.leaf as NonNullable<TextureManifest['leaf']>),
					mean: { upper: [0.05, 0.11, 0.03], lower: [0.05, 0.11, 0.03] },
					// A flat profile, so the check reads the colour path alone: the bands' own weighting by
					// the leaf's pose belongs to the render, as it does on the GPU.
					profile: { upper: [1, 1, 1, 1, 1, 1, 1, 1], lower: [1, 1, 1, 1, 1, 1, 1, 1] },
				},
			};
			const { atlas: baked } = bakedKit(one);
			const sum = [0, 0, 0];
			let count = 0;
			for (let i = 0; i < baked.color.length; i += 4) {
				if ((baked.color[i + 3] as number) === 0 || (baked.surface[i + 3] as number) < 128)
					continue;
				for (let c = 0; c < 3; c++)
					sum[c] = (sum[c] as number) + linear(baked.color[i + c] as number);
				count++;
			}
			expect(count).toBeGreaterThan(1000);
			const mean = sum.map((value) => value / count);
			[0.05, 0.11, 0.03].forEach((target, c) => {
				expect(Math.abs((mean[c] as number) - target) / target).toBeLessThan(0.03);
			});
		},
		scaledBudget(30_000),
	);

	it('keeps coverage and colour through the mip levels', () => {
		const cell = kit.prototypes[0]?.card.planes[0]?.front;
		if (!cell) throw new Error('no cell');
		// The whole cell, border included, is 4 texels wider than the drawn area.
		const [x, y, w] = [cell[0] - 2, cell[1] - 2, cell[2] + 4];
		let pixels: Float64Array = new Float64Array(w * w * 4);
		for (let j = 0; j < w; j++)
			for (let i = 0; i < w; i++) {
				const at = ((y + j) * atlas.size + x + i) * 4;
				for (let c = 0; c < 3; c++)
					pixels[(j * w + i) * 4 + c] = linear(atlas.color[at + c] as number);
				pixels[(j * w + i) * 4 + 3] = (atlas.color[at + 3] as number) / 255;
			}
		const measure = (p: Float64Array) => {
			let alpha = 0;
			const colour = [0, 0, 0];
			for (let i = 0; i < p.length; i += 4) {
				const a = p[i + 3] as number;
				alpha += a;
				for (let c = 0; c < 3; c++) colour[c] = (colour[c] as number) + (p[i + c] as number) * a;
			}
			return { coverage: alpha / (p.length / 4), colour: colour.map((value) => value / alpha) };
		};
		const top = measure(pixels);
		expect(top.coverage).toBeGreaterThan(0.1);
		let size = w;
		for (let level = 1; level <= 4; level++) {
			({ pixels, size } = mip(pixels, size));
			const here = measure(pixels);
			expect(Math.abs(here.coverage - top.coverage)).toBeLessThan(0.01);
			// Each channel within 3 per cent of the colour's brightest channel, which is what the eye
			// reads, and one more step of the byte the atlas stores it in: a level cannot hold a colour
			// finer than that, so a bound of three alone fails on quantisation rather than on a mip.
			const bright = Math.max(...top.colour);
			for (let c = 0; c < 3; c++)
				expect(
					Math.abs((here.colour[c] as number) - (top.colour[c] as number)) / bright,
				).toBeLessThan(0.03 + 1 / 255);
		}
	});

	it("bakes stems in the young bark's mean, else in a stand-in's own colour", () => {
		const tint = oak.bark?.zones[0]?.tint as readonly [number, number, number];
		expect(tint).toBeDefined();
		const young = { tile: [0.2, 0.2] as const, mean: [0.3, 0.25, 0.2] as const };
		const layer = { name: 'trunk', tile: [0.5, 0.5] as const, mean: [0.25, 0.22, 0.18] as const };
		const barked = {
			...OAK_MANIFEST,
			bark: { size: 1024, layers: [{ ...layer, height: { offset: 0, depth: 0 } }], young },
		} as TextureManifest;
		expect(paletteOf(oak, barked).stem).toEqual([0.3, 0.25, 0.2]);
		// A stand-in species measures no bark and gives its colour in its tint, which its far cards
		// keep; with neither a measured bark nor a tint, the stand-in colour stands.
		const bare = { ...OAK_MANIFEST, bark: undefined } as TextureManifest;
		const standIn = standInSpecies('bark-colour-test').record;
		expect(paletteOf(standIn, bare).stem).toEqual(standIn.bark?.zones[0]?.tint as Rgb);
		const plain = {
			...oak,
			bark: {
				...(oak.bark as NonNullable<typeof oak.bark>),
				zones: [{ layer: 0, by: 'height' as const, from: 0, to: 40, blend: 0 }],
			},
		};
		expect(paletteOf(plain, bare).stem).toEqual([...STAND_IN_BARK]);
	});
});

describe('the card levels', () => {
	const { kit } = bakedKit();
	const record = kit.record;
	const skeleton = placeholderSkeleton({ record, seed: 11, variant: 0, season: 'summer' });
	const input = { record, seed: 11, variant: 0, season: 'summer' as const, kit, skeleton };
	const rows = placeShoots(input);
	const mesh = {
		...input,
		rows,
		crown: {
			cells: [1, 1, 1] as const,
			min: [0, 0, 0] as const,
			cell: 1,
			sky: new Float32Array([1]),
		},
		detail: 'high' as const,
	};

	const drawnRows = (level: 1 | 2): number[] => {
		const flags = connectedCards(mesh, level);
		const out: number[] = [];
		for (let r = 0; r < rows.count; r++) if (flags[r] === 1) out.push(r);
		return out;
	};

	it("draws each row's three planes at the first level", () => {
		const first = cardMesh(mesh, 1);
		expect(first.indices.length / 3).toBe(drawnRows(1).length * 6);
		for (let i = 0; i < first.uvs.length; i++) {
			expect(first.uvs[i]).toBeGreaterThanOrEqual(0);
			expect(first.uvs[i]).toBeLessThanOrEqual(1);
		}
	});

	it("draws each card's stalk only where the record gives a least width", () => {
		const plain = cardMesh(mesh, 1);
		expect(plain.indices.length / 3).toBe(drawnRows(1).length * 6);
		const stalked = cardMesh(
			{ ...mesh, record: { ...record, lod: { ...record.lod, cardStalk: 1 } } },
			1,
		);
		const drawn = drawnRows(1);
		let stretched = 0;
		for (const r of drawn) {
			const bx = (rows.back?.[r * 3] as number) ?? 0;
			const by = (rows.back?.[r * 3 + 1] as number) ?? 0;
			const bz = (rows.back?.[r * 3 + 2] as number) ?? 0;
			if (Math.hypot(bx, by, bz) > 1e-6) stretched++;
		}
		expect(stretched).toBeGreaterThan(0);
		// Each stalk is one quad from either side, so it shows whichever way the view turns it.
		expect(stalked.indices.length / 3).toBe(drawn.length * 6 + stretched * 4);
		let stalks = 0;
		for (let v = 0; v < stalked.uvs1.length / 2; v++) {
			if (Math.abs((stalked.uvs1[v * 2 + 1] as number) - 0.75) >= 1e-6) continue;
			stalks++;
			expect([0, 1]).toContain(stalked.uvs[v * 2] as number);
			expect(
				Math.hypot(
					stalked.normals[v * 3] as number,
					stalked.normals[v * 3 + 1] as number,
					stalked.normals[v * 3 + 2] as number,
				),
			).toBeCloseTo(1, 5);
		}
		expect(stalks).toBe(stretched * 4);
	});

	it('reaches the carried foliage only where the record asks', () => {
		const stalked = { ...record, lod: { ...record.lod, cardStalk: 1 } };
		const reaching = { ...stalked, lod: { ...stalked.lod, cardStalkToFoliage: true } };
		const off = cardMesh({ ...mesh, record: stalked }, 1);
		const on = cardMesh({ ...mesh, record: reaching }, 1);
		// Reaching the foliage replaces the same one quad, so it costs no triangles.
		expect(on.indices.length).toBe(off.indices.length);
		let reached = 0;
		let vertex = 0;
		const near = (actual: readonly number[], expected: readonly number[]) => {
			for (let c = 0; c < 3; c++) expect(actual[c] as number).toBeCloseTo(expected[c] as number, 5);
		};
		for (let r = 0; r < rows.count; r++) {
			if (cardKeep(rows.order[r] as number, 1) === 0) continue;
			const prototype = kit.prototypes[rows.prototype[r] as number];
			if (!prototype) continue;
			if (connectedCards(mesh, 1)[r] !== 1) continue;
			const planes = prototype.card.planes.length;
			const at = vertex + planes * 4;
			vertex = at + 4;
			const px = rows.position[r * 3] as number;
			const py = rows.position[r * 3 + 1] as number;
			const pz = rows.position[r * 3 + 2] as number;
			const bx = rows.back?.[r * 3] as number;
			const by = rows.back?.[r * 3 + 1] as number;
			const bz = rows.back?.[r * 3 + 2] as number;
			if (Math.hypot(bx, by, bz) <= 1e-6) continue;
			// A stalk's two ends hold two coincident vertices each, in order.
			const offFrom = [...off.positions.subarray(at * 3, at * 3 + 3)];
			const offTo = [...off.positions.subarray((at + 2) * 3, (at + 2) * 3 + 3)];
			const onFrom = [...on.positions.subarray(at * 3, at * 3 + 3)];
			const onTo = [...on.positions.subarray((at + 2) * 3, (at + 2) * 3 + 3)];
			// Without the option the line is today's: the row's origin to the stretch behind it.
			near(offFrom, [px, py, pz]);
			near(offTo, [px + bx, py + by, pz + bz]);
			// With it, the line still starts at the row's origin, so the card stays joined to the
			// wood, and it ends at the centre of the foliage the card carries: the middle of the
			// card's first plane where the level draws it.
			near(onFrom, [px, py, pz]);
			const centre = prototype.card.planes[0]?.centre;
			if (!centre) continue;
			const first = at - planes * 4;
			const middle = [0, 0, 0];
			for (let corner = 0; corner < 4; corner++)
				for (let c = 0; c < 3; c++)
					middle[c] =
						(middle[c] as number) + (on.positions[(first + corner) * 3 + c] as number) / 4;
			near(onTo, middle);
			if (
				Math.hypot(centre[0], centre[1], centre[2]) * (rows.scale[r] as number) >
				Math.hypot(bx, by, bz) + 1e-3
			)
				reached++;
		}
		// The fixture has rows whose foliage stands farther out than the stretch behind them, so the
		// option is doing the work it was added for.
		expect(reached).toBeGreaterThan(0);
	});

	it('keeps every second card in the thinned level, and every row of the rim', () => {
		const second = cardMesh(mesh, 2);
		const keeps = cardRows(mesh, 2);
		const drawn = new Set(drawnRows(2));
		expect(second.indices.length / 3).toBe(drawn.size * 6);
		const rim = foliageHull(mesh).rim;
		expect(rim.some((flag) => flag === 1)).toBe(true);
		// Each step of two rows keeps its own row, or the row of the rim that stands in its place.
		const stepHasRim = new Set<number>();
		for (let r = 0; r < rows.count; r++)
			if (rim[r] === 1) stepHasRim.add((rows.order[r] as number) >> 1);
		for (let r = 0; r < rows.count; r++) {
			const order = rows.order[r] as number;
			const own = order % 2 === 0 && !stepHasRim.has(order >> 1);
			expect([r, (keeps[r] as number) > 0]).toEqual([r, rim[r] === 1 || own]);
			if ((keeps[r] as number) > 0) expect(keeps[r] as number).toBeCloseTo(Math.SQRT2, 6);
		}
		expect(cardKeep(4, 2)).toBeCloseTo(Math.SQRT2, 12);
		expect(cardKeep(3, 2)).toBe(0);
		expect(cardKeep(3, 1)).toBe(1);
	});

	it('thins a card level further by the same rule', () => {
		for (const [share, every] of [
			[0.5, 4],
			[0.25, 8],
		] as const) {
			const thinned = { ...mesh, cards: share };
			const level = cardMesh(thinned, 2);
			const keeps = cardRows(thinned, 2);
			const rim = foliageHull(thinned).rim;
			const flags = connectedCards(thinned, 2);
			let drawn = 0;
			for (let r = 0; r < rows.count; r++) {
				if (flags[r] === 1) drawn++;
				// A row the step drops stays only where it stands on the rim.
				if ((rows.order[r] as number) % every !== 0)
					expect([share, r, (keeps[r] as number) > 0]).toEqual([share, r, rim[r] === 1]);
			}
			expect(level.indices.length / 3).toBe(drawn * 6);
		}
		expect(cardKeep(0, 2, 0.5)).toBe(2);
		expect(cardKeep(2, 2, 0.5)).toBe(0);
		expect(cardKeep(0, 2, 0.25)).toBeCloseTo(2 * Math.SQRT2, 12);
		// A share of one keeps the level's own cards.
		expect(cardKeep(0, 2, 1)).toBeCloseTo(Math.SQRT2, 12);
	});
});

describe('a record that asks for a finer card cell', () => {
	it('bakes each cell at the size its own tier names', () => {
		const record = oakRecord();
		const base = bakeCards(record, OAK_MANIFEST, 'high', testKit(record).prototypes);
		const fineRecord = {
			...record,
			lod: { ...record.lod, cardCell: { low: 64, medium: 64, high: 128, ultra: 128 } },
		};
		const fine = bakeCards(fineRecord, OAK_MANIFEST, 'high', testKit(fineRecord).prototypes);
		expect(fine.atlas.size).toBe(base.atlas.size * 2);
		// The drawn area keeps its two-texel border at either size.
		expect(fine.cells[0]?.planes[0]?.front).toEqual([2, 2, 124, 124]);
		expect(base.cells[0]?.planes[0]?.front).toEqual([2, 2, 60, 60]);
	});
});
