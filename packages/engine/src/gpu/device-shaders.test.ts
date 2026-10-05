import { describe, expect, it } from 'bun:test';
import { PERMUTATION_TONE_MAP } from '../generated/gpu';
import type { DeviceShaders, ShaderVariants } from '../generated/shaders';
import { DeviceShaderSet } from './device-shaders';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DeviceShaderSet', () => {
	it('names the failed download when a pipeline needs the shaders of a module that failed to load', async () => {
		const loads: number[] = [];
		const set = new DeviceShaderSet({} as DeviceShaders, PERMUTATION_TONE_MAP, async (bits) => {
			loads.push(bits);
			throw new Error('404 Not Found');
		});
		const variants = {} as ShaderVariants;
		expect(set.ready(variants, 0, 'wgsl')).toBe(false);
		await settle();
		expect(() => set.ready(variants, 0, 'wgsl')).toThrow(
			'the engine could not download the shaders that a pipeline needs: 404 Not Found',
		);
		expect(loads).toEqual([0]);
	});
});
