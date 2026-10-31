import { describe, expect, test } from 'bun:test';
import type {
	Mat4Like,
	Mesh,
	Object3D,
	ParticleBuffer,
	ParticleEmitterOptions,
	ParticleValues,
	SketchTime,
	Vec3Like,
} from '@null3d/engine';
import { ParticleSystem, type ParticleSystemOptions } from './system';

/** A particle buffer that logs the calls that the system makes into the core. */
function fakeBuffer(capacity = 64) {
	const state = {
		emitted: 0,
		configure: undefined as ParticleEmitterOptions | undefined,
		frames: [] as number[][],
		bursts: [] as number[][],
		sets: [] as ParticleValues[],
		follows: [] as Float64Array[],
		events: [] as { world: Float64Array; children: Float64Array[] }[],
		destroyed: false,
	};
	const buffer = {
		capacity,
		object: fakeObject() as unknown as Mesh,
		get emitted() {
			return state.emitted;
		},
		configureEmitter(options: ParticleEmitterOptions) {
			state.configure = options;
		},
		emitFrame(from: number, to: number, rate: number, emitting: boolean, prewarm: boolean) {
			state.frames.push([from, to, rate, emitting ? 1 : 0, prewarm ? 1 : 0]);
			state.emitted += 1;
		},
		emitBurst(count: number, at?: Vec3Like, velocity?: Vec3Like) {
			const row = [count];
			if (at) for (let k = 0; k < 3; k++) row.push(at[k] as number);
			if (velocity) for (let k = 0; k < 3; k++) row.push(velocity[k] as number);
			state.bursts.push(row);
		},
		set(values: ParticleValues) {
			state.sets.push(values);
		},
		setEmitterFollow(last: Mat4Like, now: Mat4Like, toLocal: Mat4Like) {
			state.follows.push(
				new Float64Array([
					...(last as Float64Array),
					...(now as Float64Array),
					...(toLocal as Float64Array),
				]),
			);
		},
		setEmitterEvents(world: Mat4Like, children: readonly Mat4Like[]) {
			state.events.push({
				world: new Float64Array(world as Float64Array),
				children: children.map((child) => new Float64Array(child as Float64Array)),
			});
		},
		destroy() {
			state.destroyed = true;
		},
	};
	return { buffer: buffer as unknown as ParticleBuffer, state };
}

/** A scene object whose world matrix is the identity and which sits at `place`. */
function fakeObject(place: readonly [number, number, number] = [0, 0, 0]) {
	const object = {
		getWorldMatrix: (out: Mat4Like) => {
			const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, place[0], place[1], place[2], 1];
			for (let k = 0; k < 16; k++) out[k] = m[k] as number;
		},
		getWorldPosition: (out: number[]) => {
			out[0] = place[0];
			out[1] = place[1];
			out[2] = place[2];
		},
	};
	return object as unknown as Object3D;
}

const clock = { now: 0, dt: 0.1, frame: 0 } as SketchTime;

function system(options: ParticleSystemOptions, capacity = 64) {
	const fake = fakeBuffer(capacity);
	const system = new ParticleSystem(fake.buffer, options, clock);
	return { ...fake, system };
}

describe('the emitter settings', () => {
	test('the options go to the core once, with the ranges resolved', () => {
		const follow = fakeObject([1, 2, 3]);
		const childBuffer = fakeBuffer(16).buffer;
		const child = { buffer: childBuffer, destroyed: false } as unknown as ParticleSystem;
		const s = system({
			rate: 7,
			speed: 2,
			lifetime: [1, 3],
			shape: { type: 'sphere', radius: 0.5, surface: true },
			direction: [0, 1, 0],
			spread: 0.2,
			velocity: [0.1, 0.2, 0.3],
			bursts: [{ time: 0.5, count: 4, interval: 1, cycles: 2 }],
			duration: 5,
			follow,
			seed: 9,
			subEmitters: [{ system: child, on: 'ground', count: 3, inheritVelocity: 0.5 }],
		});
		const options = s.state.configure as ParticleEmitterOptions;
		expect(options.seed).toBe(9);
		expect(options.speed).toEqual([2, 2]);
		expect(options.lifetime).toEqual([1, 3]);
		expect(options.shape).toEqual({ type: 'sphere', radius: 0.5, surface: true });
		expect(options.direction).toEqual([0, 1, 0]);
		expect(options.spread).toBe(0.2);
		expect(options.velocity).toEqual([0.1, 0.2, 0.3]);
		expect(options.duration).toBe(5);
		expect(options.loop).toBe(true);
		expect(options.follow).toBe(true);
		expect(options.bursts).toEqual([{ time: 0.5, count: 4, interval: 1, cycles: 2 }]);
		expect(options.subEmitters).toEqual([
			{ buffer: childBuffer, on: 'ground', count: 3, inheritVelocity: 0.5 },
		]);
	});

	test('the seed defaults to 1, and a system without a followed object says so', () => {
		const s = system({ rate: 1 });
		const options = s.state.configure as ParticleEmitterOptions;
		expect(options.seed).toBe(1);
		expect(options.follow).toBe(false);
		expect(options.lifetime).toEqual([1, 1]);
		expect(options.speed).toEqual([1, 1]);
	});
});

describe('update', () => {
	test('each frame gives the core its span, rate and emitting flag', () => {
		const s = system({ rate: 12 });
		s.system.update(0.5);
		s.system.update(0.25);
		expect(s.state.frames).toEqual([
			[0, 0.5, 12, 1, 0],
			[0.5, 0.75, 12, 1, 0],
		]);
		expect(s.system.time).toBe(0.75);
	});

	test('a stopped emitter still moves on, and gives the core no births', () => {
		const s = system({ rate: 12 });
		s.system.emitting = false;
		s.system.rate = 3;
		s.system.update(0.5);
		expect(s.state.frames).toEqual([[0, 0.5, 3, 0, 0]]);
	});

	test('a prewarmed system runs its first span at the longest lifetime', () => {
		const s = system({ rate: 4, lifetime: [1, 2], prewarm: true });
		s.system.update(0.25);
		expect(s.state.frames).toEqual([[2, 2.25, 4, 1, 1]]);
		expect(s.system.time).toBe(2.25);
		s.system.update(0.25);
		expect(s.state.frames[1]).toEqual([2.25, 2.5, 4, 1, 0]);
	});

	test('a system that emitted before its first update is not prewarmed', () => {
		const s = system({ rate: 4, lifetime: [1, 2], prewarm: true });
		s.state.emitted = 1;
		s.system.update(0.25);
		expect(s.state.frames[0]).toEqual([0, 0.25, 4, 1, 0]);
	});

	test('a negative step adds nothing to the system time', () => {
		const s = system({ rate: 4 });
		s.system.update(-1);
		expect(s.state.frames[0]).toEqual([0, 0, 4, 1, 0]);
	});
});

describe('the rest of the system', () => {
	test('burst gives the core the count, place and velocity', () => {
		const s = system({ rate: 0 });
		s.system.burst(5, [1, 2, 3], [0.5, 0, -0.5]);
		s.system.burst(2);
		expect(s.state.bursts).toEqual([[5, 1, 2, 3, 0.5, 0, -0.5], [2]]);
	});

	test('set changes the values through the buffer', () => {
		const s = system({ rate: 0 });
		const values = { drag: 2, gravity: [0, -9.8, 0] };
		s.system.set(values);
		expect(s.state.sets).toEqual([values]);
	});

	test('the object is the buffer object', () => {
		const s = system({ rate: 0 });
		expect(s.system.object).toBe(s.buffer.object);
	});

	test('a followed emitter gives the core its matrices every frame', () => {
		const s = system({ rate: 0, follow: fakeObject([1, 2, 3]) });
		s.system.update(0.1);
		s.system.update(0.1);
		expect(s.state.follows.length).toBe(2);
		// The inverse of the identity matrix is the identity.
		expect([...s.state.follows[0]!.slice(32, 48)]).toEqual([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
		]);
	});

	test('sub-emitters give the core their inverse world matrices', () => {
		const childBuffer = fakeBuffer(16).buffer;
		const child = {
			buffer: childBuffer,
			object: fakeObject([2, 0, 0]),
			destroyed: false,
		} as unknown as ParticleSystem;
		const s = system({ rate: 0, subEmitters: [{ system: child, on: 'death', count: 1 }] });
		s.system.update(0.1);
		expect(s.state.events.length).toBe(1);
		const { world, children } = s.state.events[0]!;
		expect([...world.slice(12, 15)]).toEqual([0, 0, 0]);
		expect([...children[0]!.slice(12, 15)]).toEqual([-2, 0, 0]);
	});

	test('a destroyed child gives the core the identity in place of its matrix', () => {
		const childBuffer = fakeBuffer(16).buffer;
		const child = {
			buffer: childBuffer,
			object: fakeObject([2, 0, 0]),
			destroyed: true,
		} as unknown as ParticleSystem;
		const s = system({ rate: 0, subEmitters: [{ system: child, on: 'death', count: 1 }] });
		s.system.update(0.1);
		expect([...s.state.events[0]!.children[0]!.slice(12, 15)]).toEqual([0, 0, 0]);
	});

	test('destroy marks the system and removes the buffer', () => {
		const s = system({ rate: 0 });
		s.system.destroy();
		expect(s.state.destroyed).toBe(true);
		expect((s.system as unknown as { destroyed: boolean }).destroyed).toBe(true);
	});
});
