// A waterfall's spray and mist, as `createWaterfall` makes them: three particle systems placed and
// turned as the fall's emitters say, whose births `setSpray` scales and whose light `setLight`
// sets, and none at all for a fall with no spray. The context is a stand-in that records what the
// add-on asked the engine for, so the test needs no GPU.
import { describe, expect, it } from 'bun:test';
import type { SketchContext } from '@null3d/engine';
import { type FallSheet, fallEmitters } from './fall';
import { createWaterfall, type WaterfallOptions } from './waterfall';

/** What one stand-in particle buffer was told. */
interface BufferRecord {
	/** The births a second that the last frame asked for. */
	rate?: number;
	position?: number[];
	rotation?: number[];
	values: Record<string, unknown>[];
	destroyed: boolean;
}

/** A sketch context that records the meshes, materials and particle buffers that the add-on makes. */
function fakeContext() {
	const buffers: BufferRecord[] = [];
	const destroyed: string[] = [];
	const ctx = {
		time: { now: 0, dt: 1 / 60 },
		scene: {
			createMesh: () => ({ destroy: () => destroyed.push('mesh') }),
			createParticleBuffer: async () => {
				const record: BufferRecord = { values: [], destroyed: false };
				buffers.push(record);
				return {
					emitted: 0,
					object: {
						setPosition: (...xyz: number[]) => {
							record.position = xyz;
						},
						setRotation: (...xyzw: number[]) => {
							record.rotation = xyzw;
						},
						setParent() {},
					},
					configureEmitter() {},
					set: (values: Record<string, unknown>) => record.values.push(values),
					emitFrame: (frame: Float64Array) => {
						record.rate = frame[2];
					},
					destroy: () => {
						record.destroyed = true;
					},
				};
			},
		},
		geometry: { fromArrays: (arrays: unknown) => arrays },
		materials: { shader: () => ({ destroy: () => destroyed.push('material') }) },
		textures: { fromData: () => ({ destroy() {} }) },
	};
	return { ctx: ctx as unknown as SketchContext, buffers, destroyed };
}

/** A creek 5 m wide that falls 16 m off a lip at (2, 3), running along +x. */
const FALL: WaterfallOptions = {
	lip: [2, 3],
	direction: [1, 0],
	halfWidth: 2.5,
	level: 1,
	speed: 2,
	drop: 16,
	spread: 0.3,
};
const SHEET: FallSheet = { ...FALL, level: 1, speed: 2, spread: 0.3 } as FallSheet;

/** A fall made in a stand-in context, with the context's records. */
async function fallWith(options: Partial<WaterfallOptions> = {}) {
	const context = fakeContext();
	const fall = await createWaterfall(context.ctx, { ...FALL, ...options });
	return { ...context, fall };
}

describe('a waterfall’s particle systems', () => {
	it('makes the froth, the mist and the plume where the fall’s emitters stand, turned with the lip', async () => {
		const { buffers, fall } = await fallWith();
		const places = fallEmitters(SHEET);
		expect(buffers).toHaveLength(places.length);
		for (let k = 0; k < places.length; k++) {
			const place = places[k] as (typeof places)[number];
			const record = buffers[k] as BufferRecord;
			expect(record.position).toEqual([...place.position]);
			// Water that runs along +x: a quarter turn about the vertical axis, which takes the
			// emitter's +z, out from the cliff, to +x. The opposite turn would throw the froth back
			// over the river.
			const rotation = record.rotation as number[];
			expect(rotation[0]).toBe(0);
			expect(rotation[1] as number).toBeCloseTo(Math.SQRT1_2, 6);
			expect(rotation[2]).toBe(0);
			expect(rotation[3] as number).toBeCloseTo(Math.SQRT1_2, 6);
		}
		fall.destroy();
	});

	it('scales every system’s births with setSpray, and refuses an amount out of range', async () => {
		const { buffers, fall } = await fallWith({ spray: 0.5 });
		const places = fallEmitters(SHEET);
		// Each frame tells a system's buffer the births it asks for, which the stand-in keeps.
		const rates = () => {
			fall.update();
			return buffers.map((record) => record.rate as number);
		};
		const own = places.map((place) => place.rate);
		const expectRates = (amount: number) => {
			const now = rates();
			for (let k = 0; k < own.length; k++)
				expect(now[k] as number).toBeCloseTo((own[k] as number) * amount, 9);
		};
		expectRates(0.5);
		fall.setSpray(2);
		expectRates(2);
		fall.setSpray(0);
		expectRates(0);
		expect(() => fall.setSpray(3.5)).toThrow(/spray must be from 0 to 3, and it is 3.5/);
		expect(() => fall.setSpray(-1)).toThrow(/spray must be from 0 to 3/);
		expectRates(0);
		fall.destroy();
	});

	it('gives every system the light that setLight names', async () => {
		const { buffers, fall } = await fallWith();
		fall.setLight([0.2, 0.3, 0.4]);
		for (const record of buffers) {
			const last = record.values.at(-1) as { colorOverLife: number[][] };
			expect(last.colorOverLife).toEqual([
				[0.2, 0.3, 0.4],
				[0.2, 0.3, 0.4],
			]);
		}
		fall.destroy();
	});

	it('makes no particle system for a fall with no spray', async () => {
		const { buffers, fall } = await fallWith({ spray: 0 });
		expect(buffers).toHaveLength(0);
		// Nothing to raise, and nothing fails.
		fall.setSpray(1);
		fall.setLight([1, 1, 1]);
		fall.destroy();
	});

	it('removes its systems, its sheet and its material', async () => {
		const { buffers, destroyed, fall } = await fallWith();
		fall.destroy();
		expect(buffers.every((record) => record.destroyed)).toBe(true);
		expect(destroyed.sort()).toEqual(['material', 'mesh']);
	});
});
