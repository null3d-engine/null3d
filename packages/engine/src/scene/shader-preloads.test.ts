import { describe, expect, it } from 'bun:test';
import { GENERATORS_PRELOAD } from '../shared/images';
import { ShaderPreloads } from './shader-preloads';

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
});
