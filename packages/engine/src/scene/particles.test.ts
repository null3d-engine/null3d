import { describe, expect, test } from 'bun:test';
import { PARTICLE_FRAME_FLOATS, PARTICLE_PARAM_FLOATS } from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { linearColor } from './color';
import { CoreMemory } from './memory';
import { ParticleBuffer } from './particles';
import type { Mesh } from './scene';

/** Where the fake core keeps the records and the values. */
const RECORDS = 1024;
const VALUES = 65536;

/** A particle buffer of `capacity` records over a fake core that logs its marks. */
function buffer(capacity: number, additive = true) {
	const marks: number[][] = [];
	const glue = {
		particleRecords: () => RECORDS,
		particleValues: () => VALUES,
		markParticleRecords: (_: number, start: number, count: number) => marks.push([start, count]),
		markParticleValues: () => marks.push([-1]),
		destroyParticles: () => 0,
	} as unknown as CoreGlue;
	const core = new CoreMemory(glue, new WebAssembly.Memory({ initial: 2 }));
	const object = {} as Mesh;
	const linear = (color: Parameters<typeof linearColor>[0]) => linearColor(color, 'test');
	const particles = new ParticleBuffer(core, 1, capacity, object, additive, linear);
	particles.reset({});
	const values = core.f32(VALUES, PARTICLE_PARAM_FLOATS + PARTICLE_FRAME_FLOATS);
	return { particles, marks, values, core };
}

describe('particle buffers', () => {
	test('a record keeps its birth, velocity, lifetime and seed, and marks run together', () => {
		const { particles, marks } = buffer(8);
		particles.write(2, [1, 2, 3, 4.5, -1, 0.5, 0, 1.75], 0x1234);
		particles.write(3, [0, 0, 0, 5, 0, 0, 0, 2], 7);
		particles.write(6, [0, 0, 0, 6, 0, 0, 0, 0.5], 9);
		particles.commit();
		const out = new Float32Array(9);
		particles.read(2, out);
		expect([...out.slice(0, 7)]).toEqual([1, 2, 3, 4.5, -1, 0.5, 0]);
		expect(out[7]).toBeCloseTo(1.75, 3);
		expect(out[8]).toBe(0x1234);
		expect(marks.filter((m) => m.length === 2)).toEqual([
			[2, 2],
			[6, 1],
		]);
	});

	test('the frame values follow the values, where the core reads them', () => {
		const { particles, values } = buffer(8);
		particles.frame[0] = 3.5;
		particles.frame[1] = 8;
		expect(values[PARTICLE_PARAM_FLOATS]).toBe(3.5);
		expect(values[PARTICLE_PARAM_FLOATS + 1]).toBe(8);
	});

	test('values land where the shaders read them, with colors made linear and curves resampled', () => {
		const { particles, values } = buffer(8, false);
		particles.set({
			gravity: [0, -9.8, 0],
			drag: 2,
			groundHeight: 0.5,
			colors: ['#ff0000', [0, 0, 1]],
			alphaOverLife: [0, 1],
			sizeOverLife: [1, 3],
			facing: 'tumble',
			flipbook: { columns: 4, rows: 2, hold: true },
		});
		expect(values[1]).toBeCloseTo(-9.8, 5);
		expect(values[3]).toBe(2);
		// A ground height alone bounces particles.
		expect([values[10], values[11]]).toEqual([0.5, 2]);
		expect([...values.slice(32, 36)]).toEqual([1, 0, 0, 1]);
		expect([...values.slice(36, 40)]).toEqual([0, 0, 1, 1]);
		// Alpha runs from 0 to 1 over 16 steps, in the fourth channel of the color curve.
		expect(values[48 + 3]).toBe(0);
		expect(values[48 + 15 * 4 + 3]).toBe(1);
		expect(values[48 + 15 * 4]).toBe(1);
		expect(values[112]).toBe(1);
		expect(values[127]).toBe(3);
		expect(values[28]).toBe(3);
		expect([...values.slice(24, 27)]).toEqual([4, 2, 8]);
		// A flipbook that holds plays no frames, and blends none.
		expect([values[41], values[43]]).toEqual([0, 1]);
		// Normal blending: fog tints the particles rather than fading them.
		expect(values[42]).toBe(0);
	});
});
