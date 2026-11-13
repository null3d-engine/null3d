// The card bake and the card levels: three cells a prototype in the atlas, a leaf colour whose mean
// is the texture's mean, coverage and colour that keep through the mip levels the GPU averages, and
// card levels that place each row's planes and keep every second card in the thinned level.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PrototypeArrays, SpeciesKitData } from '../asset';
import { placeholderSkeleton } from '../core/placeholder';
import { standInSpecies } from '../core/stand-in';
import { STAND_IN_BARK, type TextureManifest } from '../core/textures';
import type { Rgb } from '../core/types';
import { placeShoots } from '../leaf/instancer';
import { OAK_MANIFEST, oakRecord, testKit } from '../leaf/oak.test-support';
import type { UncardedPrototype } from '../leaf/shoot';
import { SURFACE_LEAF, SURFACE_PIECE, SURFACE_STEM } from '../leaf/writer';
import { record as oak } from '../species/pedunculate-oak/record';
import {
	bakeCards,
	bakeCell,
	CARD_CUT_FALL_MOST,
	CARD_CUT_LEAST,
	type Palette,
	paletteOf,
} from './card-bake';
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

	it("bakes stems in the young bark's mean and tint, else in a stand-in's own colour", () => {
		const tint = oak.bark?.zones[0]?.tint as readonly [number, number, number];
		expect(tint).toBeDefined();
		const young = { tile: [0.2, 0.2] as const, mean: [0.3, 0.25, 0.2] as const };
		const layer = { name: 'trunk', tile: [0.5, 0.5] as const, mean: [0.25, 0.22, 0.18] as const };
		const barked = {
			...OAK_MANIFEST,
			bark: { size: 1024, layers: [{ ...layer, height: { offset: 0, depth: 0 } }], young },
		} as TextureManifest;
		expect(paletteOf(oak, barked).stem).toEqual([0.3, 0.25, 0.2]);
		// A record that tints its thin wood tints a card's twigs the same way.
		const tinted = {
			...oak,
			bark: { ...(oak.bark as NonNullable<typeof oak.bark>), youngTint: [0.5, 1, 2] as const },
		};
		expect(paletteOf(tinted, barked).stem).toEqual([0.15, 0.25, 0.4]);
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

/** Flat quads in the plane z = 0 facing +z, each `[x0, x1, y0, y1, kind]` in a unit square. */
function quads(
	list: readonly (readonly [number, number, number, number, number])[],
): PrototypeArrays {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	list.forEach(([x0, x1, y0, y1, kind], q) => {
		for (const [x, y] of [
			[x0, y0],
			[x1, y0],
			[x1, y1],
			[x0, y1],
		] as const) {
			positions.push(x, y, 0);
			normals.push(0, 0, 1);
			uvs.push(x, y);
			colors.push(0, 0, kind, 255);
		}
		indices.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
	});
	return {
		positions: Float32Array.from(positions),
		normals: Float32Array.from(normals),
		uvs: Float32Array.from(uvs),
		uvs1: new Float32Array(uvs.length),
		colors: Uint8Array.from(colors),
		indices: Uint16Array.from(indices),
	};
}

/** Leaves of one green and stems of one brown, with no texture outline. */
const FLAT: Palette = {
	upper: [0.1, 0.3, 0.05],
	lower: [0.1, 0.3, 0.05],
	stem: [0.3, 0.1, 0.05],
	profile: undefined,
	base: 0,
	tip: 1,
	mask: undefined,
	extras: [],
};

/**
 * A unit square's one face plane, baked into a cell of `cell` texels a side drawn in an atlas with a
 * border of two texels round it.
 */
function bakeSquare(mesh: PrototypeArrays, cell = 8): { color: Uint8Array; surface: Uint8Array } {
	const size = cell + 4;
	const color = new Uint8Array(size * size * 8);
	const surface = new Uint8Array(size * size * 8);
	const plane = { centre: [0.5, 0.5, 0], right: [0.5, 0, 0], up: [0, 0.5, 0], normal: [0, 0, 1] };
	bakeCell(mesh, plane, [2, 2, cell, cell], size, FLAT, color, surface);
	return { color, surface };
}

/** The front layer's texel at (x, y) from the drawn area's corner of a cell `cell` texels a side. */
const texelAt = (x: number, y: number, cell = 8) => ((y + 2) * (cell + 4) + x + 2) * 4;

describe('a cell of the card bake', () => {
	it('draws each texel whole or clear, and keeps the cover of parts thinner than a texel', () => {
		// Ten needles a fifth of a texel wide, across the whole square.
		const needles = quads(
			Array.from({ length: 10 }, (_, k) => {
				const x = (k + 0.37) / 10;
				return [x, x + 0.025, 0, 1, SURFACE_LEAF] as const;
			}),
		);
		const { color } = bakeSquare(needles);
		let whole = 0;
		for (let y = 0; y < 8; y++)
			for (let x = 0; x < 8; x++) {
				const alpha = color[texelAt(x, y) + 3] as number;
				expect(alpha === 0 || alpha === 255).toBe(true);
				if (alpha === 255) whole++;
			}
		// The needles cover a quarter of the square: 16 of its 64 texels, give or take the rounding
		// that error diffusion carries off the cell's edge.
		expect(Math.abs(whole - 16)).toBeLessThanOrEqual(2);
	});

	it('keeps a thin leaflet whole to its end, and the cell its cover', () => {
		// A broad leaf on whole texels with a leaflet under a quarter of a texel wide running from it
		// through the middle of a row of texels, out to six tenths of the way across its fourteenth.
		// The bake samples each texel four by four, so the leaflet holds one row of samples.
		const CELL = 16;
		const mesh = quads([
			[1 / CELL, 5 / CELL, 5 / CELL, 11 / CELL, SURFACE_LEAF],
			[5 / CELL, 13.6 / CELL, 7.3 / CELL, 7.45 / CELL, SURFACE_LEAF],
		]);
		const { color } = bakeSquare(mesh, CELL);
		let reach = -1;
		let whole = 0;
		for (let y = 0; y < CELL; y++)
			for (let x = 0; x < CELL; x++) {
				if ((color[texelAt(x, y, CELL) + 3] as number) !== 255) continue;
				whole++;
				if (y === 7) reach = Math.max(reach, x);
			}
		expect(reach).toBe(13);
		// The leaf and the leaflet cover 25.3 texels' worth; the dither keeps that, give or take two.
		const cover = 4 * 6 + (13.6 - 5) * 0.15;
		expect(Math.abs(whole - cover)).toBeLessThanOrEqual(2);
	});

	it('gives a texel the kind that covers most of it, in the mean colour of what covers it', () => {
		// In the fifth column of texels, leaf covers three quarters and twig the last quarter.
		const mesh = quads([
			[0, 0.59375, 0, 1, SURFACE_LEAF],
			[0.59375, 0.625, 0, 1, SURFACE_STEM],
		]);
		const { color, surface } = bakeSquare(mesh);
		const at = texelAt(4, 3);
		expect(surface[at + 3] as number).toBeGreaterThanOrEqual(128);
		const green = 0.75 * 0.3 + 0.25 * 0.1;
		expect(linear(color[at + 1] as number)).toBeCloseTo(green, 2);
	});

	it('keeps the share a cell draws at full size as the mip levels coarsen, dense or sparse', () => {
		const CELL = 32;
		const SIZE = CELL + 4;
		/**
		 * The share of a baked square's drawn area that draws at a mip level, read as the plant shader
		 * reads it: the level's texels blended at points a texel of that level apart, from four
		 * offsets a side, against a cut.
		 */
		const share = (color: Uint8Array, level: number, cut: number) => {
			let side = SIZE;
			let alpha = Float64Array.from(
				{ length: SIZE * SIZE },
				(_, i) => (color[i * 4 + 3] as number) / 255,
			);
			for (let l = 0; l < level; l++) {
				const next = side >> 1;
				const coarse = new Float64Array(next * next);
				for (let y = 0; y < next; y++)
					for (let x = 0; x < next; x++)
						coarse[y * next + x] =
							((alpha[y * 2 * side + x * 2] as number) +
								(alpha[y * 2 * side + x * 2 + 1] as number) +
								(alpha[(y * 2 + 1) * side + x * 2] as number) +
								(alpha[(y * 2 + 1) * side + x * 2 + 1] as number)) /
							4;
				alpha = coarse;
				side = next;
			}
			const step = 1 << level;
			const at = (x: number, y: number) =>
				alpha[
					Math.min(side - 1, Math.max(0, y)) * side + Math.min(side - 1, Math.max(0, x))
				] as number;
			let drawn = 0;
			let count = 0;
			for (let oy = 0; oy < 4; oy++)
				for (let ox = 0; ox < 4; ox++)
					for (let ty = 2 + ((oy + 0.5) / 4) * step; ty < 2 + CELL; ty += step)
						for (let tx = 2 + ((ox + 0.5) / 4) * step; tx < 2 + CELL; tx += step) {
							const x = tx / step - 0.5;
							const y = ty / step - 0.5;
							const x0 = Math.floor(x);
							const y0 = Math.floor(y);
							const fx = x - x0;
							const fy = y - y0;
							const value =
								(at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
								(at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
							drawn += value >= cut ? 1 : 0;
							count++;
						}
			return drawn / count;
		};
		const dense = quads([[0, 1, 0, 1, SURFACE_LEAF]]);
		// Clumps of needles a third of a texel wide, as needles crowd round a twig: four clumps across,
		// each four texels wide, in two bands, with as wide gaps between. A grey of evenly spread
		// needles, the same at every point of a coarse level, could not be cut to any share but all
		// or none; a real pad crowds as these do.
		const sparse = quads(
			[0.06, 0.31, 0.56, 0.81].flatMap((clump) =>
				[0, 0.02, 0.04, 0.06, 0.08, 0.1].flatMap((offset) =>
					[
						[0.1, 0.4],
						[0.6, 0.9],
					].map(([from, to]) => {
						const x = clump + offset;
						return [x, x + 0.01, from as number, to as number, SURFACE_LEAF] as const;
					}),
				),
			),
		);
		for (const mesh of [dense, sparse]) {
			const { color, surface } = bakeSquare(mesh, CELL);
			// The share full size draws: its whole texels.
			let whole = 0;
			for (let y = 0; y < CELL; y++)
				for (let x = 0; x < CELL; x++)
					whole += (color[texelAt(x, y, CELL) + 3] as number) === 255 ? 1 : 0;
			const full = whole / (CELL * CELL);
			const fall = ((surface[texelAt(5, 5, CELL) + 2] as number) / 255) * CARD_CUT_FALL_MOST;
			// Where the cell spans several of a level's texels, it draws its full-size share.
			let error = 0;
			let before = 0;
			for (const level of [1, 2, 3]) {
				const drawn = share(color, level, Math.max(CARD_CUT_LEAST, 0.5 - fall * level));
				if (level < 3) expect(Math.abs(drawn - full)).toBeLessThan(0.06);
				error += Math.abs(drawn - full);
				// The old cut: one half, the alpha raised five per cent a level.
				before += Math.abs(share(color, level, 0.5 / (1 + 0.05 * level)) - full);
			}
			// Over the levels a whole view reads, it draws nearer the full-size share than the old cut;
			// a level where the cell spans four texels reads nearly even, so no hard cut draws its share
			// exactly there.
			expect(error).toBeLessThanOrEqual(before + 1e-9);
			if (mesh === sparse) expect(error).toBeLessThan(before * 0.75);
		}
	});
});

/** A prototype of one mesh at every tier. */
function prototypeOf(mesh: PrototypeArrays, kind: UncardedPrototype['class'], leaves: number) {
	let reach = 0;
	for (let i = 0; i < mesh.positions.length; i += 3)
		reach = Math.max(
			reach,
			Math.hypot(
				mesh.positions[i] as number,
				mesh.positions[i + 1] as number,
				mesh.positions[i + 2] as number,
			),
		);
	return {
		index: 0,
		class: kind,
		vigor: [0, 1] as const,
		length: reach,
		radius: reach,
		leaves,
		tiers: [mesh, mesh, mesh, mesh] as const,
	} as unknown as UncardedPrototype;
}

/**
 * A ribbon of placed-piece surface along a path from the origin, `width` across in x, each vertex's
 * second coordinates holding its share along the ribbon, as a placed piece's surface does.
 */
function ribbon(path: readonly (readonly [number, number])[], width: number): PrototypeArrays {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const uvs1: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	path.forEach(([y, z], k) => {
		const share = k / (path.length - 1);
		for (const x of [-width / 2, width / 2]) {
			positions.push(x, y, z);
			normals.push(0, 0, 1);
			uvs.push(x / width + 0.5, share);
			uvs1.push(share, 0);
			colors.push(0, 0, SURFACE_PIECE, 255);
		}
		if (k > 0) {
			const a = (k - 1) * 2;
			indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
		}
	});
	return {
		positions: Float32Array.from(positions),
		normals: Float32Array.from(normals),
		uvs: Float32Array.from(uvs),
		uvs1: Float32Array.from(uvs1),
		colors: Uint8Array.from(colors),
		indices: Uint16Array.from(indices),
	};
}

describe('the card bake along a long piece', () => {
	const record = oakRecord();
	const planesOf = (prototype: UncardedPrototype) =>
		(bakeCards(record, OAK_MANIFEST, 'high', [prototype]).cells[0] as { planes: CardPlanes })
			.planes;
	type CardPlanes = SpeciesKitData['prototypes'][number]['card']['planes'];

	it('cuts a piece many times longer than wide into cards along it, each in cells of its own', () => {
		// A strip 1.2 m long and 6 cm wide, straight up its line.
		const strip = prototypeOf(
			ribbon(
				Array.from({ length: 25 }, (_, k) => [(k / 24) * 1.2, 0] as const),
				0.06,
			),
			'piece',
			1,
		);
		const planes = planesOf(strip);
		expect(planes.length).toBeGreaterThanOrEqual(4);
		expect(planes.length % 2).toBe(0);
		const taken = new Set<string>();
		let along = 0;
		for (const [k, plane] of planes.entries()) {
			expect(plane.role).toBe(k % 2 === 0 ? 0 : 1);
			taken.add(plane.front.join(','));
			if (k % 2 === 0) {
				expect(plane.along[0]).toBeCloseTo(along, 6);
				along = plane.along[1];
			}
		}
		expect(along).toBeCloseTo(1, 6);
		expect(taken.size).toBe(planes.length);
		// Texels a metre along the strip: an uncut card holds its whole length in one cell.
		const face = planes[0] as CardPlanes[number];
		const perMetre = face.front[3] / (2 * Math.hypot(...(face.up as [number, number, number])));
		const uncut = face.front[3] / 1.25;
		expect(perMetre).toBeGreaterThan((planes.length / 2) * uncut * 0.8);
	});

	it('keeps three planes on a card about as long as it is wide', () => {
		const square = prototypeOf(quads([[0, 0.5, 0, 0.5, SURFACE_LEAF]]), 'piece', 1);
		const planes = planesOf(square);
		expect(planes.map((plane) => plane.role)).toEqual([0, 1, 2]);
		for (const plane of planes) expect([...plane.along]).toEqual([0, 1]);
	});

	it('keeps a shoot under four times longer than wide whole, where a piece would be cut', () => {
		const path = Array.from({ length: 13 }, (_, k) => [(k / 12) * 0.6, 0] as const);
		expect(planesOf(prototypeOf(ribbon(path, 0.2), 'piece', 1)).length).toBeGreaterThan(3);
		expect(planesOf(prototypeOf(ribbon(path, 0.2), 'short', 1)).length).toBe(3);
	});

	it('follows a blade that arches over: its cards turn along the arch', () => {
		// A quarter circle of 0.6 m from straight up to level.
		const arch = Array.from({ length: 33 }, (_, k) => {
			const angle = (k / 32) * (Math.PI / 2);
			return [0.6 * Math.sin(angle), 0.6 * (1 - Math.cos(angle))] as const;
		});
		const planes = planesOf(prototypeOf(ribbon(arch, 0.04), 'piece', 1));
		const up = (plane: CardPlanes[number]) => {
			const [x, y, z] = plane.up as [number, number, number];
			const l = Math.hypot(x, y, z);
			return [x / l, y / l, z / l];
		};
		const first = up(planes[0] as CardPlanes[number]);
		const last = up(planes[planes.length - 1] as CardPlanes[number]);
		expect(Math.abs(first[1] as number)).toBeGreaterThan(0.8);
		expect(Math.abs(last[2] as number)).toBeGreaterThan(0.8);
	});

	it('pictures a blade that arches over and lies along the ground out to its tip', () => {
		// An arch 0.5 m high that comes down 0.7 m out, then a last stretch along the ground.
		const arch = [
			...Array.from({ length: 25 }, (_, k) => {
				const angle = (k / 24) * Math.PI;
				return [0.5 * Math.sin(angle), 0.35 * (1 - Math.cos(angle))] as const;
			}),
			...Array.from({ length: 4 }, (_, k) => [0.005, 0.7 + ((k + 1) / 4) * 0.15] as const),
		];
		const blade = prototypeOf(ribbon(arch, 0.05), 'piece', 1);
		const { atlas, cells } = bakeCards(record, OAK_MANIFEST, 'high', [blade]);
		const planes = (cells[0] as { planes: CardPlanes }).planes;
		expect(planes.length).toBeGreaterThan(3);
		// How far out the cards' picture reaches: the corners of every texel of half cover or more.
		let reach = Number.NEGATIVE_INFINITY;
		for (const plane of planes) {
			const [x0, y0, w, h] = plane.front;
			for (let j = 0; j < h; j++)
				for (let i = 0; i < w; i++) {
					if ((atlas.color[((y0 + j) * atlas.size + x0 + i) * 4 + 3] as number) < 128) continue;
					for (const a of [(i / w) * 2 - 1, ((i + 1) / w) * 2 - 1])
						for (const b of [(j / h) * 2 - 1, ((j + 1) / h) * 2 - 1])
							reach = Math.max(
								reach,
								(plane.centre[2] as number) +
									a * (plane.right[2] as number) +
									b * (plane.up[2] as number),
							);
				}
		}
		expect(reach).toBeGreaterThan(0.85 - 0.02);
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
