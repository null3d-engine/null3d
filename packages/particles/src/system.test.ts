import { describe, expect, test } from 'bun:test';
import type { Mat4Like, ParticleBuffer, ParticleValues, SketchTime } from '@null3d/engine';
import {
	AGE,
	FLIGHT_FLOATS,
	GROUND_BOUNCE,
	GROUND_KILL,
	HIT,
	impact,
	type MotionValues,
	PARTICLE_FLOATS,
	particleState,
	reach,
	SEED,
	simplex3,
	stateAt,
	T,
} from './motion';
import { ParticleSystem, type ParticleSystemOptions } from './system';

/** A particle buffer that keeps its records in plain arrays, with an object at the origin. */
function fakeBuffer(capacity: number) {
	const records: number[][] = [];
	const frames: [number, number][] = [];
	/** Each frame's values, and the records written in each frame. */
	const commits: { frame: number[]; writes: number }[] = [];
	let writes = 0;
	const frame = new Float32Array(4);
	const bounds: number[][] = [];
	const values: ParticleValues[] = [];
	const identity = (out: Mat4Like) => {
		for (let k = 0; k < 16; k++) out[k] = k % 5 === 0 ? 1 : 0;
	};
	const buffer = {
		capacity,
		object: {
			getWorldMatrix: identity,
			setBounds: (center: number[], radius: number) => bounds.push([...center, radius]),
		},
		write: (index: number, record: ArrayLike<number>, seed: number) => {
			records[index] = [...Array.from(record), seed];
			writes++;
		},
		read: (index: number, out: Float32Array) => out.set(records[index] ?? []),
		frame,
		commit: () => {
			frames.push([frame[0] as number, frame[1] as number]);
			commits.push({ frame: Array.from(frame), writes });
			writes = 0;
		},
		set: (v: ParticleValues) => values.push(v),
		destroy: () => {},
	};
	return { buffer: buffer as unknown as ParticleBuffer, records, frames, commits, bounds };
}

function system(options: ParticleSystemOptions, capacity = 64) {
	const fake = fakeBuffer(capacity);
	const clock = { now: 0, dt: 0, frame: 0 } as SketchTime;
	return { ...fake, system: new ParticleSystem(fake.buffer, options, clock) };
}

describe('emission', () => {
	test('a rate emits evenly spaced births, whatever the frame steps', () => {
		const a = system({ rate: 10, lifetime: 2 });
		for (let k = 0; k < 60; k++) a.system.update(1 / 60);
		const b = system({ rate: 10, lifetime: 2 });
		for (let k = 0; k < 4; k++) b.system.update(0.25);
		expect(a.records.length).toBe(10);
		expect(b.records.length).toBe(10);
		for (let i = 0; i < 10; i++) {
			expect(a.records[i]?.[3]).toBeCloseTo((i + 1) / 10, 5);
			expect(b.records[i]).toEqual(a.records[i] as number[]);
		}
		expect(a.frames.at(-1)?.[1]).toBe(10);
	});

	test('bursts fire once at their time, and again at each interval', () => {
		const s = system({
			bursts: [
				{ time: 0, count: 5 },
				{ time: 0.5, count: 2, interval: 1, cycles: 3 },
			],
		});
		for (let k = 0; k < 40; k++) s.system.update(0.1);
		// 5 at the start, then 2 at 0.5, 1.5 and 2.5 seconds.
		expect(s.records.length).toBe(11);
		expect(s.records[5]?.[3]).toBeCloseTo(0.5, 5);
		expect(s.records[10]?.[3]).toBeCloseTo(2.5, 5);
	});

	test('a system past its capacity reuses the oldest places', () => {
		const s = system({ rate: 100, lifetime: 1 }, 16);
		for (let k = 0; k < 10; k++) s.system.update(0.1);
		expect(s.records.length).toBe(16);
		expect(s.frames.at(-1)?.[1]).toBe(16);
	});

	test('a cone emits within its angle, and a sphere outward from its center', () => {
		const cone = system(
			{ rate: 200, shape: { type: 'cone', radius: 0.5, angle: 0.3 }, speed: 2 },
			256,
		);
		cone.system.update(1);
		for (const r of cone.records) {
			const [x, , z, , vx, vy, vz] = r as number[];
			expect(Math.hypot(x as number, z as number)).toBeLessThanOrEqual(0.5 + 1e-9);
			expect(
				Math.acos((vy as number) / Math.hypot(vx as number, vy as number, vz as number)),
			).toBeLessThanOrEqual(0.3 + 1e-6);
		}
		const ball = system(
			{ rate: 200, shape: { type: 'sphere', radius: 1, surface: true }, speed: 1 },
			256,
		);
		ball.system.update(1);
		for (const r of ball.records) {
			const [x, y, z, , vx, vy, vz] = r as number[];
			expect(Math.hypot(x as number, y as number, z as number)).toBeCloseTo(1, 6);
			expect(
				(x as number) * (vx as number) +
					(y as number) * (vy as number) +
					(z as number) * (vz as number),
			).toBeCloseTo(1, 6);
		}
	});

	test('a direction with no spread sends every particle that way', () => {
		const s = system({ rate: 10, direction: [1, 0, 0], speed: 3 });
		s.system.update(1);
		for (const r of s.records) {
			expect(r[4]).toBeCloseTo(3, 9);
			expect(r[5]).toBeCloseTo(0, 9);
		}
	});

	test('the culling bounds hold the births and how far particles reach', () => {
		const s = system({ rate: 10, speed: 2, lifetime: 1, gravity: [0, -10, 0] });
		s.system.update(0.5);
		const [, , , radius] = s.bounds.at(-1) as number[];
		expect(radius).toBeGreaterThanOrEqual(2 + 5);
	});
});

describe('sub-emitters', () => {
	test('a particle that dies bursts its sub-emitter where it died', () => {
		const child = system({ lifetime: 1 }, 64);
		const parent = system({
			bursts: [{ time: 0, count: 1 }],
			speed: 4,
			lifetime: 0.5,
			subEmitters: [{ system: child.system, on: 'death', count: 8 }],
		});
		for (let k = 0; k < 6; k++) parent.system.update(0.1);
		expect(child.records.length).toBe(8);
		// Straight up at 4 m/s for half a second, with no gravity.
		expect(child.records[0]?.[1]).toBeCloseTo(2, 5);
	});

	test('a particle that meets the ground bursts there', () => {
		const child = system({ lifetime: 1 }, 64);
		const parent = system({
			bursts: [{ time: 0, count: 1 }],
			direction: [0, -1, 0],
			speed: 1,
			lifetime: 5,
			groundHeight: -1,
			subEmitters: [{ system: child.system, on: 'ground', count: 3 }],
		});
		for (let k = 0; k < 20; k++) parent.system.update(0.1);
		expect(child.records.length).toBe(3);
		expect(child.records[0]?.[1]).toBeCloseTo(-1, 2);
	});
	test('the table of pending events starts small and grows to hold every particle', () => {
		const child = system({ lifetime: 1 }, 2048);
		const parent = system(
			{
				bursts: [{ time: 0, count: 1000 }],
				lifetime: 0.5,
				subEmitters: [{ system: child.system, on: 'death', count: 1 }],
			},
			1000,
		);
		const table = () => (parent.system as unknown as { events: Float64Array }).events.length;
		const first = table();
		expect(first).toBeLessThan(1000 * 10);
		for (let k = 0; k < 6; k++) parent.system.update(0.1);
		expect(table()).toBeGreaterThan(first);
		expect(child.records.length).toBe(1000);
	});
});

describe('long runs', () => {
	/** A particle's age as the GPU works it out from a record and the frame's values. */
	function gpuAge(frame: number[], record: number[], index: number): number {
		const shift = index >= (frame[2] as number) ? (frame[3] as number) : 0;
		return Math.fround(frame[0] as number) - Math.fround((record[3] as number) - shift);
	}

	test('the time base moves over many frames, and every particle keeps its age meanwhile', () => {
		const capacity = 40_000;
		const rate = 40;
		const s = system({ rate, lifetime: [8, 10] }, capacity);
		const emitted = () => (s.system as unknown as { emitted: number }).emitted;
		// The particle that a record holds is the newest of its places in the ring; the rate's
		// stream gives particle n its birth at (n + 1) / rate seconds.
		const age = (i: number) => {
			const n = i + capacity * Math.floor((emitted() - 1 - i) / capacity);
			return s.system.time - (n + 1) / rate;
		};
		let moving = 0;
		let rewrote = 0;
		for (let k = 0; k < 2400; k++) {
			const born = emitted();
			s.system.update(0.5);
			const { frame, writes } = s.commits.at(-1) as { frame: number[]; writes: number };
			const shifting = (frame[3] as number) !== 0;
			if (shifting) moving++;
			// The writes of a frame are its births and the records the move rewrites.
			const rewrites = writes - (emitted() - born);
			expect(rewrites).toBeLessThanOrEqual(16_384);
			if (rewrites > 0) rewrote++;
			if (rewrites > 0 || shifting || k % 100 === 0)
				for (let i = 0; i < s.records.length; i += 97)
					expect(gpuAge(frame, s.records[i] as number[], i)).toBeCloseTo(age(i), 2);
		}
		// 1,200 seconds pass one move. It rewrites 40,000 records over three updates; the last of
		// them has finished by the time its values are written, so two updates tell the shader
		// which records still count from the old base.
		expect(rewrote).toBe(3);
		expect(moving).toBe(2);
		const last = s.commits.at(-1)?.frame as number[];
		expect(last[3]).toBe(0);
		expect(last[0] as number).toBeLessThan(1024);
	});
});

describe('motion', () => {
	const still: MotionValues = {
		gx: 0,
		gy: -9.8,
		gz: 0,
		drag: 0,
		wx: 0,
		wy: 0,
		wz: 0,
		turbulence: 0,
		turbulenceScale: 1,
		turbulenceSpeed: 1,
		groundHeight: 0,
		groundMode: 0,
		restitution: 0.5,
		friction: 0,
	};

	/** A particle's numbers: born at (x, y, z) with the velocity (vx, vy, vz), at `age`. */
	const particle = (
		x: number,
		y: number,
		z: number,
		vx: number,
		vy: number,
		vz: number,
		age: number,
	) => {
		const p = new Float64Array(PARTICLE_FLOATS);
		p.set([x, y, z, vx, vy, vz]);
		p[AGE] = age;
		p[SEED] = 1;
		return p;
	};

	test('drag eases the velocity toward the wind', () => {
		const m = { ...still, gy: 0, drag: 2, wx: 3 };
		const s = particleState();
		stateAt(m, particle(0, 0, 0, 0, 0, 0, 10), s);
		expect(s.vx).toBeCloseTo(3, 6);
	});

	test('the ground stops, bounces and ends particles where the GPU does', () => {
		const m = { ...still, groundMode: GROUND_BOUNCE };
		const io = new Float64Array(FLIGHT_FLOATS);
		io.set([0, 1, 0, 0, 0, 0]);
		io[T] = 5;
		impact(m, io);
		const hit = io[HIT] as number;
		expect(hit).toBeCloseTo(Math.sqrt(2 / 9.8), 3);
		const s = particleState();
		stateAt(m, particle(0, 1, 0, 0, 0, 0, hit + 1e-3), s);
		expect(s.vy).toBeGreaterThan(0);
		stateAt({ ...m, groundMode: GROUND_KILL }, particle(0, 1, 0, 0, 0, 0, hit + 1e-3), s);
		expect(s.alive).toBe(false);
	});

	test('simplex noise stays within about -1 to 1 and is 0 at lattice points', () => {
		const io = new Float64Array(4);
		simplex3(io);
		expect(io[3]).toBe(0);
		let most = 0;
		for (let k = 0; k < 2000; k++) {
			io.set([k * 0.137, k * 0.071, k * 0.293]);
			simplex3(io);
			most = Math.max(most, Math.abs(io[3] as number));
		}
		expect(most).toBeLessThan(1.1);
		expect(most).toBeGreaterThan(0.3);
	});

	test('the reach bounds the motion', () => {
		const m = { ...still, drag: 0.5, wx: 2 };
		const s = particleState();
		const r = reach(m, 3, 2);
		for (let k = 0; k <= 20; k++) {
			stateAt(m, particle(0, 0, 0, 3, 0, 0, k / 10), s);
			expect(Math.hypot(s.px, s.py, s.pz)).toBeLessThanOrEqual(r);
		}
	});
});
