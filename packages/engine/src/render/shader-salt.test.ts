import { describe, expect, it } from 'bun:test';
import type { DeviceShaders } from '../generated/shaders';
import { freshSalt, saltShaders } from './shader-salt';

const stage = (source: string) => ({ source, uniformBlocks: [], textures: [] });

/** Two shaders: one with both targets, and one with WGSL alone, as the culling pass has. */
const SHADERS = {
	lit: {
		plain: {
			permutation: 0,
			wgsl: { source: '@vertex fn vs() {}', pipelines: { main: { vertex: 'vs', fragment: 'fs' } } },
			glsl: {
				main: {
					vertex: stage('#version 300 es\nvoid main() {}'),
					fragment: stage('#version 300 es\nprecision highp float;\nvoid main() {}'),
				},
			},
		},
	},
	cull: { plain: { permutation: 0, wgsl: { source: 'fn cull() {}', pipelines: {} }, glsl: null } },
} as unknown as DeviceShaders;

describe('fresh shaders', () => {
	it('put the comment after the GLSL version line and before the WGSL', () => {
		const lit = saltShaders(SHADERS, 'fresh 1').lit.plain;
		expect(lit?.wgsl?.source).toBe('// fresh 1\n@vertex fn vs() {}');
		expect(lit?.glsl?.main.vertex.source).toBe('#version 300 es\n// fresh 1\nvoid main() {}');
		expect(lit?.glsl?.main.fragment.source).toBe(
			'#version 300 es\n// fresh 1\nprecision highp float;\nvoid main() {}',
		);
	});

	it('keep everything but the text, and leave the loaded shaders as they were', () => {
		const salted = saltShaders(SHADERS, 'fresh 2');
		expect(salted.cull.plain?.glsl).toBeNull();
		expect(salted.cull.plain?.wgsl?.source).toBe('// fresh 2\nfn cull() {}');
		expect(salted.lit.plain?.wgsl?.pipelines).toEqual(SHADERS.lit.plain?.wgsl?.pipelines);
		expect(SHADERS.lit.plain?.wgsl?.source).toBe('@vertex fn vs() {}');
	});

	it('give a new comment on each call', () => {
		expect(freshSalt()).not.toBe(freshSalt());
	});
});
