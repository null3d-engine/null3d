import { describe, expect, it } from 'bun:test';
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
});
