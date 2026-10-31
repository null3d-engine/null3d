import { describe, expect, test } from 'bun:test';
import {
	PARTICLE_BIRTH_FLOATS,
	PARTICLE_FRAME_FLOATS,
	PARTICLE_PARAM_FLOATS,
} from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { linearColor } from './color';
import { CoreMemory } from './memory';
import { ParticleBuffer } from './particles';
import type { Mesh } from './scene';

/** Where the fake core keeps the records and the values. */
const RECORDS = 1024;
const VALUES = 65536;
/** Where the fake core keeps the block of births' parameters. */
const BLOCK = 98304;
/** Where the fake core keeps the emitter's block, and its sub-emitters' matrices. */
const EMITTER = 112_640;
const SUB_MATRICES = 120_000;

/** A particle buffer of `capacity` records over a fake core that logs its marks. */
function buffer(capacity: number, additive = true) {
	const marks: number[][] = [];
	const writes: number[][] = [];
	const shifts: number[][] = [];
	const configured: number[] = [];
	const blocks: number[] = [];
	const frames: number[] = [];
	const bursts: number[][] = [];
	const bounds: number[][] = [];
	let emitterFloats = 0;
	let core: CoreMemory;
	const glue = {
		particleRecords: () => RECORDS,
		particleValues: () => VALUES,
		markParticleRecords: (_: number, start: number, count: number) => marks.push([start, count]),
		markParticleValues: () => marks.push([-1]),
		particleRecordBlock: () => BLOCK,
		writeParticleRecords: (id: number, count: number, first: number) => {
			writes.push([id, count, first]);
			return 0;
		},
		shiftParticleRecords: (id: number, from: number, to: number, seconds: number) => {
			shifts.push([id, from, to, seconds]);
			return 0;
		},
		particleEmitterBlock: (_id: number, floats: number) => {
			emitterFloats = floats;
			blocks.push(floats);
			return EMITTER;
		},
		configureParticleEmitter: (id: number) => {
			configured.push(id);
			return 0;
		},
		particleSubMatrices: () => SUB_MATRICES,
		emitParticleFrame: (id: number) => {
			frames.push(id);
			// The core writes the births' box and the count that this frame made.
			const view = core.f64(EMITTER, emitterFloats);
			view[80] = -1;
			view[81] = -2;
			view[82] = -3;
			view[83] = 1;
			view[84] = 2;
			view[85] = 3;
			view[86] = 5;
			return 0;
		},
		burstParticles: (id: number, count: number) => {
			bursts.push([id, count]);
			return 0;
		},
		destroyParticles: () => 0,
	} as unknown as CoreGlue;
	const memory = new WebAssembly.Memory({ initial: 2 });
	core = new CoreMemory(glue, memory);
	const object = {
		scene: { particleBuffers: 1 },
		destroy: () => {},
		setBounds: (center: number[], radius: number) => bounds.push([...center, radius]),
	} as unknown as Mesh;
	const linear = (color: Parameters<typeof linearColor>[0]) => linearColor(color, 'test');
	const particles = new ParticleBuffer(core, 1, capacity, object, additive, linear);
	particles.reset({});
	const values = core.f32(VALUES, PARTICLE_PARAM_FLOATS + PARTICLE_FRAME_FLOATS);
	return {
		particles,
		marks,
		writes,
		shifts,
		configured,
		blocks,
		frames,
		bursts,
		bounds,
		values,
		core,
		memory,
		emitterFloats: () => emitterFloats,
	};
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

	test('a block of births is copied into the core and written in one call', () => {
		const { particles, marks, writes, core } = buffer(8);
		// A record written through the single-record path is marked before the block's range.
		particles.write(0, [0, 0, 0, 1, 0, 0, 0, 1], 1);
		const block = new Float32Array(PARTICLE_BIRTH_FLOATS * 2);
		block.set([1, 2, 3, 4.5, -1, 0.5, 0, 1.75, 0x1234], 0);
		block.set([0, 0, 0, 5, 0, 0, 0, 2, 7], PARTICLE_BIRTH_FLOATS);
		particles.writeRecords(block, 2, 3);
		expect(marks.filter((m) => m.length === 2)).toEqual([[0, 1]]);
		expect(writes).toEqual([[1, 2, 3]]);
		expect([...core.f32(BLOCK, block.length)]).toEqual([...block]);
	});

	test('a shift of birth times goes to the core in one call', () => {
		const { particles, shifts } = buffer(8);
		particles.shiftRecords(1, 3, 1000);
		expect(shifts).toEqual([[1, 1, 3, 1000]]);
	});

	test('a buffer makes its views again after the memory grows, over the new memory', () => {
		const { particles, core, memory } = buffer(8);
		particles.write(1, [0, 0, 0, 2.5, 0, 0, 0, 1], 3);
		const frame = particles.frame;
		memory.grow(1);
		expect(core.refresh()).toBe(true);
		// The old view's memory is gone; the buffer reads the same record through a new view.
		expect(frame.length).toBe(0);
		expect(particles.frame).not.toBe(frame);
		expect(particles.frame.buffer).toBe(memory.buffer);
		const out = new Float32Array(9);
		particles.read(1, out);
		expect(out[3]).toBe(2.5);
	});

	test('the core block is written again after the memory grows', () => {
		const { particles, writes, core, memory } = buffer(8);
		const block = new Float32Array(PARTICLE_BIRTH_FLOATS).fill(1);
		particles.writeRecords(block, 1, 0);
		memory.grow(1);
		expect(core.refresh()).toBe(true);
		particles.writeRecords(block, 1, 0);
		expect(writes.length).toBe(2);
		expect([...core.f32(BLOCK, block.length)]).toEqual([...block]);
	});

	test('a destroyed buffer holds no view of the memory and refuses to be read', () => {
		const { particles } = buffer(8);
		particles.write(0, [0, 0, 0, 1, 0, 0, 0, 1], 0);
		expect(particles.frame.length).toBeGreaterThan(0);
		particles.destroy();
		const views = particles as unknown as Record<
			'floats' | 'words' | 'block' | 'frameValues' | 'birthView',
			ArrayLike<number>
		>;
		for (const name of ['floats', 'words', 'block', 'frameValues', 'birthView'] as const)
			expect(views[name].length).toBe(0);
		expect(() => particles.frame).toThrow('destroyed');
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

describe('the emitter', () => {
	const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

	/** A buffer whose emitter has every kind of setting. */
	function configured(capacity = 8) {
		const parent = buffer(capacity);
		const child = buffer(16);
		parent.particles.configureEmitter({
			seed: 7,
			shape: { type: 'sphere', radius: 0.5, surface: true },
			direction: [0, 1, 0],
			spread: 0.25,
			speed: [2, 3],
			velocity: [0.1, 0.2, 0.3],
			lifetime: [1, 4],
			bursts: [
				{ time: 0.5, count: 3, interval: 1, cycles: 2 },
				{ time: 0, count: 0 },
			],
			duration: 9,
			loop: false,
			follow: true,
			subEmitters: [{ buffer: child.particles, on: 'ground', count: 4, inheritVelocity: 0.5 }],
		});
		return { ...parent, child };
	}

	test('the settings land where the core reads them, with the rows of bursts and sub-emitters', () => {
		const b = configured();
		const floats = b.emitterFloats();
		expect(floats).toBe(88 + (2 + 1) * 4 + 48);
		expect(b.blocks).toEqual([floats]);
		expect(b.configured).toEqual([1]);
		const block = b.core.f64(EMITTER, floats);
		expect([block[14], block[15]]).toEqual([2, 1]);
		// The bursts' rows: the first repeats, the second happens once.
		expect([...block.slice(88, 96)]).toEqual([0.5, 3, 1, 2, 0, 0, Number.NaN, Number.NaN]);
		// The sub-emitter's row: the child's id, ground, its count and the share it keeps.
		expect([...block.slice(96, 100)]).toEqual([1, 1, 4, 0.5]);
		// The fixed settings.
		const f = 100;
		expect([block[f], block[f + 1], block[f + 2], block[f + 3]]).toEqual([7, 1, 0.5, 1]);
		expect([block[f + 8], block[f + 9], block[f + 10], block[f + 11]]).toEqual([2, 3, 1, 4]);
		expect([block[f + 12], block[f + 13], block[f + 14], block[f + 15]]).toEqual([
			1, 0.1, 0.2, 0.3,
		]);
		// The direction's frame has the direction as its y axis.
		expect([...block.slice(f + 16, f + 25)]).toEqual([0, 0, 1, 0, 1, 0, 1, 0, 0]);
		expect([block[f + 25], block[f + 26], block[f + 27], block[f + 28]]).toEqual([0.25, 9, 0, 1]);
		// The motion's defaults follow the values.
		expect([block[f + 29], block[f + 32], block[f + 37], block[f + 38]]).toEqual([0, 0, 1, 1]);
		// The sub-emitters' matrices have a place of their own.
		expect(b.core.f64(SUB_MATRICES, 16).length).toBe(16);
	});

	test('a frame writes its span, rate, flags and matrices, and takes the births box from the core', () => {
		const b = configured();
		b.particles.setEmitterFollow(IDENTITY, IDENTITY, IDENTITY);
		b.particles.setEmitterEvents(IDENTITY, [IDENTITY]);
		b.particles.emitFrame(0.5, 1, 12, true, false);
		expect(b.frames).toEqual([1]);
		const block = b.core.f64(EMITTER, b.emitterFloats());
		expect([...block.slice(0, 6)]).toEqual([12, 1, 0.5, 1, 1, 0]);
		expect([...block.slice(16, 32)]).toEqual([...IDENTITY]);
		expect([...block.slice(64, 80)]).toEqual([...IDENTITY]);
		// The sphere holds the births' box, grown by how far a particle may move.
		const [x, y, z, radius] = b.bounds.at(-1) as number[];
		expect([x, y, z]).toEqual([0, 0, 0]);
		expect(radius).toBeGreaterThan(Math.sqrt(14));
		// The object keeps the sphere while the births stay inside it.
		expect(b.bounds.length).toBe(1);
		expect(b.particles.emitted).toBe(5);
	});

	test('a burst gives the core its count and the place and velocity in the block', () => {
		const b = configured();
		b.particles.emitBurst(5, [1, 2, 3], [0.5, 0, -0.5]);
		expect(b.bursts).toEqual([[1, 5]]);
		let block = b.core.f64(EMITTER, b.emitterFloats());
		expect([...block.slice(6, 14)]).toEqual([1, 1, 2, 3, 1, 0.5, 0, -0.5]);
		b.particles.emitBurst(2);
		block = b.core.f64(EMITTER, b.emitterFloats());
		expect([block[6], block[10]]).toEqual([0, 0]);
	});

	test('the emitter keeps its block after the memory grows', () => {
		const b = configured();
		b.particles.emitFrame(0, 0.5, 12, true, false);
		b.memory.grow(1);
		expect(b.core.refresh()).toBe(true);
		b.particles.emitFrame(0.5, 1, 9, false, true);
		// The block was asked for once, and the view was made again over the same place.
		expect(b.blocks.length).toBe(1);
		const block = b.core.f64(EMITTER, b.emitterFloats());
		expect([...block.slice(0, 6)]).toEqual([9, 0, 0.5, 1, 1, 1]);
		expect(b.frames).toEqual([1, 1]);
	});

	test("the frame's count is the emitted count, at most the capacity", () => {
		const b = configured(4);
		b.particles.emitFrame(0, 1, 12, true);
		// The fake core writes five emitted; the engine leaves the count to the core's frame values.
		expect(b.particles.emitted).toBe(5);
	});

	test("a destroyed buffer forgets the emitter's views", () => {
		const b = configured();
		b.particles.emitFrame(0, 1, 12, true);
		b.particles.destroy();
		const views = b.particles as unknown as Record<'emitterView' | 'subView', ArrayLike<number>>;
		expect(views.emitterView.length).toBe(0);
		expect(views.subView.length).toBe(0);
	});
});
