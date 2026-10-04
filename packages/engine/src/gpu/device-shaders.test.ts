import { describe, expect, it } from 'bun:test';
import { PERMUTATION_BLOOM, PERMUTATION_HALF, PERMUTATION_TONE_MAP } from '../generated/gpu';
import type { DeviceShaders, FirstUseShaders, ShaderVariant } from '../generated/shaders';
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

	it('lets a pipeline build, and report its error, once a module failed to load', async () => {
		const set = new DeviceShaderSet(start(), 0, () => Promise.reject(new Error('offline')));
		expect(set.ready(set.shaders.sprite, 0, 'wgsl')).toBe(false);
		await Promise.resolve();
		await Promise.resolve();
		expect(set.ready(set.shaders.sprite, 0, 'wgsl')).toBe(true);
	});
});
