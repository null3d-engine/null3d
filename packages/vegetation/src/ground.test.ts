import { describe, expect, test } from 'bun:test';
import { groundMaps, maskValue } from './ground';

/** A ground that rises to the south, from -1 m to 1 m over the square. */
const southward = (x: number, z: number) => z * 0.5 + x * 0;

describe('the ground maps', () => {
	test('reads the slope of a ground that rises one in two', () => {
		const maps = groundMaps({ size: 40, height: southward });
		expect(maps.sampleAt(maps.slope, 0, 0)).toBeCloseTo(0.5, 6);
		expect(maps.sampleAt(maps.slope, 9, -7)).toBeCloseTo(0.5, 6);
	});

	test('faces the slope away from the higher ground', () => {
		// The ground rises toward +z, so it falls toward -z, which is north.
		const maps = groundMaps({ size: 40, height: southward });
		expect(maps.sampleAt(maps.northness, 5, 5)).toBeCloseTo(1, 6);
		expect(maps.sampleAt(maps.eastness, 5, 5)).toBeCloseTo(0, 6);
		expect(maps.sampleAt(maps.aspect, 5, 5)).toBeCloseTo(0, 4);
	});

	test('faces a slope that rises toward east the other way', () => {
		const maps = groundMaps({ size: 40, height: (x) => x * 0.3 });
		// The ground falls toward -x, which is west: eastness is -1 and the aspect is 270 degrees.
		expect(maps.sampleAt(maps.eastness, 0, 0)).toBeCloseTo(-1, 6);
		expect(maps.sampleAt(maps.aspect, 0, 0)).toBeCloseTo(270, 4);
	});

	test('leaves flat ground with no aspect at all', () => {
		const maps = groundMaps({ size: 20, height: () => 3 });
		expect(maps.sampleAt(maps.slope, 0, 0)).toBe(0);
		expect(maps.sampleAt(maps.northness, 0, 0)).toBe(0);
		expect(maps.sampleAt(maps.eastness, 0, 0)).toBe(0);
		for (const value of maps.slope) expect(value).toBe(0);
	});

	test('reads a slope from a terrain that supplies its own normals', () => {
		const length = Math.sqrt(1 + 0.5 * 0.5);
		const sampler = {
			heightAt: southward,
			normalAt: (_x: number, _z: number, out: Float32Array) => {
				out[0] = 0;
				out[1] = 1 / length;
				out[2] = -0.5 / length;
			},
		};
		const maps = groundMaps({ size: 40, height: sampler });
		expect(maps.sampleAt(maps.slope, 0, 0)).toBeCloseTo(0.5, 5);
		expect(maps.sampleAt(maps.northness, 0, 0)).toBeCloseTo(1, 6);
	});

	test('measures the distance from the water', () => {
		// The ground stands half a metre above the water for each metre east of x = 0.
		const maps = groundMaps({ size: 40, height: (x) => x * 0.5 });
		expect(maps.sampleAt(maps.distanceToWater, -5, 0)).toBe(0);
		expect(maps.sampleAt(maps.distanceToWater, 0, 0)).toBe(0);
		expect(maps.sampleAt(maps.distanceToWater, 10, 0)).toBeCloseTo(10, 3);
		expect(maps.sampleAt(maps.distanceToWater, 10, 5)).toBeCloseTo(10, 3);
	});

	test('pours the water into the hollows', () => {
		// A channel along z = 0 gathers the flow of both slopes, and a ridge sheds it.
		const maps = groundMaps({ size: 40, height: (_x, z) => Math.abs(z) * 0.5 });
		const inChannel = maps.sampleAt(maps.wetness, 0, 0);
		const onSlope = maps.sampleAt(maps.wetness, 0, 12);
		expect(inChannel).toBeGreaterThan(onSlope);
		expect(inChannel).toBeLessThanOrEqual(1);
		expect(onSlope).toBeGreaterThanOrEqual(0);
	});

	test('reads the hollows of the ground', () => {
		// A paraboloid holds water everywhere, and turned over it sheds it everywhere.
		const bowl = groundMaps({ size: 40, height: (x, z) => (x * x + z * z) * 0.05 });
		const mound = groundMaps({ size: 40, height: (x, z) => -(x * x + z * z) * 0.05 });
		expect(bowl.sampleAt(bowl.curvature, 0, 0)).toBeCloseTo(0.2, 4);
		expect(bowl.sampleAt(bowl.curvature, 15, 15)).toBeCloseTo(0.2, 4);
		expect(mound.sampleAt(mound.curvature, 0, 0)).toBeCloseTo(-0.2, 4);
	});

	test('covers the ground where the paths, the rocks and the caves are', () => {
		const maps = groundMaps({
			size: 40,
			height: () => 1,
			paths: [{ kind: 'line', ax: 0, az: -18, bx: 0, bz: 18, width: 6 }],
			rocks: [{ kind: 'circle', x: 10, z: 10, radius: 3 }],
			caves: (x, z) => (x < -12 && z > 12 ? 1 : 0),
		});
		expect(maps.sampleAt(maps.path, 0, 0)).toBe(1);
		expect(maps.sampleAt(maps.path, 5, 0)).toBe(0);
		expect(maps.sampleAt(maps.rock, 10, 10)).toBe(1);
		expect(maps.sampleAt(maps.rock, 0, 0)).toBe(0);
		expect(maps.sampleAt(maps.cave, -16, 16)).toBe(1);
		expect(maps.sampleAt(maps.cave, 16, 16)).toBe(0);
		expect(maps.sampleAt(maps.blocked, 10, 10)).toBe(1);
		expect(maps.sampleAt(maps.blocked, 0, 0)).toBe(1);
		expect(maps.sampleAt(maps.blocked, 16, -16)).toBe(0);
	});

	test('reads a mask without the maps', () => {
		expect(maskValue(undefined, 0, 0)).toBe(0);
		expect(maskValue([{ kind: 'circle', x: 2, z: 0, radius: 1 }], 2.5, 0)).toBe(1);
		expect(maskValue([{ kind: 'circle', x: 2, z: 0, radius: 1 }], 3.5, 0)).toBe(0);
		expect(maskValue((x) => x / 10, 15, 0)).toBe(1);
		expect(maskValue((x) => x / 10, 5, 0)).toBe(0.5);
	});

	test('refuses a square that cannot hold the maps', () => {
		expect(() => groundMaps({ size: 0, height: () => 0 })).toThrow(/not a positive number/);
		expect(() => groundMaps({ size: 10, resolution: 1, height: () => 0 })).toThrow(/resolution/);
	});
});
