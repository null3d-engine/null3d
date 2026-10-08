import { describe, expect, it } from 'bun:test';
import {
	PERMUTATION_BLOOM,
	PERMUTATION_DRAW_INDEX,
	PERMUTATION_HALF,
	PERMUTATION_TONE_MAP,
} from '../generated/gpu';
import type {
	DeviceShaders,
	FirstUseShaders,
	ShaderVariant,
	ShaderVariants,
} from '../generated/shaders';
import type { CustomShader } from '../shared/images';
import { DeviceShaderSet } from './device-shaders';

/** A WGSL build with the permutation word `permutation`. */
const build = (permutation: number): ShaderVariant<'main'> => ({
	permutation,
	wgsl: { source: '', pipelines: { main: { vertex: 'vs', fragment: 'fs' } } },
	glsl: null,
});

/** The start's module of a device: the final pass without bloom, and no sprite builds. */
function start(): DeviceShaders {
	return {
		final: { webgpu: build(0) },
		bloom: {},
		sprite: {},
	} as unknown as DeviceShaders;
}

/** A loader that records each module it is asked for, and settles each when the test says so. */
function loader() {
	const asked: string[] = [];
	const pending: (() => void)[] = [];
	const load = (bits: number, feature: string | undefined) => {
		asked.push(feature === undefined ? `start ${bits}` : `${feature} ${bits}`);
		const shaders: FirstUseShaders =
			feature === 'bloom'
				? ({ final: { webgpu_bloom: build(PERMUTATION_BLOOM) } } as FirstUseShaders)
				: feature === 'sprites'
					? ({ sprite: { webgpu: build(0) } } as unknown as FirstUseShaders)
					: ({ final: { webgpu_tone_map: build(PERMUTATION_TONE_MAP) } } as FirstUseShaders);
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
	it('names the failed download when a pipeline needs the shaders of a module that failed to load', async () => {
		const asked: string[] = [];
		const set = new DeviceShaderSet(start(), PERMUTATION_TONE_MAP, async (bits, feature) => {
			asked.push(feature === undefined ? `start ${bits}` : `${feature} ${bits}`);
			throw new Error('404 Not Found');
		});
		const sprite = set.shaders.sprite;
		expect(set.ready(sprite, 0, 'wgsl')).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(() => set.ready(sprite, 0, 'wgsl')).toThrow(
			"E1406: the engine's shaders that a pipeline needs did not download: 404 Not Found.",
		);
		expect(asked).toEqual(['sprites 0']);
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
		const set = new DeviceShaderSet(start(), PERMUTATION_TONE_MAP, load);
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
		const set = new DeviceShaderSet(start(), PERMUTATION_TONE_MAP | PERMUTATION_HALF, load);
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
		const set = new DeviceShaderSet(start(), 0, load);
		const heard: string[] = [];
		set.onPreloaded((feature) => heard.push(`early ${feature}`));
		const preloaded = set.preload(['sprites']);
		expect(set.ready(set.shaders.final, PERMUTATION_BLOOM, 'wgsl')).toBe(false);
		await settle();
		await preloaded;
		expect(heard).toEqual(['early sprites']);
		set.onPreloaded((feature) => heard.push(`late ${feature}`));
		expect(heard).toEqual(['early sprites', 'late sprites']);
	});
});

describe('DeviceShaderSet with custom materials', () => {
	const GLSL = (permutation: number): ShaderVariant =>
		({
			permutation,
			wgsl: null,
			glsl: {
				main: {
					vertex: { source: '', uniformBlocks: [], textures: [] },
					fragment: { source: '', uniformBlocks: [], textures: [] },
				},
			},
		}) as unknown as ShaderVariant;
	/** The files of a material at place 1 in each, with a WebGL2 file for two values of the fixed bits. */
	const files = {
		index: 1,
		wgsl: {},
		glsl: {
			[PERMUTATION_DRAW_INDEX]: 'draw-index.js',
			[PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP]: 'tone-map.js',
		},
	};
	/** A file loader that records each address and settles when the test says so. */
	function fileLoader(lists: Record<string, ShaderVariants[]>) {
		const asked: string[] = [];
		const pending: (() => void)[] = [];
		const load = (url: string) => {
			asked.push(url);
			return new Promise<readonly ShaderVariants[]>((resolve, reject) =>
				pending.push(() => {
					const list = lists[url];
					if (list) resolve(list);
					else reject(new Error(`Failed to fetch dynamically imported module: ${url}`));
				}),
			);
		};
		const settle = async () => {
			for (const resolve of pending.splice(0)) resolve();
			for (let k = 0; k < 4; k++) await Promise.resolve();
		};
		return { asked, load, settle };
	}
	const shader = (): CustomShader => ({ variants: {}, files, locations: [], textures: 0 });

	it("downloads the device's file as soon as the material's shader arrives, and waits for it", async () => {
		const { asked, load, settle } = fileLoader({
			'draw-index.js': [{}, { webgl2_draw_index: GLSL(PERMUTATION_DRAW_INDEX) }],
		});
		const set = new DeviceShaderSet(start(), PERMUTATION_DRAW_INDEX, async () => ({}), load);
		const material = shader();
		set.custom(material, 'glsl');
		expect(asked).toEqual(['draw-index.js']);
		expect(set.ready(material.variants, PERMUTATION_DRAW_INDEX, 'glsl')).toBe(false);
		await settle();
		expect(set.ready(material.variants, PERMUTATION_DRAW_INDEX, 'glsl')).toBe(true);
		expect(Object.keys(material.variants)).toEqual(['webgl2_draw_index']);
		set.custom(material, 'glsl');
		expect(asked).toEqual(['draw-index.js']);
	});

	it('loads the file of other fixed bits when a pipeline asks for them, as bloom does', async () => {
		const { asked, load, settle } = fileLoader({
			'draw-index.js': [{}, {}],
			'tone-map.js': [
				{},
				{ webgl2_draw_index_tone_map: GLSL(PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP) },
			],
		});
		const set = new DeviceShaderSet(
			start(),
			PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP,
			async () => ({}),
			load,
		);
		const material = shader();
		set.custom(material, 'glsl');
		expect(set.ready(material.variants, PERMUTATION_DRAW_INDEX, 'glsl')).toBe(false);
		expect(asked).toEqual(['tone-map.js', 'draw-index.js']);
		await settle();
		expect(
			set.ready(material.variants, PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP, 'glsl'),
		).toBe(true);
		// Bits without a file have no build: the backend builds the pipeline and reports its error.
		expect(set.ready(material.variants, 0, 'glsl')).toBe(true);
		expect(set.ready(material.variants, 0, 'wgsl')).toBe(true);
	});

	it('fails with E1424 when the file does not download or does not list the material', async () => {
		const { load, settle } = fileLoader({ 'tone-map.js': [{}] });
		const set = new DeviceShaderSet(start(), PERMUTATION_DRAW_INDEX, async () => ({}), load);
		const material = shader();
		set.custom(material, 'glsl');
		expect(
			set.ready(material.variants, PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP, 'glsl'),
		).toBe(false);
		await settle();
		expect(() => set.ready(material.variants, PERMUTATION_DRAW_INDEX, 'glsl')).toThrow(
			'E1424: the shaders of a custom material from draw-index.js did not download: Failed to fetch dynamically imported module: draw-index.js.',
		);
		expect(() =>
			set.ready(material.variants, PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP, 'glsl'),
		).toThrow(
			'E1424: the shaders of a custom material from tone-map.js did not download: the file does not list the material at place 1, so it may come from another build.',
		);
	});
});
