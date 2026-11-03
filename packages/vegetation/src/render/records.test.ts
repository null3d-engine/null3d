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
import { VARIANT_RECORDS, WIND_RECORD_FLOATS } from '../wind/records';
import {
	BARK_ZONE_TEXELS,
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
		expect(texel(header, HEADER.youngTile)[2]).toBe(1);
	});
});

describe('the plant shader', () => {
	const wgsl = readFileSync(new URL('./plant.wgsl', import.meta.url), 'utf8');
	const constant = (name: string) => {
		const match = new RegExp(`const ${name}: i32 = (\\d+);`).exec(wgsl);
		if (!match) throw new Error(`the plant shader declares no ${name}`);
		return Number(match[1]);
	};

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
			HEADER_MOSS: HEADER.moss,
			HEADER_MOSS_REACH: HEADER.mossReach,
			HEADER_EXTRAS: HEADER.extras,
			HEADER_BARK_ZONES: HEADER.barkZones,
			BARK_ZONE_TEXELS,
			MAX_BARK_ZONES,
			MAX_EXTRAS,
			HEADER_ROWS,
			RECORDS_PER_ROW,
		};
		for (const [name, value] of Object.entries(names))
			expect([name, constant(name)]).toEqual([name, value]);
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
