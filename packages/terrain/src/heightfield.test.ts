import { describe, expect, test } from 'bun:test';
import { createHeightfield, Heightfield } from './heightfield';

describe('heightfield', () => {
	test('reads a function once per sample, and reports the range', () => {
		let calls = 0;
		const field = createHeightfield({
			size: 8,
			resolution: 3,
			height: (x, z) => {
				calls++;
				return x + z;
			},
		});
		expect(calls).toBe(9);
		expect(field.resolution).toBe(3);
		expect(field.size).toBe(8);
		// Samples sit at -4, 0 and 4 on each axis.
		expect(field.min).toBe(-8);
		expect(field.max).toBe(8);
	});

	test('interpolates between samples, and takes the edge outside', () => {
		const field = new Heightfield({
			size: 4,
			resolution: 3,
			height: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
		});
		// Samples: x of -2, 0, 2; z of -2, 0, 2; the value is row * 3 + col.
		expect(field.heightAt(-2, -2)).toBeCloseTo(0, 6);
		expect(field.heightAt(2, 2)).toBeCloseTo(8, 6);
		expect(field.heightAt(0, 0)).toBeCloseTo(4, 6);
		expect(field.heightAt(1, 1)).toBeCloseTo(6, 6);
		// Past the edge, the edge's height.
		expect(field.heightAt(-10, -10)).toBeCloseTo(0, 6);
		expect(field.heightAt(10, 10)).toBeCloseTo(8, 6);
	});

	test('a slope and a normal follow the ground', () => {
		const flat = createHeightfield({ size: 4, resolution: 5, height: () => 3 });
		expect(flat.slopeAt(0, 0)).toBeCloseTo(0, 6);
		const out = [0, 0, 0];
		flat.normalAt(0, 0, out);
		expect(out[0]).toBeCloseTo(0, 6);
		expect(out[1]).toBeCloseTo(1, 6);
		expect(out[2]).toBeCloseTo(0, 6);

		// A ramp that rises with x at 45 degrees.
		const ramp = createHeightfield({ size: 8, resolution: 9, height: (x) => x });
		expect(ramp.slopeAt(0, 0)).toBeCloseTo(1, 5);
		ramp.normalAt(0, 0, out);
		expect(out[0]).toBeCloseTo(-Math.SQRT1_2, 4);
		expect(out[1]).toBeCloseTo(Math.SQRT1_2, 4);
		expect(out[2]).toBeCloseTo(0, 6);
	});

	test('writes the normals as x and z, which rebuild y and agree with normalAt', () => {
		// A ramp that rises with x, so every normal leans the same way.
		const ramp = createHeightfield({ size: 8, resolution: 9, height: (x) => x });
		const data = new Uint8Array(4 * 4 * 4);
		ramp.writeNormalMap(4, data);
		const out = [0, 0, 0];
		for (let texel = 0; texel < 16; texel++) {
			ramp.normalAt(-4 + ((texel % 4) + 0.5) * 2, -4 + (Math.floor(texel / 4) + 0.5) * 2, out);
			expect(data[texel * 4]).toBe(Math.round(((out[0] as number) * 0.5 + 0.5) * 255));
			expect(data[texel * 4 + 1]).toBe(Math.round(((out[2] as number) * 0.5 + 0.5) * 255));
			// The encoded pair stays inside the circle that a unit y needs.
			const x = ((data[texel * 4] as number) / 255) * 2 - 1;
			const z = ((data[texel * 4 + 1] as number) / 255) * 2 - 1;
			expect(x * x + z * z).toBeLessThanOrEqual(1.001);
		}
		const flat = createHeightfield({ size: 4, resolution: 3, height: () => 2 });
		const level = new Uint8Array(2 * 2 * 4);
		flat.writeNormalMap(2, level);
		for (let texel = 0; texel < 4; texel++) {
			expect(level[texel * 4]).toBe(128);
			expect(level[texel * 4 + 1]).toBe(128);
		}
	});

	test('refuses a normal map of a size that does not fit', () => {
		const field = createHeightfield({ size: 4, resolution: 3, height: () => 0 });
		expect(() => field.writeNormalMap(0, new Uint8Array(0))).toThrow(/whole number/);
		expect(() => field.writeNormalMap(2, new Uint8Array(4))).toThrow(/need 16/);
	});

	test('refuses a size, a resolution or a height map that does not fit', () => {
		expect(() => createHeightfield({ size: 0, height: () => 0 })).toThrow(/positive/);
		expect(() => createHeightfield({ size: 1, resolution: 1, height: () => 0 })).toThrow(
			/whole number/,
		);
		expect(() =>
			createHeightfield({ size: 1, resolution: 3, height: new Float32Array(4) }),
		).toThrow(/needs 9/);
	});
});
