import { describe, expect, test } from 'bun:test';
import type { Camera, SketchContext } from '@null3d/engine';
import { createWind, holdsField } from './wind';

/** A camera that stands at the world's origin. */
const camera = {
	getPosition(out: number[]): void {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
	},
} as unknown as Camera;

/**
 * A sketch's context around a clock, with the render and texture calls stubbed out. `passes`
 * counts the passes that the add-on adds, so a test can tell a device that keeps no grid.
 */
function context(
	tier = 'webgpu',
	features: string[] = [],
	passes?: { count: number },
): SketchContext {
	const pass = { enabled: true, live: true };
	return {
		time: { now: 1 },
		engine: { capabilities: { tier, features } },
		render: {
			addPass: () => {
				if (passes) passes.count++;
				return pass;
			},
			setPassUniforms: () => {},
			removePass: () => {},
		},
		textures: {
			fromPass: () => ({ destroy: () => {} }),
			fromData: () => ({ destroy: () => {} }),
		},
	} as unknown as SketchContext;
}

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

describe('the field that a reader samples', () => {
	test('a device without float targets keeps no grid and gives readers the steady field', () => {
		const passes = { count: 0 };
		const wind = createWind(context('webgl2', ['OES_texture_float_linear'], passes), {
			camera,
			grid: 8,
		});
		// No pass costs the device nothing, and a box of no width sends every sample to the steady
		// field that the sampling function works out, so a plant there still moves.
		expect(passes.count).toBe(0);
		expect(wind.field.size).toBe(0);
		expect(wind.field.air.base).toEqual([4, 0, 0.65, 0]);
	});

	test('a device that holds the field takes its box, and each reader reads the settings', () => {
		const passes = { count: 0 };
		const wind = createWind(context('webgpu', [], passes), { camera, box: 96, grid: 8 });
		expect(passes.count).toBe(1);
		expect(wind.field.size).toBe(96);
		// The reading follows the steady wind, so a reader that works out the far field keeps step.
		wind.setBase(9, 0.5);
		expect(wind.field.air.base[0]).toBe(9);
		expect(wind.field.air.base[1]).toBe(0.5);
	});
});

describe('the calls that a frame makes', () => {
	test('reuse the objects that they are given', () => {
		const wind = createWind(context(), { camera, grid: 8 });
		const out: [number, number, number] = [0, 0, 0];
		const place: [number, number] = [1, 2];
		for (let i = 0; i < 100; i++) {
			wind.setBase(4, 0.3 + i * 0.001);
			wind.gust(place, 2);
			wind.push(place, 1);
			// The caller's own array comes back, so a sample makes no result object.
			expect(wind.sample(i * 0.5, 1, i * 0.25, out)).toBe(out);
			wind.update();
		}
		expect(out.some((value) => value !== 0)).toBe(true);
		// The box follows the camera: the stub stands at the origin, and the box is 128 wide.
		expect(wind.field.origin).toEqual([-64, -64]);
		// The field itself reads the noise through a hash that makes no tuple and no closure, so a
		// sample allocates nothing. The bytes per frame are the allocation gate's measure, which
		// D-265 names as owed.
	});

	test('a frozen field gives the same air at two times, and a live one does not', () => {
		const frozen = context();
		const still = createWind(frozen, {
			camera,
			grid: 8,
			air: { gustStrength: 0, swirl: 0 },
		});
		const first: [number, number, number] = [0, 0, 0];
		const later: [number, number, number] = [0, 0, 0];
		still.sample(3, 4, -2, first);
		(frozen.time as { now: number }).now = 2;
		still.sample(3, 4, -2, later);
		expect(later).toEqual(first);

		const live = context();
		const blowing = createWind(live, { camera, grid: 8 });
		blowing.sample(3, 4, -2, first);
		(live.time as { now: number }).now = 2;
		blowing.sample(3, 4, -2, later);
		expect(later).not.toEqual(first);
	});
});
