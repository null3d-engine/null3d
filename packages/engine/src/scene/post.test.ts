import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import { Lut } from './lut';
import type { CoreMemory } from './memory';
import { exposureOfEv100, Post, type PostSettings } from './post';
import type { Texture } from './textures';

/**
 * A post object whose core records each setOutput, setBloom, setAo, setLut, setVignette and
 * setOutline call, with its arguments and the values that it reads from the block of
 * post-processing values. The block starts with the core's defaults.
 */
function post(
	hdrEffects = true,
	occlusionTargets = true,
): {
	post: Post;
	calls: [number, number][];
	blooms: [boolean, ...number[]][];
	aos: [boolean, ...number[]][];
	luts: number[][];
	vignettes: [boolean, number, number][];
	outlines: number[][];
	reads: () => number;
} {
	const calls: [number, number][] = [];
	const blooms: [boolean, ...number[]][] = [];
	const aos: [boolean, ...number[]][] = [];
	const luts: number[][] = [];
	const vignettes: [boolean, number, number][] = [];
	const outlines: number[][] = [];
	const block = Float32Array.of(
		...[1, 0.15, 0, 0.1, 1, 0, 0, 0, 1, 1, 1, 1, 1],
		...[0.25, 1, 1, 1, 1, 16, 1],
		...[1, 1, 1, 1, 1, 1, 0, 2],
		...[0, 0.28, 0.1872, 0.1359, 0.1012, 0.0754, 0.0562, 0.0419, 0.1223, 0, 0],
	);
	expect(block.length).toBe(C.POST_VALUE_COUNT);
	let views = 0;
	const at = (place: number) => block[place] as number;
	const core = {
		generation: 0,
		f32: () => {
			views++;
			return block;
		},
		glue: {
			postValues: () => 0,
			setOutput(toneMapping: number) {
				calls.push([toneMapping, at(C.POST_VALUE_EXPOSURE)]);
				return 0;
			},
			setBloom(on: boolean) {
				const weights = [...block.subarray(C.POST_VALUE_BLOOM_WEIGHTS, C.POST_VALUE_COUNT)];
				blooms.push([
					on,
					...[
						C.POST_VALUE_BLOOM_INTENSITY,
						C.POST_VALUE_BLOOM_THRESHOLD,
						C.POST_VALUE_BLOOM_KNEE,
					].map((place) => Math.round(at(place) * 1e4) / 1e4),
					at(C.POST_VALUE_BLOOM_BLEND),
					...weights.map((v) => Math.round(v * 1e4) / 1e4),
				]);
				return 0;
			},
			setAo(on: boolean) {
				const values = [0, 1, 2, 3, 4, 5, 6].map((k) => at(C.POST_VALUE_AO_RADIUS + k));
				aos.push([on, ...values]);
				return 0;
			},
			setLut(texture: number) {
				const domain = [0, 1, 2].map((k) => at(C.POST_VALUE_LUT_DOMAIN_MIN + k));
				const top = [0, 1, 2].map((k) => at(C.POST_VALUE_LUT_DOMAIN_MAX + k));
				luts.push([texture, at(C.POST_VALUE_LUT_INTENSITY), ...domain, ...top]);
				return 0;
			},
			setVignette(on: boolean) {
				vignettes.push([on, at(C.POST_VALUE_VIGNETTE_OFFSET), at(C.POST_VALUE_VIGNETTE_DARKNESS)]);
				return 0;
			},
			setOutline(on: boolean) {
				const first = C.POST_VALUE_OUTLINE_COLOR;
				const values = [...block.subarray(first, C.POST_VALUE_OUTLINE_WIDTH + 1)];
				outlines.push([on ? 1 : 0, ...values.map((v) => Math.round(v * 1e4) / 1e4)]);
				return 0;
			},
		},
		check: (result: number) => result,
	} as unknown as CoreMemory;
	return {
		post: new Post(core, hdrEffects, occlusionTargets),
		calls,
		blooms,
		aos,
		luts,
		vignettes,
		outlines,
		reads: () => views,
	};
}

/** A table of 33 texels a side over a domain from -0.5 to 2, whose texture has handle 7. */
const table = new Lut({ handle: 7 } as Texture, 33, 'Warm', [-0.5, -0.5, -0.5], [2, 2, 2]);

describe('post.set', () => {
	it('sends the tone mapping by code and the exposure, and keeps a setting it is not given', () => {
		const { post: output, calls } = post();
		output.set({ toneMapping: 'agx' });
		output.set({ exposure: 2 });
		output.set({ toneMapping: 'none', exposure: 0.5 });
		output.set({});
		output.set({ toneMapping: 'agx-punchy' });
		expect(calls).toEqual([
			[C.TONE_MAPPING_AGX, 1],
			[C.TONE_MAPPING_AGX, 2],
			[C.TONE_MAPPING_NONE, 0.5],
			[C.TONE_MAPPING_NONE, 0.5],
			[C.TONE_MAPPING_AGX_PUNCHY, 0.5],
		]);
	});

	it('turns outlines on with a white line of 2 pixels, takes colors in linear, and keeps the values while off', () => {
		const { post: output, outlines } = post();
		output.set({ outline: {} });
		output.set({ outline: { color: '#ff0000', hiddenColor: [0.2, 0.3, 0.4], width: 3 } });
		output.set({ outline: false });
		output.set({ outline: { hiddenColor: false } });
		expect(outlines).toEqual([
			[1, 1, 1, 1, 1, 1, 1, 0, 2],
			[1, 1, 0, 0, 0.2, 0.3, 0.4, 1, 3],
			[0, 1, 0, 0, 0.2, 0.3, 0.4, 1, 3],
			[1, 1, 0, 0, 0.2, 0.3, 0.4, 0, 3],
		]);
	});

	it('refuses outline settings it does not know and values out of range', () => {
		const { post: output } = post();
		const bad = (settings: unknown) => () => output.set(settings as PostSettings);
		expect(bad({ outline: { glow: 1 } })).toThrow('E1213');
		expect(bad({ outline: { width: -1 } })).toThrow('E1213');
		expect(bad({ outline: { width: Number.NaN } })).toThrow('E1203');
		expect(bad({ outline: { color: 'red' } })).toThrow('E1204');
		expect(bad({ outline: { hiddenColor: [2, 0, 0] } })).toThrow('E1204');
		expect(bad({ outline: 3 })).toThrow('E1213');
	});

	it('starts from AgX at an exposure of 1', () => {
		const { post: output, calls } = post();
		output.set({});
		expect(calls).toEqual([[C.TONE_MAPPING_AGX, 1]]);
	});

	it('turns bloom on with its defaults and the values given, keeps them while off, and sends them only with bloom', () => {
		const { post: output, blooms } = post();
		expect(output.bloomOn).toBe(false);
		output.set({ exposure: 1.5 });
		expect(blooms).toEqual([]);
		output.set({ bloom: {} });
		output.set({ bloom: { intensity: 1.5, blend: 'add', weights: [1, 0, 3] } });
		output.set({ bloom: false });
		expect(output.bloomOn).toBe(false);
		output.set({ bloom: { threshold: 0.875, knee: 0.01, blend: 'screen' } });
		expect(output.bloomOn).toBe(true);
		const defaults = [0.28, 0.1872, 0.1359, 0.1012, 0.0754, 0.0562, 0.0419, 0.1223, 0, 0];
		const given = [1, 0, 3, 0, 0, 0, 0, 0, 0, 0];
		expect(blooms).toEqual([
			[true, 0.15, 0, 0.1, 0, ...defaults],
			[true, 1.5, 0, 0.1, 1, ...given],
			[false, 1.5, 0, 0.1, 1, ...given],
			[true, 1.5, 0.875, 0.01, 2, ...given],
		]);
	});

	it('warns once where the device has no HDR target, and still tells the core', () => {
		const { post: output, blooms } = post(false);
		const warnings: unknown[] = [];
		const warn = console.warn;
		console.warn = (message: unknown) => warnings.push(message);
		try {
			output.set({ bloom: {} });
			output.set({ bloom: { intensity: 0.5 } });
		} finally {
			console.warn = warn;
		}
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0])).toContain('no HDR target');
		expect(blooms).toHaveLength(2);
	});

	it("turns ambient occlusion on with GTAOPass's defaults and the values given, and keeps them while off", () => {
		const { post: output, aos, blooms } = post();
		output.set({ exposure: 2 });
		expect(aos).toEqual([]);
		output.set({ ao: {} });
		output.set({ ao: { radius: 0.5, samples: 32, intensity: 0.5 } });
		output.set({ ao: false });
		output.set({ ao: { thickness: 2, distanceExponent: 2, distanceFalloff: 0.5, scale: 1.5 } });
		expect(aos).toEqual([
			[true, 0.25, 1, 1, 1, 1, 16, 1],
			[true, 0.5, 1, 1, 1, 1, 32, 0.5],
			[false, 0.5, 1, 1, 1, 1, 32, 0.5],
			[true, 0.5, 2, 2, 0.5, 1.5, 32, 0.5],
		]);
		expect(blooms).toEqual([]);
		expect(output.aoOn).toBe(true);
	});

	it('warns once where the device has no float targets, and keeps ambient occlusion off', () => {
		const { post: output, aos } = post(true, false);
		const warnings: unknown[] = [];
		const warn = console.warn;
		console.warn = (message: unknown) => warnings.push(message);
		try {
			output.set({ ao: {} });
			output.set({ ao: { radius: 1 } });
		} finally {
			console.warn = warn;
		}
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0])).toContain('float render targets');
		expect(aos.map(([on]) => on)).toEqual([false, false]);
		expect(output.aoOn).toBe(false);
	});

	it('sends the table with its intensity and domain, keeps the intensity, and turns it off with false', () => {
		const { post: output, luts } = post();
		output.set({ exposure: 1.5 });
		expect(luts).toEqual([]);
		output.set({ lut: table });
		output.set({ lutIntensity: 0.25 });
		output.set({ lut: false });
		output.set({ lut: table });
		const sent = [7, 1, -0.5, -0.5, -0.5, 2, 2, 2];
		const quarter = [7, 0.25, -0.5, -0.5, -0.5, 2, 2, 2];
		expect(luts).toEqual([sent, quarter, [0, ...quarter.slice(1)], quarter]);
	});

	it('turns the vignette on with three.js defaults and the values given, and keeps them while off', () => {
		const { post: output, vignettes } = post();
		output.set({ vignette: {} });
		output.set({ vignette: { darkness: 1.5 } });
		output.set({ vignette: false });
		output.set({ vignette: { offset: 0.75 } });
		expect(vignettes).toEqual([
			[true, 1, 1],
			[true, 1, 1.5],
			[false, 1, 1.5],
			[true, 0.75, 1.5],
		]);
	});

	it("gives a camera's exposure for its EV100 with Filament's formula", () => {
		// Filament's Exposure.cpp: 1 / (1.2 × 2^EV100). Its default camera, f/16 at 1/125 s and
		// ISO 100, is about EV100 15, where a sun of 100,000 lux lights white paper near 1.
		expect(exposureOfEv100(0)).toBeCloseTo(1 / 1.2, 12);
		expect(exposureOfEv100(15)).toBeCloseTo(1 / 39_321.6, 15);
		expect(exposureOfEv100(-2)).toBeCloseTo(4 / 1.2, 12);
		const ev100 = Math.log2((16 * 16) / (1 / 125)) - Math.log2(100 / 100);
		expect(ev100).toBeCloseTo(14.97, 2);
		expect((100_000 / Math.PI) * exposureOfEv100(ev100)).toBeCloseTo(0.83, 2);
	});

	it('sends the exposure times the camera exposure of ev100, until ev100 is false', () => {
		const { post: output, calls } = post();
		output.set({ ev100: 15 });
		output.set({ exposure: 2 });
		output.set({ ev100: 12 });
		output.set({ ev100: false });
		const sent = calls.map(([, exposure]) => exposure);
		expect(sent[0]).toBeCloseTo(exposureOfEv100(15), 10);
		expect(sent[1]).toBeCloseTo(2 * exposureOfEv100(15), 10);
		expect(sent[2]).toBeCloseTo(2 * exposureOfEv100(12), 10);
		expect(sent[3]).toBe(2);
	});

	it('makes its view of the values once, and again only after the memory grew', () => {
		const { post: output, reads } = post();
		output.set({ exposure: 1.25 });
		output.set({ lutIntensity: 0.5, vignette: { offset: 1.5 } });
		expect(reads()).toBe(1);
	});

	it('refuses an unknown setting or tone mapping, and a value out of range, with E1213', () => {
		const { post: output, calls, blooms } = post();
		for (const bad of [
			{ glow: { strength: 1 } },
			{ toneMapping: 'filmic' },
			{ toneMapping: 'toString' },
			{ exposure: -1 },
			{ exposure: 1e39 },
			{ ev100: -21 },
			{ ev100: 31 },
			{ bloom: true },
			{ bloom: { strength: 1 } },
			{ bloom: { intensity: -1 } },
			{ bloom: { knee: -0.1 } },
			{ bloom: { threshold: -0.1 } },
			{ bloom: { blend: 'multiply' } },
			{ bloom: { blend: 'toString' } },
			{ bloom: { weights: [] } },
			{ bloom: { weights: [0, 0] } },
			{ bloom: { weights: [1, -1] } },
			{ bloom: { weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] } },
			{ bloom: { weights: 1 } },
			{ lut: true },
			{ lut: { size: 33 } },
			{ lutIntensity: 1.5 },
			{ vignette: 1 },
			{ vignette: { amount: 0.3 } },
			{ vignette: { offset: -1 } },
			{ vignette: { darkness: -0.5 } },
			{ ao: true },
			{ ao: { strength: 1 } },
			{ ao: { radius: -1 } },
			{ ao: { thickness: -1 } },
			{ ao: { distanceExponent: 0 } },
			{ ao: { distanceFalloff: 1.5 } },
			{ ao: { scale: -1 } },
			{ ao: { intensity: 2 } },
			{ ao: { samples: 0 } },
			{ ao: { samples: 8.5 } },
			{ ao: { samples: 65 } },
		])
			expect(() => output.set(bad as PostSettings)).toThrow('E1213');
		expect(calls).toEqual([]);
		expect(blooms).toEqual([]);
	});

	it('refuses an exposure that the camera exposure takes past the largest 32-bit float', () => {
		const { post: output, calls } = post();
		output.set({ exposure: 3e38 });
		expect(() => output.set({ ev100: -20 })).toThrow('E1213');
		expect(calls.length).toBe(1);
		// The refused EV100 is not kept.
		output.set({ exposure: 1 });
		expect(calls[1]).toEqual([C.TONE_MAPPING_AGX, 1]);
	});

	it('refuses a value that is not a finite number with E1203', () => {
		const { post: output } = post();
		for (const exposure of [Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => output.set({ exposure })).toThrow('E1203');
		expect(() => output.set({ bloom: { intensity: Number.NaN } })).toThrow('E1203');
		expect(() => output.set({ bloom: { weights: [1, Number.NaN] } })).toThrow('E1203');
		for (const ev100 of [Number.NaN, Number.NEGATIVE_INFINITY, true, '15'])
			expect(() => output.set({ ev100 } as PostSettings)).toThrow('E1203');
		expect(() => output.set({ lutIntensity: Number.NaN })).toThrow('E1203');
		expect(() => output.set({ vignette: { offset: Number.POSITIVE_INFINITY } })).toThrow('E1203');
		expect(() => output.set({ ao: { radius: Number.NaN } })).toThrow('E1203');
	});
});
