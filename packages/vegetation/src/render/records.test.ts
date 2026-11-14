// The records texture's header and wind rows: the leaf's terms keep a front-lit face at its
// reflectance and a back-lit leaf at its transmittance, the values that half floats would spoil go
// up in two halves, and the plant shader reads the same texels that the header writes.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { speciesBox } from '../core/box';
import type { Species } from '../core/record';
import { standInRecord } from '../core/stand-in';
import { noTextureFiles, type TextureManifest } from '../core/textures';
import type { Rgb } from '../core/types';
import {
	leafSurface,
	SURFACE_BUD,
	SURFACE_LEAF,
	SURFACE_PIECE,
	SURFACE_PIECE_SHEATH,
	SURFACE_SHEATH,
	SURFACE_STEM,
} from '../leaf/writer';
import { DEFAULT_WIND_SWAY, VARIANT_RECORDS, WIND_RECORD_FLOATS } from '../wind/records';
import {
	BARK_ZONE_TEXELS,
	EXTRA_ROUGHNESS,
	faceTerms,
	HEADER,
	HEADER_ROWS,
	MAX_BARK_ZONES,
	MAX_EXTRAS,
	RECORDS_PER_ROW,
	RECORDS_WIDTH,
	recordsRows,
	speciesHeader,
	toHalf,
	transmissionShare,
	writeShootRow,
	writeSteadyWind,
	writeWindRecords,
} from './records';

/** A blade-leaved record with the given optics. */
function leafRecord(reflectance: Rgb, reflectanceBack: Rgb, transmittance: Rgb): Species {
	const base = standInRecord('records-test', { height: 12 });
	if (base.foliage.kind !== 'blade') throw new Error('the stand-in has no blade');
	return {
		...base,
		foliage: {
			...base.foliage,
			leaf: {
				...base.foliage.leaf,
				optics: { reflectance, reflectanceBack, transmittance, roughness: [0.5, 0.7], sheen: 0.3 },
			},
		},
	};
}

/** A manifest whose leaf means are given. */
function manifestWith(upper: Rgb, lower: Rgb): TextureManifest {
	const empty = noTextureFiles('records-test').manifest;
	return {
		...empty,
		leaf: {
			size: 1024,
			layers: ['upper', 'lower'],
			length: 0.9,
			frame: { petiole: [0.5, 0], base: [0.5, 0.05], tip: [0.5, 0.95] },
			outline: [],
			mean: { upper, lower },
			veins: { luminance: 0.06, contrast: 6 },
			profile: { upper: [], lower: [] },
			coverage: 0.36,
		},
	};
}

/** The four numbers of a header texel. */
const texel = (header: Float32Array, at: number) => [...header.subarray(at * 4, at * 4 + 4)];

describe('the leaf terms', () => {
	test('a front-lit face shows its reflectance and a back-lit leaf its transmittance', () => {
		const reflectance: Rgb = [0.05, 0.09, 0.02];
		const transmittance: Rgb = [0.07, 0.12, 0.025];
		const mean: Rgb = [0.04, 0.08, 0.03];
		const terms = faceTerms(reflectance, transmittance, mean);
		// The engine keeps one less the share of the base colour for the front, and lets the share
		// of the light colour through.
		for (let k = 0; k < 3; k++) {
			const front = (mean[k] as number) * (terms.scale[k] as number) * (1 - terms.share);
			expect(front).toBeCloseTo(reflectance[k] as number, 6);
			expect((terms.through[k] as number) * terms.share).toBeCloseTo(transmittance[k] as number, 6);
		}
		expect(terms.share).toBeCloseTo(transmissionShare(reflectance, transmittance), 9);
	});

	test('the share stays below one for a leaf that passes far more than it reflects', () => {
		expect(transmissionShare([0.001, 0.001, 0.001], [0.5, 0.5, 0.5])).toBe(0.9);
		expect(transmissionShare([0, 0, 0], [0, 0, 0])).toBe(0);
	});
});

describe('half floats', () => {
	test('round as the GPU rounds them', () => {
		expect(toHalf(1)).toBe(1);
		expect(toHalf(2049)).toBe(2048);
		expect(toHalf(2051)).toBe(2052);
		expect(toHalf(-0.1)).toBeCloseTo(-0.0999755859375, 12);
		expect(toHalf(65519)).toBe(65504);
		expect(toHalf(70000)).toBe(Number.POSITIVE_INFINITY);
	});
});

describe('the species header', () => {
	const record = leafRecord([0.05, 0.09, 0.02], [0.2, 0.25, 0.2], [0.07, 0.12, 0.025]);
	const manifest = manifestWith([0.04, 0.08, 0.02], [0.22, 0.28, 0.21]);
	const box = speciesBox(record);
	const header = speciesHeader(record, manifest, box);

	test('takes the header rows of the records texture', () => {
		expect(header.length).toBe(HEADER_ROWS * RECORDS_WIDTH * 4);
	});

	test('draws as before when the record names no sky-to-leaf term', () => {
		expect([...speciesHeader(record, manifest, box)]).toEqual([...header]);
		expect(texel(header, HEADER.sway)[3]).toBe(0);
	});

	test('packs the sky-to-leaf extinction in the sway texel', () => {
		const lit = speciesHeader({ ...record, skyToLeaf: 0.3 }, manifest, box);
		expect(texel(lit, HEADER.sway)[3]).toBeCloseTo(0.3, 6);
	});

	test('packs the two colours of a tuft sheath, and none where the record gives none', () => {
		const tuft = {
			...record,
			growth: {
				model: 'tuft',
				sheathColour: { foot: [0.3, 0.4, 0.2], collar: [0.5, 0.6, 0.7], reach: 0.85 },
			},
		} as unknown as Species;
		const sheathed = speciesHeader(tuft, manifest, box);
		for (const [k, v] of [0.3, 0.4, 0.2, 0.7].entries())
			expect(texel(sheathed, HEADER.sheath)[k] as number).toBeCloseTo(v, 5);
		for (const [k, v] of [0.5, 0.6, 0.7, 0.85].entries())
			expect(texel(sheathed, HEADER.sheathCollar)[k] as number).toBeCloseTo(v, 5);
		// The blade-leaved record names no tuft, so both sheath texels stay empty.
		expect(texel(header, HEADER.sheath)).toEqual([0, 0, 0, 0]);
		expect(texel(header, HEADER.sheathCollar)).toEqual([0, 0, 0, 0]);
	});

	test('holds each face its own scale, share and roughness from its own mean', () => {
		const upper = faceTerms([0.05, 0.09, 0.02], [0.07, 0.12, 0.025], [0.04, 0.08, 0.02]);
		const lower = faceTerms([0.2, 0.25, 0.2], [0.07, 0.12, 0.025], [0.22, 0.28, 0.21]);
		const close = (a: readonly number[], b: readonly number[]) => {
			for (const [k, v] of a.entries()) expect(v).toBeCloseTo(b[k] as number, 5);
		};
		close(texel(header, HEADER.upper), [...upper.scale, 0.5]);
		close(texel(header, HEADER.lower), [...lower.scale, 0.7]);
		close(texel(header, HEADER.upperThrough), [...upper.through, upper.share]);
		close(texel(header, HEADER.lowerThrough), [...lower.through, lower.share]);
		close(texel(header, HEADER.upperMean).slice(0, 3), [0.04, 0.08, 0.02]);
		close(texel(header, HEADER.lowerMean).slice(0, 3), [0.22, 0.28, 0.21]);
		expect(texel(header, HEADER.upperReflectance)[3]).toBeCloseTo(0.3, 6);
	});

	test('a species with no leaf texture shows its reflectance over the white texel', () => {
		const plain = speciesHeader(record, noTextureFiles('records-test').manifest, box);
		const transmittance: Rgb = [0.07, 0.12, 0.025];
		const faces = [
			{ at: HEADER.upper, mean: HEADER.upperMean, reflectance: [0.05, 0.09, 0.02] as Rgb },
			{ at: HEADER.lower, mean: HEADER.lowerMean, reflectance: [0.2, 0.25, 0.2] as Rgb },
		];
		for (const face of faces) {
			for (const k of [0, 1, 2]) expect(texel(plain, face.mean)[k] as number).toBeCloseTo(1, 6);
			const terms = faceTerms(face.reflectance, transmittance, [1, 1, 1]);
			const written = texel(plain, face.at);
			for (const k of [0, 1, 2]) {
				expect(written[k] as number).toBeCloseTo(terms.scale[k] as number, 6);
				// The placeholder texel is white, so a front-lit face shows the record's own colour.
				expect((written[k] as number) * (1 - terms.share)).toBeCloseTo(
					face.reflectance[k] as number,
					6,
				);
			}
		}
	});

	test("writes a card's stalk width, and where it draws at its twig's width", () => {
		expect(texel(header, HEADER.cardStalk)).toEqual([0, 0, 0, 0]);
		const stalked: Species = { ...record, lod: { ...record.lod, cardStalk: 1.5 } };
		expect(texel(speciesHeader(stalked, manifest, box), HEADER.cardStalk)).toEqual([1.5, 0, 0, 0]);
		const wide: Species = {
			...record,
			lod: { ...record.lod, cardStalk: 1.5, cardStalkWidth: true },
		};
		expect(texel(speciesHeader(wide, manifest, box), HEADER.cardStalk)).toEqual([1.5, 1, 0, 0]);
	});
	test("writes a fire scar's hollow and char into the header, or zeroes it where the record gives none", () => {
		expect(texel(header, HEADER.scar)).toEqual([0, 0, 0, 0]);
		expect(texel(header, HEADER.scarColour)).toEqual([0, 0, 0, 0]);
		const scarred: Species = {
			...record,
			base: {
				flare: { amount: 0.3, height: 0.5 },
				scar: {
					from: 0.2,
					to: 4,
					angle: 90,
					width: 40,
					depth: 0.5,
					colour: [0.01, 0.012, 0.009],
					shade: 0.8,
				},
			},
		};
		const written = speciesHeader(scarred, manifest, box);
		const scar = texel(written, HEADER.scar);
		expect(scar[0]).toBeCloseTo(0.2, 3);
		expect(scar[1]).toBeCloseTo(4, 3);
		expect(scar[2]).toBeCloseTo(Math.PI / 2, 4);
		expect(scar[3]).toBeCloseTo((Math.PI * 40) / 180 / 2, 4);
		const colour = texel(written, HEADER.scarColour);
		expect(colour[0]).toBeCloseTo(0.01, 5);
		expect(colour[1]).toBeCloseTo(0.012, 5);
		expect(colour[2]).toBeCloseTo(0.009, 5);
		expect(colour[3]).toBeCloseTo(0.8, 5);
	});

	test('gives the whole plant its species sway, in metres at its top and cycles a second', () => {
		const sway = record.wind.sway;
		const written = texel(header, HEADER.sway);
		expect(written[0]).toBeCloseTo(sway?.amplitude as number, 6);
		expect(written[1]).toBeCloseTo(sway?.frequency as number, 6);
		// The power its share of the top's motion rises with, the cantilever's square by default.
		expect(written[2]).toBeCloseTo(sway?.power ?? 2, 6);
	});

	test('gives a stiffer stem its own power on the sway', () => {
		const still = texel(header, HEADER.sway);
		expect(still[2]).toBeCloseTo(2, 6);
		const stiff: Species = {
			...record,
			wind: { ...record.wind, sway: { ...record.wind.sway, power: 3 } as never },
		};
		expect(texel(speciesHeader(stiff, manifest, speciesBox(stiff)), HEADER.sway)[2]).toBeCloseTo(
			3,
			6,
		);
	});

	test("writes each extra's body and band colour with their roughness", () => {
		const lathe: [number, number][] = [
			[0.005, 0],
			[0.007, 0.007],
			[0, 0.02],
		];
		const acorn = {
			kind: 'fruit' as const,
			at: 'shoot-tip' as const,
			share: 0.05,
			seasons: ['summer' as const],
			shape: { lathe, scaled: [0, 0.007] as [number, number] },
			colour: [0.24, 0.1, 0.03] as Rgb,
			hang: 180,
		};
		const fruiting: Species = {
			...record,
			extras: [
				{ ...acorn, bandColour: [0.3, 0.23, 0.15], roughness: [0.35, 0.85] },
				{ ...acorn, colour: [0.5, 0.4, 0.1] },
			],
		};
		const written = speciesHeader(fruiting, manifest, speciesBox(fruiting));
		const near = (a: readonly number[], b: readonly number[]) => {
			for (const [k, v] of a.entries()) expect(v).toBeCloseTo(b[k] as number, 6);
		};
		near(texel(written, HEADER.extras), [0.24, 0.1, 0.03, 0.35]);
		near(texel(written, HEADER.extraBands), [0.3, 0.23, 0.15, 0.85]);
		// An extra without a band takes its own colour there, and the default roughness on both.
		near(texel(written, HEADER.extras + 1), [0.5, 0.4, 0.1, EXTRA_ROUGHNESS]);
		near(texel(written, HEADER.extraBands + 1), [0.5, 0.4, 0.1, EXTRA_ROUGHNESS]);
		expect(HEADER.extraBands + MAX_EXTRAS).toBeLessThanOrEqual(RECORDS_WIDTH);
		// The cup's scale rows, the cells round its turn, and its band's share of the profile's
		// height at each end, which the shader needs to draw the scales within the band alone.
		const scaled = speciesHeader(
			{
				...record,
				extras: [{ ...acorn, shape: { lathe, sides: 12, scales: 4, scaled: [0, 0.007] } }],
			},
			manifest,
			speciesBox(record),
		);
		near(texel(scaled, HEADER.extraScales), [4, 12, 0, 0.35]);
		// A body without scales stays plain.
		near(texel(written, HEADER.extraScales), [0, 0, 0, 0]);
		expect(HEADER.extraScales + MAX_EXTRAS).toBeLessThanOrEqual(RECORDS_WIDTH);
	});

	test('writes the bark tint of each season the record names, and nothing for a season it leaves out', () => {
		// A record that names none multiplies the bark by nothing: the two texels carry no flag.
		expect(texel(header, HEADER.autumnBark)).toEqual([0, 0, 0, 0]);
		expect(texel(header, HEADER.winterBark)).toEqual([0, 0, 0, 0]);
		const turning: Species = {
			...record,
			seasons: { ...record.seasons, bark: { autumn: [2.1, 0.8, 0.4] } },
		};
		const written = speciesHeader(turning, manifest, speciesBox(turning));
		const autumn = texel(written, HEADER.autumnBark);
		expect(autumn.slice(0, 3).map((v) => toHalf(v as number))).toEqual([
			toHalf(2.1),
			toHalf(0.8),
			toHalf(0.4),
		]);
		expect(autumn[3]).toBe(1);
		expect(texel(written, HEADER.winterBark)).toEqual([0, 0, 0, 0]);
	});

	test('writes a winter stand its own leaf colours, and nothing where the record leaves them out', () => {
		expect(texel(header, HEADER.winterReflectance)).toEqual([0, 0, 0, 0]);
		const standing: Species = {
			...record,
			seasons: {
				...record.seasons,
				leaves: { winter: { reflectance: [0.24, 0.12, 0.07], transmittance: [0.26, 0.16, 0.1] } },
			},
		};
		const written = speciesHeader(standing, manifest, speciesBox(standing));
		const reflectance = texel(written, HEADER.winterReflectance);
		expect(reflectance.slice(0, 3).map((v) => toHalf(v as number))).toEqual([
			toHalf(0.24),
			toHalf(0.12),
			toHalf(0.07),
		]);
		expect(reflectance[3]).toBe(1);
		expect(
			texel(written, HEADER.winterTransmittance)
				.slice(0, 3)
				.map((v) => toHalf(v as number)),
		).toEqual([toHalf(0.26), toHalf(0.16), toHalf(0.1)]);
	});

	test('gives a species that names no sway the stated default', () => {
		// A missing sway must never leave the plant still.
		const bare: Species = { ...record, wind: { ...record.wind, sway: undefined } };
		const written = texel(speciesHeader(bare, manifest, speciesBox(bare)), HEADER.sway);
		expect(written[0]).toBeCloseTo(DEFAULT_WIND_SWAY.amplitude, 6);
		expect(written[1]).toBeCloseTo(DEFAULT_WIND_SWAY.frequency, 6);
		expect(written[2]).toBeCloseTo(DEFAULT_WIND_SWAY.power, 6);
	});

	test('keeps the species box to a hundredth of a millimetre through half floats', () => {
		// The GPU holds each number as a half float; the two halves add back to the box.
		const sum = (high: number, rest: number) =>
			[0, 1, 2].map(
				(k) => toHalf(texel(header, high)[k] as number) + toHalf(texel(header, rest)[k] as number),
			);
		const min = sum(HEADER.boxMin, HEADER.boxMinRest);
		const span = sum(HEADER.boxSpan, HEADER.boxSpanRest);
		for (let k = 0; k < 3; k++) {
			expect(Math.abs((min[k] as number) - (box.min[k] as number))).toBeLessThan(1e-5);
			const top = (min[k] as number) + (span[k] as number);
			expect(Math.abs(top - (box.max[k] as number))).toBeLessThan(1e-5);
		}
	});

	test("writes no bark zone past the shader's and no extra past its colours", () => {
		expect(HEADER.barkZones + MAX_BARK_ZONES * BARK_ZONE_TEXELS).toBeLessThanOrEqual(RECORDS_WIDTH);
		expect(HEADER.extras + MAX_EXTRAS).toBeLessThanOrEqual(HEADER.barkZones);
		expect(texel(header, HEADER.lichen)).toEqual([0, 0, 0, 0]);
		expect(texel(header, HEADER.youngTile)[2]).toBe(1);
	});

	test("writes a bark zone's second band, and leaves it empty where the record names none", () => {
		const near = (a: readonly number[], b: readonly number[]) => {
			for (const [k, v] of a.entries()) expect(v).toBeCloseTo(b[k] as number, 6);
		};
		const bark = record.bark as NonNullable<Species['bark']>;
		const zoned = {
			...record,
			bark: { ...bark, zones: [{ ...bark.zones[0], second: { from: 0, to: 1.5, blend: 0.2 } }] },
		} as Species;
		const written = speciesHeader(zoned, manifest, speciesBox(zoned));
		near(texel(written, HEADER.barkSeconds), [0, 1.5, 0.2, 1]);
		near(
			texel(speciesHeader(record, manifest, speciesBox(record)), HEADER.barkSeconds),
			[0, 0, 0, 0],
		);
	});

	test('writes the lichen colour, amount and heights', () => {
		const bark = record.bark;
		if (!bark) throw new Error('the stand-in has no bark');
		const colour: Rgb = [0.4, 0.45, 0.38];
		const withLichen: Species = {
			...record,
			bark: { ...bark, lichen: { amount: 0.85, from: 1.4, to: 1000, colour } },
		};
		const lichenHeader = speciesHeader(withLichen, manifest, speciesBox(withLichen));
		const near = (a: readonly number[], b: readonly number[]) => {
			for (const [k, v] of a.entries()) expect(v).toBeCloseTo(b[k] as number, 5);
		};
		near(texel(lichenHeader, HEADER.lichen).slice(0, 3), colour);
		expect(texel(lichenHeader, HEADER.lichen)[3]).toBeCloseTo(0.85, 5);
		near(texel(lichenHeader, HEADER.lichenReach).slice(0, 2), [1.4, 1000]);
	});

	test('writes the young bark tint, and lays its own colour where the record gives none', () => {
		const bark = record.bark;
		if (!bark) throw new Error('the stand-in has no bark');
		const near = (a: readonly number[], b: readonly number[]) => {
			for (const [k, v] of a.entries()) expect(v).toBeCloseTo(b[k] as number, 5);
		};
		near(texel(header, HEADER.youngTint).slice(0, 3), [1, 1, 1]);
		const tint: Rgb = [0.9, 0.95, 0.7];
		const tinted: Species = { ...record, bark: { ...bark, youngTint: tint } };
		const tintHeader = speciesHeader(tinted, manifest, speciesBox(tinted));
		near(texel(tintHeader, HEADER.youngTint).slice(0, 3), tint);
	});
});

describe('the plant shader', () => {
	const wgsl = readFileSync(new URL('./plant.wgsl', import.meta.url), 'utf8');
	const constant = (name: string) => {
		const match = new RegExp(`const ${name}: i32 = (\\d+);`).exec(wgsl);
		if (!match) throw new Error(`the plant shader declares no ${name}`);
		return Number(match[1]);
	};

	test("draws a silhouette black at the colour picture's cut edge in both plant shaders", () => {
		// The matte keeps each texel's own coverage, which on a coarse mip of fine leaflets is grey,
		// a smear to the eye; a silhouette draws black with the colour picture's sharpened edge.
		const viewFace = readFileSync(new URL('./plant-viewface.wgsl', import.meta.url), 'utf8');
		for (const source of [wgsl, viewFace]) {
			expect(source).toMatch(/let parts = material\.matte > 1\.5 && material\.matte < 2\.5;/);
			expect(source).toMatch(/let silhouette = material\.matte > 2\.5;/);
			expect(source).toMatch(/let matte = material\.matte > 0\.5 && material\.matte < 1\.5;/);
			expect(source).toMatch(
				/s\.baseColor = select\(base, vec3f\(0\.0\), matte \|\| parts \|\| silhouette\);/,
			);
			// Only the matte keeps the raw coverage: the alpha's choice names the matte alone.
			expect(source).toMatch(/s\.alpha = select\([^;]*, matte\);/);
		}
	});

	test("draws the review matte's soft coverage only where the colour picture draws", () => {
		// A card drawn larger than its texels blurs: the colour picture cuts it at the cutoff into
		// the fragments it shows, and a matte that kept every texel's soft coverage drew the blur as
		// a smear. The matte keeps a texel's own coverage only where the sharpened coverage, the
		// colour picture's, draws it.
		expect(wgsl).toMatch(/let drawn = sharpen\(cut, width\);/);
		expect(wgsl).toMatch(/s\.alpha = select\(drawn, select\(0\.0, alpha, drawn > 0\.0\), matte\);/);
		// A placed piece's fine edges draw a pixel wide in the matte, as merged foliage's do.
		expect(wgsl).toMatch(
			/mode == MODE_SHOOTS &&\s*material\.matte > 0\.5 &&\s*material\.matte < 1\.5 &&\s*abs\(input\.colors\.b \* 255\.0 - KIND_PIECE\) < 0\.5/,
		);
	});

	test('reads the texels that the header writes', () => {
		const names: Record<string, number> = {
			HEADER_UPPER: HEADER.upper,
			HEADER_LOWER: HEADER.lower,
			HEADER_UPPER_THROUGH: HEADER.upperThrough,
			HEADER_LOWER_THROUGH: HEADER.lowerThrough,
			HEADER_UPPER_REFLECTANCE: HEADER.upperReflectance,
			HEADER_LOWER_REFLECTANCE: HEADER.lowerReflectance,
			HEADER_TRANSMITTANCE: HEADER.transmittance,
			HEADER_UPPER_MEAN: HEADER.upperMean,
			HEADER_LOWER_MEAN: HEADER.lowerMean,
			HEADER_AUTUMN_REFLECTANCE: HEADER.autumnReflectance,
			HEADER_AUTUMN_TRANSMITTANCE: HEADER.autumnTransmittance,
			HEADER_BOX_MIN: HEADER.boxMin,
			HEADER_BOX_MIN_REST: HEADER.boxMinRest,
			HEADER_BOX_SPAN: HEADER.boxSpan,
			HEADER_BOX_SPAN_REST: HEADER.boxSpanRest,
			HEADER_YOUNG: HEADER.young,
			HEADER_YOUNG_TILE: HEADER.youngTile,
			HEADER_YOUNG_TINT: HEADER.youngTint,
			HEADER_COLLAR: HEADER.collar,
			HEADER_MOSS: HEADER.moss,
			HEADER_MOSS_REACH: HEADER.mossReach,
			HEADER_EXTRAS: HEADER.extras,
			HEADER_BUD: HEADER.bud,
			HEADER_BARK_ZONES: HEADER.barkZones,
			HEADER_BARK_SECONDS: HEADER.barkSeconds,
			HEADER_LICHEN: HEADER.lichen,
			HEADER_LICHEN_REACH: HEADER.lichenReach,
			HEADER_SWAY: HEADER.sway,
			HEADER_AUTUMN_BARK: HEADER.autumnBark,
			HEADER_WINTER_BARK: HEADER.winterBark,
			HEADER_WINTER_REFLECTANCE: HEADER.winterReflectance,
			HEADER_WINTER_TRANSMITTANCE: HEADER.winterTransmittance,
			HEADER_SHEATH: HEADER.sheath,
			HEADER_EXTRA_BANDS: HEADER.extraBands,
			HEADER_CARD_STALK: HEADER.cardStalk,
			HEADER_CARD_COVERAGE: HEADER.cardCoverage,
			HEADER_SCAR: HEADER.scar,
			HEADER_SCAR_COLOUR: HEADER.scarColour,
			HEADER_CARD_LEVEL_MOST: HEADER.cardLevelMost,
			BARK_ZONE_TEXELS,
			MAX_BARK_ZONES,
			MAX_EXTRAS,
			HEADER_ROWS,
			RECORDS_PER_ROW,
		};
		for (const [name, value] of Object.entries(names))
			expect([name, constant(name)]).toEqual([name, value]);
	});

	test('names the surface kinds that the mesh writers give a vertex', () => {
		const kind = (name: string) => {
			const match = new RegExp(`const ${name}: f32 = ([\\d.]+);`).exec(wgsl);
			if (!match) throw new Error(`the plant shader declares no ${name}`);
			return Number(match[1]);
		};
		const names: Record<string, number> = {
			KIND_STEM: SURFACE_STEM,
			KIND_BUD: SURFACE_BUD,
			KIND_SHEATH: SURFACE_SHEATH,
			KIND_PIECE: SURFACE_PIECE,
			KIND_PIECE_SHEATH: SURFACE_PIECE_SHEATH,
		};
		for (const [name, value] of Object.entries(names))
			expect([name, kind(name)]).toEqual([name, value]);
		// The material draws every kind below half the stem's as a leaf, and the pieces' are two of
		// them that it can tell from a leaf and from each other.
		expect(SURFACE_LEAF).toBeLessThan(SURFACE_PIECE);
		expect(SURFACE_PIECE).toBeLessThan(SURFACE_PIECE_SHEATH);
		expect(SURFACE_PIECE_SHEATH).toBeLessThan(SURFACE_STEM / 2);
		expect(leafSurface(SURFACE_LEAF) && leafSurface(SURFACE_PIECE)).toBe(true);
		expect(leafSurface(SURFACE_PIECE_SHEATH) || leafSurface(SURFACE_STEM)).toBe(false);
	});

	test("reads a part's positions as fractions of the box, as the plant geometry gives them", () => {
		// The engine adds the shader's offset to the position it reads, in 32-bit floats. A whole
		// step count runs to 65,535, where a float's steps are millimetres; a fraction of the box
		// keeps the sum to micrometres.
		const material = readFileSync(new URL('./material.ts', import.meta.url), 'utf8');
		expect(material).toContain('positions: { array: arrays.positions, normalized: true },');
		expect(wgsl).toContain('return low + p * span;');
		const steps = Math.fround(39800);
		const metres = Math.fround(6.1 + 0.0071);
		const asSteps = Math.fround(steps + Math.fround(metres - steps));
		const fraction = Math.fround(39800 / 65535);
		const asFraction = Math.fround(fraction + Math.fround(metres - fraction));
		expect(Math.abs(asSteps - metres)).toBeGreaterThan(0.0005);
		expect(Math.abs(asFraction - metres)).toBeLessThan(0.000005);
	});

	test('declares six textures and fits its uniforms beside them', () => {
		expect(wgsl.match(/^var \w+: texture_2d(_array)?<f32>;/gm)?.length).toBe(6);
		const block = /struct Uniforms \{([^}]*)\}/.exec(wgsl)?.[1] ?? '';
		const numbers = [...block.matchAll(/:\s*f32/g)].length;
		// 32 numbers less one for each texture.
		expect(numbers).toBeLessThanOrEqual(26);
	});
});

describe('the wind rows', () => {
	test('hold each record at its global id, with its parent in two bytes', () => {
		const rows = recordsRows(2, VARIANT_RECORDS);
		const data = new Float32Array(rows * RECORDS_WIDTH * 4);
		const records = new Float32Array(3 * WIND_RECORD_FLOATS);
		for (let r = 0; r < 3; r++) {
			records.set([r, r + 0.5, r + 0.25], r * WIND_RECORD_FLOATS);
			records[r * WIND_RECORD_FLOATS + 3] = r === 0 ? -1 : VARIANT_RECORDS + r - 1;
		}
		const base = VARIANT_RECORDS;
		expect(writeWindRecords(data, { base, count: 3, records })).toBe(true);
		const at = (id: number) => (HEADER_ROWS * RECORDS_WIDTH + id * 4) * 4;
		const second = at(base + 2);
		expect(data[second]).toBe(2);
		const parent = (data[second + 3] as number) * 256 + (data[second + 15] as number);
		expect(parent).toBe(base + 1);
		expect(data[at(base) + 3]).toBe(-1);
		expect(data[at(base) + 15]).toBe(-1);
		// Every number the GPU reads stays a whole number that a half float keeps.
		expect(toHalf(data[second + 3] as number)).toBe(data[second + 3] as number);
	});

	test('refuse a record past the texture', () => {
		const data = new Float32Array(recordsRows(1, 10) * RECORDS_WIDTH * 4);
		expect(
			writeWindRecords(data, {
				base: 4 * RECORDS_PER_ROW,
				count: 1,
				records: new Float32Array(16),
			}),
		).toBe(false);
	});

	test("hold the field's steady settings in the second row", () => {
		const data = new Float32Array(recordsRows(1, 10) * RECORDS_WIDTH * 4);
		writeSteadyWind(data, {
			base: [1, 2, 3, 4],
			gust: [5, 6, 7, 8],
			swirl: [9, 10, 11, 12],
			sent: [13, 14, 15, 16],
		});
		expect([...data.subarray(RECORDS_WIDTH * 4, RECORDS_WIDTH * 4 + 16)]).toEqual(
			Array.from({ length: 16 }, (_, i) => i + 1),
		);
	});
});

describe('the shoot rows', () => {
	test('hold every value exactly at half precision, as the shader unpacks them', () => {
		const out = new Float32Array(4);
		for (const [record, phase, sky, bent, slot] of [
			[0, 0, 0, 0, 0],
			[64_999, 255, 250, 255, 15],
			[8_000 + 1_234, 77, 131, 0x9c, 7],
		] as const) {
			writeShootRow(out, 0, record, phase, sky, bent, slot);
			for (const value of out) expect(toHalf(value)).toBe(value);
			// The shader's unpacking, in numbers.
			const low = Math.floor(out[1] as number);
			expect((out[0] as number) * 32 + low).toBe(record);
			expect(Math.abs(((out[1] as number) - low) * 256 - phase)).toBeLessThan(4);
			const skyBack = Math.floor((out[2] as number) / 8);
			const lowBent = Math.floor((out[3] as number) / 16);
			expect(skyBack).toBe(sky);
			expect(((out[2] as number) - skyBack * 8) * 32 + lowBent).toBe(bent);
			expect((out[3] as number) - lowBent * 16).toBe(slot);
		}
	});
});
