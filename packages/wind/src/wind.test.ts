import { describe, expect, test } from 'bun:test';
import { holdsField } from './wind';

describe('the device that holds the field', () => {
	test('every WebGPU path holds it', () => {
		expect(holdsField({ tier: 'webgpu', features: [] })).toBe(true);
		expect(holdsField({ tier: 'webgpu-compat', features: ['shader-f16'] })).toBe(true);
	});

	test('a WebGL2 device needs a float target', () => {
		expect(holdsField({ tier: 'webgl2', features: ['EXT_color_buffer_float'] })).toBe(true);
		expect(holdsField({ tier: 'webgl2', features: ['EXT_color_buffer_half_float'] })).toBe(true);
		// Without either, the pass cannot keep an image, so the add-on costs no pass there.
		expect(holdsField({ tier: 'webgl2', features: ['OES_texture_float_linear'] })).toBe(false);
		expect(holdsField({ tier: 'webgl2', features: [] })).toBe(false);
	});
});
