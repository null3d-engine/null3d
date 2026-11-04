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

describe('heightfield raycast', () => {
	const hills = (x: number, z: number) => Math.sin(x / 9) * 6 + Math.cos(z / 13) * 4 + x * 0.05;
	const field = createHeightfield({ size: 100, resolution: 41, height: hills });

	/** The first distance at which a fine march along the ray falls under `heightAt`. */
	function marched(o: number[], d: number[], max: number): number {
		const step = 0.0005;
		for (let t = 0; t <= max; t += step) {
			const x = (o[0] as number) + (d[0] as number) * t;
			const z = (o[2] as number) + (d[2] as number) * t;
			if (Math.abs(x) > 50 || Math.abs(z) > 50) continue;
			if ((o[1] as number) + (d[1] as number) * t <= field.heightAt(x, z)) return t;
		}
		return -1;
	}

	const unit = (v: number[]) => {
		const length = Math.hypot(...v);
		return v.map((c) => c / length);
	};

	test('a ray straight down meets the ground at its height', () => {
		const flat = createHeightfield({ size: 10, resolution: 5, height: () => 2 });
		expect(flat.raycast(1, 12, -3, 0, -1, 0, 100)).toBeCloseTo(10, 9);
		expect(flat.raycast(1, 12, -3, 0, 1, 0, 100)).toBe(-1);
		// Short of the ground, the ray meets nothing.
		expect(flat.raycast(1, 12, -3, 0, -1, 0, 9)).toBe(-1);
	});

	test('a ray that starts under the ground meets it where it starts', () => {
		expect(field.raycast(0, -40, 0, 1, 0, 0, 100)).toBe(0);
	});

	test('a ray that never crosses the square meets nothing', () => {
		expect(field.raycast(80, -40, 0, 0, -1, 0, 100)).toBe(-1);
		const [dx, dy, dz] = unit([1, -0.1, 0]);
		expect(field.raycast(-200, 5, 70, dx as number, dy as number, dz as number, 1000)).toBe(-1);
	});

	test('slanted rays meet the ground where a fine march along them first falls under it', () => {
		let hits = 0;
		for (let k = 0; k < 40; k++) {
			const angle = k * 0.71;
			const origin = [Math.cos(angle) * 70, 20 + (k % 5) * 3, Math.sin(angle * 1.3) * 70];
			const target = [Math.sin(k) * 30, -2, Math.cos(k * 0.4) * 30];
			const d = unit(target.map((c, i) => c - (origin[i] as number)));
			const want = marched(origin, d, 200);
			const got = field.raycast(
				origin[0] as number,
				origin[1] as number,
				origin[2] as number,
				d[0] as number,
				d[1] as number,
				d[2] as number,
				200,
			);
			if (want < 0) expect(got).toBe(-1);
			else {
				expect(got).toBeGreaterThanOrEqual(want - 0.001);
				expect(got).toBeLessThanOrEqual(want + 0.001);
				hits++;
			}
		}
		expect(hits).toBeGreaterThan(30);
	});

	test('a grazing ray that dips between two samples finds the dip', () => {
		// A single raised sample: the ray passes over the low samples at each end of its cells.
		const heights = new Float32Array(9);
		heights[4] = 10;
		const peak = new Heightfield({ size: 4, resolution: 3, height: heights });
		// Level at 9, from one corner to the other: it crosses the peak's patch near the middle.
		const [dx, dy, dz] = unit([1, 0, 1]);
		const got = peak.raycast(-2, 9, -2, dx as number, dy as number, dz as number, 10);
		expect(got).toBeGreaterThan(0);
		const x = -2 + (dx as number) * got;
		expect(peak.heightAt(x, x)).toBeCloseTo(9, 4);
	});
});
