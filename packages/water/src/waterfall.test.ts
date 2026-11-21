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
	/** The draw order among blended objects that the add-on set, if any. */
	order?: number;
	values: Record<string, unknown>[];
	destroyed: boolean;
}

/** A sketch context that records the meshes, materials and particle buffers that the add-on makes. */
function fakeContext() {
	const buffers: BufferRecord[] = [];
	const destroyed: string[] = [];
	const shaders: { uniforms: Record<string, unknown> }[] = [];
	const meshes: { mesh: { uvs: Float32Array } }[] = [];
	const ctx = {
		time: { now: 0, dt: 1 / 60 },
		scene: {
			createMesh: (options: { mesh: { uvs: Float32Array } }) => {
				meshes.push(options);
				return { destroy: () => destroyed.push('mesh') };
			},
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
						setRenderOrder: (order: number) => {
							record.order = order;
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
		materials: {
			shader: (options: { uniforms: Record<string, unknown> }) => {
				shaders.push(options);
				return { destroy: () => destroyed.push('material') };
			},
		},
		textures: { fromData: () => ({ destroy() {} }) },
	};
	return { ctx: ctx as unknown as SketchContext, buffers, destroyed, shaders, meshes };
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

describe('a waterfall’s apron', () => {
	it('starts as far up the river as it is told, and fades in over that reach', async () => {
		const { shaders, meshes } = await fallWith({ apron: 3, spray: 0 });
		// The material fades the apron in over the seconds that the water takes to cross it.
		expect(shaders[0]?.uniforms.apron).toBeCloseTo(3 / (FALL.speed as number), 6);
		// The mesh's earliest water left the apron's upstream end that many seconds before the lip.
		const uvs = meshes[0]?.mesh.uvs as Float32Array;
		let earliest = 0;
		for (let k = 1; k < uvs.length; k += 2) earliest = Math.min(earliest, uvs[k] as number);
		expect(earliest).toBeCloseTo(-3 / (FALL.speed as number), 5);
	});
});

describe('a waterfall’s fade into a cloud', () => {
	it('vanishes below the height it is given, and never without one', async () => {
		const into = await fallWith({ fadeBelow: -9.5, spray: 0 });
		expect(into.shaders[0]?.uniforms.fadeBelow).toBe(-9.5);
		const open = await fallWith({ spray: 0 });
		expect(open.shaders[0]?.uniforms.fadeBelow as number).toBeLessThan(-1e6);
	});

	it('tells its material the lip’s direction across the water, to its right', async () => {
		const { shaders } = await fallWith({ direction: [0, -2], spray: 0 });
		const across = shaders[0]?.uniforms.across as number[];
		// Water running along -z has its right toward +x, as the column's mesh lays it out.
		expect(across[0]).toBeCloseTo(1, 9);
		expect(across[1]).toBe(0);
		expect(across[2]).toBeCloseTo(0, 9);
	});

	it('bursts into mist above the cloud, over the part of the drop that shows', async () => {
		// The lip stands at 1 m and the fall drops 16 m; the cloud's top is at -5 m.
		const cloud = -5;
		const into = await fallWith({ fadeBelow: cloud });
		const open = await fallWith({});
		const mistOf = (buffers: BufferRecord[]) =>
			((buffers[2] as BufferRecord).position as number[])[1] as number;
		expect(mistOf(into.buffers)).toBeGreaterThan(cloud);
		expect(mistOf(open.buffers)).toBeLessThan(cloud);
		// The plume gathers above the cloud too: the cloud draws first, so a puff inside it would
		// show over its tops as a pale disc.
		const plumeOf = (buffers: BufferRecord[]) =>
			((buffers[3] as BufferRecord).position as number[])[1] as number;
		expect(plumeOf(into.buffers)).toBeGreaterThan(cloud);
		expect(plumeOf(open.buffers)).toBeLessThan(cloud);
		// The material breaks the water up over the same shown part, down to a meter below the
		// cloud's top.
		expect(into.shaders[0]?.uniforms.drop).toBeCloseTo(1 - cloud + 1, 9);
		expect(open.shaders[0]?.uniforms.drop).toBe(16);
	});

	it('refuses a height that is not a number', async () => {
		await expect(fallWith({ fadeBelow: Number.NaN, spray: 0 })).rejects.toThrow(/fadeBelow/);
	});
});

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
			// The mist and the plume draw after the column, over its lower part, so the water
			// dissolves into them. The froth and the drops sort with it by distance.
			const wraps = place.kind === 'mist' || place.kind === 'plume';
			expect(record.order).toBe(wraps ? 1 : undefined);
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
