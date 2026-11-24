import { describe, expect, it } from 'bun:test';
import { FORMAT_CANVAS, FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import { GENERATORS_PRELOAD } from '../shared/images';
import { type PassFacts, passFeatures, ShaderPreloads } from './shader-preloads';

/** A desktop's facts at High on WebGPU: occlusion culling on, HDR color, the bounce light's rays. */
const HIGH: PassFacts = {
	tier: 'webgpu',
	device: { gpuOcclusion: true, directDraws: false, sceneColor: FORMAT_RGBA16_FLOAT },
	settings: () => ({ bounceRays: 4, cloudSteps: 32 }),
};

describe('ShaderPreloads', () => {
	it('asks the thread that draws for each feature once', () => {
		const sent: (readonly string[])[] = [];
		const preloads = new ShaderPreloads((features) => sent.push(features));
		preloads.need('skinning');
		preloads.need('skinning');
		preloads.needAll(['bloom', 'skinning', 'lines']);
		expect(sent).toEqual([['skinning'], ['bloom'], ['lines']]);
	});

	it("asks for the environment generator's code once, under its reserved name", () => {
		const sent: (readonly string[])[] = [];
		const preloads = new ShaderPreloads((features) => sent.push(features));
		preloads.needGenerators();
		preloads.needGenerators();
		expect(sent).toEqual([[GENERATORS_PRELOAD]]);
	});

	it('asks for the files that a recorded list names, and leaves out a name it does not know', () => {
		const sent: (readonly string[])[] = [];
		const preloads = new ShaderPreloads((features) => sent.push(features));
		preloads.needListed(['skinning', 'cutout', 'not-a-feature', 'skinning']);
		expect(sent).toEqual([['skinning'], ['cutout']]);
	});

	it("holds a listed feature back while the page's settings cannot use it, and asks once they can", () => {
		const sent: (readonly string[])[] = [];
		const preloads = new ShaderPreloads((features) => sent.push(features));
		preloads.setUsable('coverage', false);
		preloads.setUsable('lod_fade', false);
		preloads.needListed(['cutout', 'coverage', 'lod_fade']);
		expect(sent).toEqual([['cutout']]);
		preloads.setUsable('lod_fade', true);
		expect(sent).toEqual([['cutout'], ['lod_fade']]);
		preloads.setUsable('lod_fade', true);
		preloads.needListed(['lod_fade']);
		expect(sent).toEqual([['cutout'], ['lod_fade']]);
	});

	it('still asks for an unusable feature that the engine itself needs', () => {
		const sent: (readonly string[])[] = [];
		const preloads = new ShaderPreloads((features) => sent.push(features));
		preloads.setUsable('coverage', false);
		preloads.need('coverage');
		expect(sent).toEqual([['coverage']]);
	});

	it('asks for nothing when a feature that no list named turns usable', () => {
		const sent: (readonly string[])[] = [];
		const preloads = new ShaderPreloads((features) => sent.push(features));
		preloads.setUsable('coverage', false);
		preloads.setUsable('coverage', true);
		expect(sent).toEqual([]);
	});

	it('names occlusion culling where the GPU culls the buckets with it, on WebGPU only', () => {
		const off = { bounceRays: 0, cloudSteps: 0 } as const;
		const facts = { ...HIGH, settings: () => off };
		expect(passFeatures(facts)).toEqual(['occlusion']);
		expect(passFeatures({ ...facts, device: { ...HIGH.device, directDraws: true } })).toEqual([]);
		expect(passFeatures({ ...facts, device: { ...HIGH.device, gpuOcclusion: false } })).toEqual([]);
		expect(passFeatures({ ...facts, tier: 'webgl2' })).toEqual([]);
	});

	it("names the bounce light's steps and color copy where the settings draw it on the HDR path", () => {
		expect(passFeatures({ ...HIGH, tier: 'webgl2' })).toEqual(['ao', 'color_copy']);
		expect(
			passFeatures({
				...HIGH,
				tier: 'webgl2',
				device: { ...HIGH.device, sceneColor: FORMAT_CANVAS },
			}),
		).toEqual([]);
		expect(passFeatures(HIGH)).toEqual(['occlusion', 'ao', 'color_copy']);
	});

	it('asks for the passes of an opaque object as the settings stand when it asks', () => {
		const sent: (readonly string[])[] = [];
		const preloads = new ShaderPreloads((features) => sent.push(features));
		// Without the runner's facts it knows no passes.
		preloads.needPasses();
		expect(sent).toEqual([]);
		let rays: 0 | 4 = 0;
		preloads.setPassFacts({ ...HIGH, settings: () => ({ bounceRays: rays, cloudSteps: 0 }) });
		preloads.needPasses();
		expect(sent).toEqual([['occlusion']]);
		rays = 4;
		preloads.needPasses();
		preloads.needPasses();
		expect(sent).toEqual([['occlusion'], ['ao'], ['color_copy']]);
	});

	it("asks for the cloud tier's file for a sky with clouds where the settings march the tier", () => {
		const sent: (readonly string[])[] = [];
		const preloads = new ShaderPreloads((features) => sent.push(features));
		let steps = 0;
		preloads.setPassFacts({ ...HIGH, settings: () => ({ bounceRays: 0, cloudSteps: steps }) });
		preloads.needClouds(0.4);
		steps = 32;
		preloads.needClouds(0);
		expect(sent).toEqual([]);
		preloads.needClouds(0.4);
		expect(sent).toEqual([['clouds']]);
	});
});
