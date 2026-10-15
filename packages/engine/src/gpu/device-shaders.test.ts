import { describe, expect, it, spyOn } from 'bun:test';
import {
	PERMUTATION_ALPHA_HASH,
	PERMUTATION_BLOOM,
	PERMUTATION_DRAW_INDEX,
	PERMUTATION_HALF,
	PERMUTATION_SKIN,
	PERMUTATION_TONE_MAP,
} from '../generated/gpu';
import type { DeviceShaders, FirstUseShaders, ShaderVariant } from '../generated/shaders';
import { FIRST_RETRY_MS } from '../shared/first-use';
import { DeviceShaderSet } from './device-shaders';

/** A WGSL build with the permutation word `permutation`. */
const build = (permutation: number): ShaderVariant<'main'> => ({
	permutation,
	wgsl: { source: '', pipelines: { main: { vertex: 'vs', fragment: 'fs' } } },
	glsl: null,
});

/** The start's module of a device: the final pass without bloom, no sprite builds and a mesh template. */
function start(): DeviceShaders {
	return {
		final: { webgpu: build(0) },
		bloom: {},
		sprite: {},
		lit: { webgpu: build(0) },
	} as unknown as DeviceShaders;
}

/** The keys of the device modules of features that load on first use, as a target may have them. */
const FILES = ['bloom', 'hash', 'skinning', 'sprites', 'hash+skinning', 'bloom+hash+skinning'];

/** A loader that records each module it is asked for, and settles each when the test says so. */
function loader() {
	const asked: string[] = [];
	const pending: (() => void)[] = [];
	const load = (bits: number, feature: string | undefined) => {
		// Each module's builds are the final pass's of its key, so a test sees which modules arrived.
		asked.push(feature === undefined ? `start ${bits}` : `${feature} ${bits}`);
		const shaders: FirstUseShaders =
			feature === 'bloom'
				? ({ final: { webgpu_bloom: build(PERMUTATION_BLOOM) } } as FirstUseShaders)
				: feature === 'sprites'
					? ({ sprite: { webgpu: build(0) } } as unknown as FirstUseShaders)
					: feature === undefined
						? ({ final: { webgpu_tone_map: build(PERMUTATION_TONE_MAP) } } as FirstUseShaders)
						: ({ final: { [feature]: build(0) } } as unknown as FirstUseShaders);
		return new Promise<FirstUseShaders>((resolve) => pending.push(() => resolve(shaders)));
	};
	const settle = async () => {
		for (const resolve of pending.splice(0)) resolve();
		await Promise.resolve();
		await Promise.resolve();
	};
	return { asked, load, settle };
}

describe('DeviceShaderSet', () => {
	it('reports a module that failed to download, and loads it again after a wait', async () => {
		const asked: string[] = [];
		const reports: string[] = [];
		const set = new DeviceShaderSet(
			start(),
			PERMUTATION_TONE_MAP,
			async (bits, feature) => {
				asked.push(feature === undefined ? `start ${bits}` : `${feature} ${bits}`);
				throw new Error('404 Not Found');
			},
			[],
			{ reportFailure: (message) => reports.push(message), failFast: false },
		);
		const sprite = set.shaders.sprite;
		const begin = performance.now();
		expect(set.ready(sprite, 0, 'wgsl')).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 0));
		// The pipeline waits, and the drawing goes on.
		expect(set.ready(sprite, 0, 'wgsl')).toBe(false);
		expect(asked).toEqual(['sprites 0']);
		expect(reports).toEqual([
			"E1406: the engine's shaders that a pipeline needs did not download: 404 Not Found.",
		]);
		const now = spyOn(performance, 'now').mockImplementation(() => begin + FIRST_RETRY_MS + 1);
		try {
			expect(set.ready(sprite, 0, 'wgsl')).toBe(false);
			expect(asked).toEqual(['sprites 0', 'sprites 0']);
		} finally {
			now.mockRestore();
		}
	});

	it('stops the drawing with the failed download in hold mode', async () => {
		const set = new DeviceShaderSet(start(), PERMUTATION_TONE_MAP, async () => {
			throw new Error('404 Not Found');
		});
		const sprite = set.shaders.sprite;
		expect(set.ready(sprite, 0, 'wgsl')).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(() => set.ready(sprite, 0, 'wgsl')).toThrow(
			"E1406: the engine's shaders that a pipeline needs did not download: 404 Not Found.",
		);
	});

	it("loads a feature's module once, the first time a pipeline asks for one of its shaders", async () => {
		const { asked, load, settle } = loader();
		const set = new DeviceShaderSet(start(), PERMUTATION_TONE_MAP, load);
		const sprite = set.shaders.sprite;
		expect(set.ready(sprite, 0, 'wgsl')).toBe(false);
		expect(set.ready(sprite, 0, 'wgsl')).toBe(false);
		expect(asked).toEqual(['sprites 0']);
		await settle();
		expect(set.ready(sprite, 0, 'wgsl')).toBe(true);
		expect(Object.keys(sprite)).toEqual(['webgpu']);
		expect(asked).toEqual(['sprites 0']);
	});

	it("loads a feature's module for a build with the feature's bit, with the device's half bit", async () => {
		const { asked, load, settle } = loader();
		const set = new DeviceShaderSet(start(), PERMUTATION_HALF, load);
		const final = set.shaders.final;
		expect(set.ready(final, 0, 'wgsl')).toBe(true);
		expect(set.ready(final, PERMUTATION_BLOOM, 'wgsl')).toBe(false);
		expect(asked).toEqual([`bloom ${PERMUTATION_HALF}`]);
		await settle();
		expect(set.ready(final, PERMUTATION_BLOOM, 'wgsl')).toBe(true);
	});

	it("loads a feature's module of the device's draw index for a pass whose shader has no build with it", async () => {
		const { asked, load, settle } = loader();
		const set = new DeviceShaderSet(start(), PERMUTATION_DRAW_INDEX, load);
		const sprite = set.shaders.sprite;
		expect(set.ready(sprite, 0, 'wgsl')).toBe(false);
		expect(set.ready(sprite, PERMUTATION_DRAW_INDEX, 'wgsl')).toBe(false);
		expect(asked).toEqual([`sprites ${PERMUTATION_DRAW_INDEX}`]);
		await settle();
		expect(set.ready(sprite, 0, 'wgsl')).toBe(true);
	});

	it("loads the start's module of other fixed bits for a build of no feature", async () => {
		const { asked, load, settle } = loader();
		const set = new DeviceShaderSet(start(), 0, load);
		expect(set.ready(set.shaders.final, PERMUTATION_TONE_MAP, 'wgsl')).toBe(false);
		expect(asked).toEqual([`start ${PERMUTATION_TONE_MAP}`]);
		await settle();
		expect(set.ready(set.shaders.final, PERMUTATION_TONE_MAP, 'wgsl')).toBe(true);
	});

	it("preloads a feature's module, which a pipeline then finds without loading it again", async () => {
		const { asked, load, settle } = loader();
		const set = new DeviceShaderSet(start(), PERMUTATION_TONE_MAP, load, FILES);
		const preloaded = set.preload(['sprites']);
		expect(asked).toEqual([`sprites ${PERMUTATION_TONE_MAP}`]);
		expect(set.ready(set.shaders.sprite, PERMUTATION_TONE_MAP, 'wgsl')).toBe(false);
		await settle();
		await preloaded;
		expect(set.ready(set.shaders.sprite, PERMUTATION_TONE_MAP, 'wgsl')).toBe(true);
		await set.preload(['sprites']);
		expect(asked).toEqual([`sprites ${PERMUTATION_TONE_MAP}`]);
	});

	it("preloads bloom's HDR builds and the start's on the 8-bit path, which bloom moves to HDR", () => {
		const { asked, load } = loader();
		const set = new DeviceShaderSet(start(), PERMUTATION_TONE_MAP | PERMUTATION_HALF, load, FILES);
		void set.preload(['bloom']);
		const half = PERMUTATION_HALF;
		expect(asked).toEqual([
			`bloom ${PERMUTATION_TONE_MAP | half}`,
			`start ${half}`,
			`bloom ${half}`,
		]);
	});

	it('hands each preloaded module to its listener once it arrives, and those that arrived before', async () => {
		const { load, settle } = loader();
		const set = new DeviceShaderSet(start(), 0, load, FILES);
		const heard: string[] = [];
		set.onPreloaded((features) => heard.push(`early ${features.join(' and ')}`));
		const preloaded = set.preload(['sprites']);
		expect(set.ready(set.shaders.final, PERMUTATION_BLOOM, 'wgsl')).toBe(false);
		await settle();
		await preloaded;
		expect(heard).toEqual(['early sprites']);
		const more = set.preload(['hash', 'skinning']);
		await settle();
		await more;
		set.onPreloaded((features) => heard.push(`late ${features.join(' and ')}`));
		expect(heard).toEqual([
			'early sprites',
			'early hash',
			'early skinning',
			'early hash and skinning',
			'late sprites',
			'late hash',
			'late skinning',
			'late hash and skinning',
		]);
	});

	it('preloads the module of the builds that need several features once each of them is preloaded', () => {
		const { asked, load } = loader();
		const set = new DeviceShaderSet(start(), 0, load, FILES);
		void set.preload(['hash']);
		expect(asked).toEqual(['hash 0']);
		void set.preload(['skinning']);
		expect(asked).toEqual(['hash 0', 'skinning 0', 'hash+skinning 0']);
		void set.preload(['bloom']);
		expect(asked).toEqual([
			'hash 0',
			'skinning 0',
			'hash+skinning 0',
			'bloom 0',
			'bloom+hash+skinning 0',
		]);
	});

	it('preloads no module of several features while a preload lacks one of them', () => {
		const { asked, load } = loader();
		const set = new DeviceShaderSet(start(), 0, load, FILES);
		void set.preload(['bloom', 'hash']);
		expect(asked).toEqual(['bloom 0', 'hash 0']);
	});

	it('loads only the module of the features that a build needs: one, two or three of them', async () => {
		const { asked, load, settle } = loader();
		const set = new DeviceShaderSet(start(), 0, load, FILES);
		const lit = set.shaders.lit;
		const hash = PERMUTATION_ALPHA_HASH;
		expect(set.ready(lit, hash, 'wgsl')).toBe(false);
		expect(set.ready(lit, hash | PERMUTATION_SKIN, 'wgsl')).toBe(false);
		expect(set.ready(lit, hash | PERMUTATION_SKIN | PERMUTATION_BLOOM, 'wgsl')).toBe(false);
		expect(asked).toEqual(['hash 0', 'hash+skinning 0', 'bloom+hash+skinning 0']);
		await settle();
		expect(set.ready(lit, hash | PERMUTATION_SKIN, 'wgsl')).toBe(true);
		expect(set.ready(lit, PERMUTATION_SKIN, 'wgsl')).toBe(false);
		expect(asked.at(-1)).toBe('skinning 0');
	});
});
