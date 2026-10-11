// Particle systems: an emitter that fills one of the engine's particle buffers. The emitter runs on
// the sketch's thread in `update(dt)`, once per frame. It works out which particles are born in the
// frame, at even times between the frame before and this one, writes each one's record once, and
// gives the buffer the frame's time. The GPU does the rest: each particle moves, turns, changes
// color and dies in closed form, so a system of a million particles costs the CPU only its births.

import type {
	Mat4Like,
	Mesh,
	Object3D,
	ParticleBuffer,
	ParticleBufferOptions,
	ParticleValues,
	Scene,
	Vec3Like,
} from '@null3d/engine';
import { mat4 } from '@null3d/engine';
import {
	GROUND_KILL,
	GROUND_NONE,
	impact,
	type MotionValues,
	particleState,
	reach,
	stateAt,
} from './motion';
import { between, chance, pcg } from './random';

/**
 * A number, or the smallest and the largest of a random number.
 *
 * @category api/particles
 */
export type ParticleRange = number | readonly [number, number];

/**
 * Where an emitter's particles are born, in its own space, and which way they set off. A `point`
 * emits at the emitter, along `direction`. A `sphere` emits inside a ball of `radius`, or on its
 * surface with `surface`, and sends particles outward. A `cone` emits on a disc of `radius` across
 * the emitter's +y axis. It sends particles up within `angle` radians of that axis, as a fountain
 * or a flame does. A `box` emits inside a box of `size`, centered on the emitter, along
 * `direction`. A `disc` emits on a disc of `radius` across the +y axis, along `direction`.
 *
 * @category api/particles
 */
export type EmitterShape =
	| { type: 'point' }
	| { type: 'sphere'; radius: number; surface?: boolean }
	| { type: 'cone'; radius: number; angle: number }
	| { type: 'box'; size: Vec3Like }
	| { type: 'disc'; radius: number };

/**
 * A burst: `count` particles at once, at `time` seconds after the system starts, then every
 * `interval` seconds, `cycles` times in all.
 *
 * @category api/particles
 */
export interface ParticleBurst {
	/** Seconds after the system starts. */
	time: number;
	/** The particles of each burst. */
	count: number;
	/** Seconds between bursts. Without it, the burst happens once, or once per loop of a looping system. */
	interval?: number;
	/** How many bursts, with `interval`. The default is no limit. */
	cycles?: number;
}

/**
 * A sub-emitter: another system that bursts where a particle of this system dies or first meets
 * the ground. A firework's rocket bursts into sparks this way, and a raindrop splashes.
 *
 * @category api/particles
 */
export interface SubEmitter {
	/** The system that bursts. */
	system: ParticleSystem;
	/** `death` at the end of the particle's life, or `ground` where it first meets the ground. */
	on: 'death' | 'ground';
	/** The particles of each burst. */
	count: number;
	/** The share of the particle's velocity that the burst's particles take on. The default is 0. */
	inheritVelocity?: number;
}

/**
 * Options of `createParticles`: the emitter, then the engine's particle buffer options, which give
 * the motion and the look.
 *
 * @category api/particles
 */
export interface ParticleSystemOptions extends Omit<ParticleBufferOptions, 'capacity'> {
	/**
	 * The most particles alive at once. The default fits the rate and the bursts over the longest
	 * lifetime. A system past its capacity reuses the oldest particles' places.
	 */
	capacity?: number;
	/** Where the system sits in the world, or under `parent`. The default is the origin. */
	position?: Vec3Like;
	/** The object that the system moves with, as a child of it. The default is the scene's root. */
	parent?: Object3D;
	/**
	 * An object to emit from, in place of the system's own place. Its particles stay in the world
	 * where they were born, so a moving emitter leaves a trail, as smoke from a torch does. Without
	 * it, particles move with the system's object.
	 */
	follow?: Object3D;
	/** Where the particles are born. The default is a point. */
	shape?: EmitterShape;
	/** The way particles set off from a point, box or disc, in the emitter's space. The default is up. */
	direction?: Vec3Like;
	/** How far from `direction` particles set off at random, in radians. The default is 0. */
	spread?: number;
	/** The start speed, in meters per second. The default is 1. */
	speed?: ParticleRange;
	/** A velocity that every particle adds to its own at birth, in meters per second. */
	velocity?: Vec3Like;
	/** How long each particle lives, in seconds. The default is 1. */
	lifetime?: ParticleRange;
	/** Particles born per second. The default is 0. */
	rate?: number;
	/** Bursts of particles at set times. */
	bursts?: readonly ParticleBurst[];
	/**
	 * Seconds that the system emits for. With `loop`, it starts again after it; without, it stops.
	 * The default is no end.
	 */
	duration?: number;
	/** True to start again after `duration`. The default is true. */
	loop?: boolean;
	/** True to start as if the system had run for its longest lifetime already. The default is false. */
	prewarm?: boolean;
	/** Systems that burst where this system's particles die or meet the ground. */
	subEmitters?: readonly SubEmitter[];
	/** The seed of the system's random numbers. Systems with the same seed emit the same particles. */
	seed?: number;
}

/** Seconds of the buffer's time after which the system moves its time back, for precision. */
const REBASE_AFTER = 1024;
/** Floats of a pending sub-emitter event: time, sub-emitter, birth place and time, velocity, seed. */
const EVENT_FLOATS = 10;

/** The smallest and the largest of a range. */
function span(range: ParticleRange | undefined, fallback: number): readonly [number, number] {
	if (range === undefined) return [fallback, fallback];
	return typeof range === 'number' ? [range, range] : range;
}

/**
 * A particle system: an emitter that fills a particle buffer. `createParticles` makes one. Call
 * `update(dt)` once per frame, in `onLateUpdate`, where objects' world places are the frame's.
 *
 * @category api/particles
 */
export class ParticleSystem {
	/** Particles born per second, which may change at any time. */
	rate: number;
	/** False to stop emitting, as the rate and the bursts say; live particles live out their lives. */
	emitting = true;
	/** Seconds since the system started, as `update` adds them up. */
	time = 0;
	private readonly lifetime: readonly [number, number];
	private readonly speed: readonly [number, number];
	private readonly seed: number;
	/** Particles emitted so far: each one's number picks its place and its random numbers. */
	private emitted = 0;
	/** The time of the next birth of the rate's stream, or Infinity for none. */
	private nextBirth = Infinity;
	/** The time that the buffer's time counts from. */
	private base = 0;
	private readonly motion: MotionValues = {
		gx: 0,
		gy: 0,
		gz: 0,
		drag: 0,
		wx: 0,
		wy: 0,
		wz: 0,
		turbulence: 0,
		turbulenceScale: 1,
		turbulenceSpeed: 1,
		groundHeight: 0,
		groundMode: GROUND_NONE,
		restitution: 0.4,
		friction: 0.2,
	};
	/** The followed object's world matrix in this frame and the frame before, and the system's inverse. */
	private readonly emitter = new Float64Array(16);
	private readonly lastEmitter = new Float64Array(16);
	private readonly toLocal = new Float64Array(16);
	private hasLast = false;
	/** The births' box in the system's space, for this span of the longest lifetime and the one before. */
	private readonly births = new Float64Array(12);
	private epochEnd = 0;
	private readonly bounds = new Float64Array(4);
	/** The pending sub-emitter events, EVENT_FLOATS each. */
	private readonly events: Float64Array;
	private eventCount = 0;
	private readonly sample = new Float64Array(6);
	private readonly direction = new Float64Array(3);
	/** The axes of the frame whose y axis is the emitter's direction, as three columns. */
	private readonly frame = new Float64Array(9);
	private readonly state = particleState();
	private readonly point = [0, 0, 0];
	private readonly inherited = [0, 0, 0];
	/** The system's world matrix and the matrix into a sub-emitter's space, while events fire. */
	private readonly world = new Float64Array(16);
	private readonly childLocal = new Float64Array(16);
	private readonly record = new Float32Array(9);

	/** @internal */
	constructor(
		/** The engine's particle buffer that the system fills, with its scene object. */
		readonly buffer: ParticleBuffer,
		private readonly options: ParticleSystemOptions,
	) {
		this.rate = options.rate ?? 0;
		this.lifetime = span(options.lifetime, 1);
		this.speed = span(options.speed, 1);
		this.seed = pcg(options.seed ?? 1);
		this.events = new Float64Array(
			options.subEmitters?.length ? buffer.capacity * options.subEmitters.length * EVENT_FLOATS : 0,
		);
		this.resetBirths();
		this.readMotion(options);
		const d = options.direction;
		if (d) {
			// t = normalize(cross(a, n)), b = cross(n, t), for n the direction and a an axis apart from it.
			const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number) || 1;
			const nx = (d[0] as number) / len;
			const ny = (d[1] as number) / len;
			const nz = (d[2] as number) / len;
			const [ax, ay, az] = Math.abs(ny) < 0.99 ? [0, 1, 0] : [1, 0, 0];
			let tx = ay * nz - az * ny;
			let ty = az * nx - ax * nz;
			let tz = ax * ny - ay * nx;
			const tl = Math.hypot(tx, ty, tz) || 1;
			tx /= tl;
			ty /= tl;
			tz /= tl;
			this.frame.set([
				tx,
				ty,
				tz,
				nx,
				ny,
				nz,
				ny * tz - nz * ty,
				nz * tx - nx * tz,
				nx * ty - ny * tx,
			]);
		}
	}

	/** The system's scene object: place, layers, visibility and bounds. */
	get object(): Mesh {
		return this.buffer.object;
	}

	/** Changes the motion and the look from the next frame on, as the options name them. */
	set(values: ParticleValues): void {
		this.buffer.set(values);
		this.readMotion(values);
	}

	/** Keeps the CPU's copy of the motion values in step with the buffer's. */
	private readMotion(values: ParticleValues): void {
		const m = this.motion;
		if (values.gravity) [m.gx, m.gy, m.gz] = values.gravity as [number, number, number];
		if (values.wind) [m.wx, m.wy, m.wz] = values.wind as [number, number, number];
		m.drag = values.drag ?? m.drag;
		m.turbulence = values.turbulence ?? m.turbulence;
		m.turbulenceScale = values.turbulenceScale ?? m.turbulenceScale;
		m.turbulenceSpeed = values.turbulenceSpeed ?? m.turbulenceSpeed;
		if (values.groundHeight !== undefined) {
			m.groundHeight = values.groundHeight;
			if (m.groundMode === GROUND_NONE) m.groundMode = 2;
		}
		if (values.groundMode) m.groundMode = { kill: 1, bounce: 2, stick: 3 }[values.groundMode];
		m.restitution = values.restitution ?? m.restitution;
		m.friction = values.friction ?? m.friction;
	}

	/**
	 * Moves the system on by `dt` seconds: emits the particles born in that time, fires the
	 * sub-emitters of particles that died or met the ground, and gives the buffer its time. Call it
	 * once per frame in `onLateUpdate`. It allocates nothing.
	 */
	update(dt: number): void {
		this.readEmitter();
		if (this.time === 0 && this.emitted === 0 && this.options.prewarm && dt > 0) {
			// A prewarmed system emits its first span of the longest lifetime at once.
			this.emitBetween(0, this.lifetime[1]);
			this.time = this.lifetime[1];
		}
		const from = this.time;
		const to = from + Math.max(dt, 0);
		this.emitBetween(from, to);
		this.time = to;
		this.fireEvents(to);
		if (to - this.base > REBASE_AFTER) this.rebase(to - this.base - this.lifetime[1] - 1);
		this.buffer.setFrame(to - this.base, Math.min(this.emitted, this.buffer.capacity));
		this.updateBounds(to);
	}

	/**
	 * Emits `count` particles at once, at the emitter, or born at `at` in the system's space with
	 * the shape's spread and `velocity` added.
	 */
	burst(count: number, at?: Vec3Like, velocity?: Vec3Like): void {
		for (let k = 0; k < count; k++) this.emit(this.time, 1, at, velocity);
	}

	/** Emits the rate's and the bursts' particles born after `from` and up to `to`. */
	private emitBetween(from: number, to: number): void {
		const { duration, loop = true } = this.options;
		const end = duration !== undefined && !loop ? duration : Infinity;
		if (this.emitting && this.rate > 0) {
			const step = 1 / this.rate;
			if (this.nextBirth === Infinity || this.nextBirth < from) this.nextBirth = from + step;
			let budget = this.buffer.capacity;
			while (this.nextBirth <= to && this.nextBirth <= end && budget-- > 0) {
				this.emit(this.nextBirth, (this.nextBirth - from) / Math.max(to - from, 1e-9));
				this.nextBirth += step;
			}
		} else this.nextBirth = Infinity;
		if (!this.emitting) return;
		for (const burst of this.options.bursts ?? []) {
			const interval = burst.interval ?? (loop && duration !== undefined ? duration : 0);
			const cycles = burst.interval !== undefined || loop ? (burst.cycles ?? Infinity) : 1;
			// The bursts whose times fall after `from` and up to `to`.
			let first = interval > 0 ? Math.max(0, Math.ceil((from - burst.time) / interval)) : 0;
			if (interval > 0 && burst.time + first * interval <= from) first++;
			for (let j = first; j < cycles; j++) {
				const at = burst.time + j * interval;
				if (at > to || at > end) break;
				if (at > from || (from === 0 && at === 0)) {
					const share = (at - from) / Math.max(to - from, 1e-9);
					for (let k = 0; k < burst.count; k++) this.emit(at, share);
				}
				if (interval <= 0) break;
			}
		}
	}

	/** Reads the emitter's world matrix for the frame, and the system's inverse world matrix. */
	private readEmitter(): void {
		const follow = this.options.follow;
		if (!follow) return;
		if (this.hasLast) this.lastEmitter.set(this.emitter);
		follow.getWorldMatrix(this.emitter as unknown as Mat4Like);
		this.object.getWorldMatrix(this.toLocal as unknown as Mat4Like);
		mat4.invert(this.toLocal as unknown as Mat4Like, this.toLocal as unknown as Mat4Like);
		if (!this.hasLast) {
			this.lastEmitter.set(this.emitter);
			this.hasLast = true;
		}
	}

	/**
	 * Emits one particle born at `time`, which is `share` of the way through the frame, for a
	 * followed emitter that moves. `at` and `velocity` give a burst's place and added velocity.
	 */
	private emit(time: number, share: number, at?: Vec3Like, velocity?: Vec3Like): void {
		const number = this.emitted++;
		const seed = pcg((this.seed ^ number) >>> 0);
		const s = this.sample;
		this.sampleShape(seed, s);
		let px = s[0] as number;
		let py = s[1] as number;
		let pz = s[2] as number;
		let vx = s[3] as number;
		let vy = s[4] as number;
		let vz = s[5] as number;
		if (at) {
			px += at[0] as number;
			py += at[1] as number;
			pz += at[2] as number;
		} else if (this.options.follow) {
			// From the emitter's space to the world, between its places in the two frames, then
			// into the system's space.
			const a = this.lastEmitter;
			const b = this.emitter;
			const tx = (a[12] as number) + ((b[12] as number) - (a[12] as number)) * share;
			const ty = (a[13] as number) + ((b[13] as number) - (a[13] as number)) * share;
			const tz = (a[14] as number) + ((b[14] as number) - (a[14] as number)) * share;
			const wx = (b[0] as number) * px + (b[4] as number) * py + (b[8] as number) * pz + tx;
			const wy = (b[1] as number) * px + (b[5] as number) * py + (b[9] as number) * pz + ty;
			const wz = (b[2] as number) * px + (b[6] as number) * py + (b[10] as number) * pz + tz;
			const dx = (b[0] as number) * vx + (b[4] as number) * vy + (b[8] as number) * vz;
			const dy = (b[1] as number) * vx + (b[5] as number) * vy + (b[9] as number) * vz;
			const dz = (b[2] as number) * vx + (b[6] as number) * vy + (b[10] as number) * vz;
			const m = this.toLocal;
			px =
				(m[0] as number) * wx + (m[4] as number) * wy + (m[8] as number) * wz + (m[12] as number);
			py =
				(m[1] as number) * wx + (m[5] as number) * wy + (m[9] as number) * wz + (m[13] as number);
			pz =
				(m[2] as number) * wx + (m[6] as number) * wy + (m[10] as number) * wz + (m[14] as number);
			vx = (m[0] as number) * dx + (m[4] as number) * dy + (m[8] as number) * dz;
			vy = (m[1] as number) * dx + (m[5] as number) * dy + (m[9] as number) * dz;
			vz = (m[2] as number) * dx + (m[6] as number) * dy + (m[10] as number) * dz;
		}
		const add = velocity ?? this.options.velocity;
		if (add) {
			vx += add[0] as number;
			vy += add[1] as number;
			vz += add[2] as number;
		}
		const lifetime = between(this.lifetime, seed, 11);
		const index = number % this.buffer.capacity;
		this.buffer.write(index, px, py, pz, time - this.base, vx, vy, vz, lifetime, seed);
		this.growBirths(px, py, pz);
		const subs = this.options.subEmitters;
		if (subs)
			for (let k = 0; k < subs.length; k++)
				this.planEvent(k, time, lifetime, seed, px, py, pz, vx, vy, vz);
	}

	/** Writes a place and a velocity from the shape, in the emitter's space, into `out`. */
	private sampleShape(seed: number, out: Float64Array): void {
		const shape = this.options.shape ?? { type: 'point' };
		const speed = between(this.speed, seed, 12);
		const u = chance(seed, 13);
		const v = chance(seed, 14);
		const w = chance(seed, 15);
		let px = 0;
		let py = 0;
		let pz = 0;
		// A direction: up, or the option's, within the spread; the sphere's and the cone's own.
		const d = this.direction;
		if (shape.type === 'cone') this.cap(shape.angle, u, v, true);
		else this.cap(this.options.spread ?? 0, u, v, false);
		switch (shape.type) {
			case 'sphere': {
				const z = 2 * u - 1;
				const r = Math.sqrt(1 - z * z);
				const a = 2 * Math.PI * v;
				d[0] = r * Math.cos(a);
				d[1] = z;
				d[2] = r * Math.sin(a);
				const radius = shape.radius * (shape.surface ? 1 : Math.cbrt(w));
				px = (d[0] as number) * radius;
				py = (d[1] as number) * radius;
				pz = (d[2] as number) * radius;
				break;
			}
			case 'cone':
			case 'disc': {
				const r = shape.radius * Math.sqrt(w);
				const a = 2 * Math.PI * chance(seed, 16);
				px = r * Math.cos(a);
				pz = r * Math.sin(a);
				break;
			}
			case 'box':
				px = (w - 0.5) * (shape.size[0] as number);
				py = (chance(seed, 16) - 0.5) * (shape.size[1] as number);
				pz = (chance(seed, 17) - 0.5) * (shape.size[2] as number);
				break;
		}
		out[0] = px;
		out[1] = py;
		out[2] = pz;
		out[3] = (d[0] as number) * speed;
		out[4] = (d[1] as number) * speed;
		out[5] = (d[2] as number) * speed;
	}

	/**
	 * Writes a random direction within `angle` radians of up, or of the option's direction unless
	 * `up`, evenly over the cap of the sphere that the angle cuts.
	 */
	private cap(angle: number, u: number, v: number, up: boolean): void {
		const cos = 1 - u * (1 - Math.cos(angle));
		const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
		const a = 2 * Math.PI * v;
		const x = sin * Math.cos(a);
		const z = sin * Math.sin(a);
		const out = this.direction;
		const f = this.frame;
		if (up || !this.options.direction) {
			out[0] = x;
			out[1] = cos;
			out[2] = z;
			return;
		}
		// The cap turns from up onto the direction: f holds the frame whose y axis is the direction.
		out[0] = (f[0] as number) * x + (f[3] as number) * cos + (f[6] as number) * z;
		out[1] = (f[1] as number) * x + (f[4] as number) * cos + (f[7] as number) * z;
		out[2] = (f[2] as number) * x + (f[5] as number) * cos + (f[8] as number) * z;
	}

	/** Records when a new particle's sub-emitter fires, if it does within its life. */
	private planEvent(
		sub: number,
		time: number,
		lifetime: number,
		seed: number,
		px: number,
		py: number,
		pz: number,
		vx: number,
		vy: number,
		vz: number,
	): void {
		const m = this.motion;
		const on = this.options.subEmitters?.[sub]?.on;
		let age = lifetime;
		if (m.groundMode !== GROUND_NONE) {
			const hit = impact(m, px, py, pz, vx, vy, vz, lifetime);
			if (on === 'ground' && hit < 0) return;
			if (hit >= 0 && (on === 'ground' || m.groundMode === GROUND_KILL)) age = hit;
		} else if (on === 'ground') return;
		if (this.eventCount * EVENT_FLOATS >= this.events.length) return;
		const e = this.events;
		const at = this.eventCount++ * EVENT_FLOATS;
		e[at] = time + age;
		e[at + 1] = sub;
		e[at + 2] = px;
		e[at + 3] = py;
		e[at + 4] = pz;
		e[at + 5] = time;
		e[at + 6] = vx;
		e[at + 7] = vy;
		e[at + 8] = vz;
		e[at + 9] = seed;
	}

	/** Fires the sub-emitters whose events fall due by `now`. */
	private fireEvents(now: number): void {
		const subs = this.options.subEmitters;
		if (!subs || this.eventCount === 0) return;
		const e = this.events;
		const s = this.state;
		const w = this.world;
		const local = this.childLocal;
		this.object.getWorldMatrix(w as unknown as Mat4Like);
		let child: ParticleSystem | undefined;
		for (let k = 0; k < this.eventCount; ) {
			const at = k * EVENT_FLOATS;
			if ((e[at] as number) > now) {
				k++;
				continue;
			}
			const sub = subs[e[at + 1] as number] as SubEmitter;
			const age = (e[at] as number) - (e[at + 5] as number);
			stateAt(
				this.motion,
				e[at + 2] as number,
				e[at + 3] as number,
				e[at + 4] as number,
				e[at + 6] as number,
				e[at + 7] as number,
				e[at + 8] as number,
				age,
				e[at + 9] as number,
				s,
			);
			// From this system's space to the world, then into the sub-emitter's space.
			if (child !== sub.system) {
				child = sub.system;
				child.object.getWorldMatrix(local as unknown as Mat4Like);
				mat4.invert(local as unknown as Mat4Like, local as unknown as Mat4Like);
			}
			const wx =
				(w[0] as number) * s.px +
				(w[4] as number) * s.py +
				(w[8] as number) * s.pz +
				(w[12] as number);
			const wy =
				(w[1] as number) * s.px +
				(w[5] as number) * s.py +
				(w[9] as number) * s.pz +
				(w[13] as number);
			const wz =
				(w[2] as number) * s.px +
				(w[6] as number) * s.py +
				(w[10] as number) * s.pz +
				(w[14] as number);
			const p = this.point;
			p[0] =
				(local[0] as number) * wx +
				(local[4] as number) * wy +
				(local[8] as number) * wz +
				(local[12] as number);
			p[1] =
				(local[1] as number) * wx +
				(local[5] as number) * wy +
				(local[9] as number) * wz +
				(local[13] as number);
			p[2] =
				(local[2] as number) * wx +
				(local[6] as number) * wy +
				(local[10] as number) * wz +
				(local[14] as number);
			const inherit = sub.inheritVelocity ?? 0;
			const v = this.inherited;
			v[0] = s.vx * inherit;
			v[1] = s.vy * inherit;
			v[2] = s.vz * inherit;
			sub.system.burst(sub.count, p, inherit === 0 ? undefined : v);
			// The last event takes this one's place.
			this.eventCount--;
			e.copyWithin(at, this.eventCount * EVENT_FLOATS, (this.eventCount + 1) * EVENT_FLOATS);
		}
	}

	/** Starts the births' boxes empty. */
	private resetBirths(): void {
		this.births.fill(Infinity, 0, 3);
		this.births.fill(-Infinity, 3, 6);
		this.births.fill(Infinity, 6, 9);
		this.births.fill(-Infinity, 9, 12);
	}

	/** Grows this span's box of births by a birth place. */
	private growBirths(x: number, y: number, z: number): void {
		const b = this.births;
		b[0] = Math.min(b[0] as number, x);
		b[1] = Math.min(b[1] as number, y);
		b[2] = Math.min(b[2] as number, z);
		b[3] = Math.max(b[3] as number, x);
		b[4] = Math.max(b[4] as number, y);
		b[5] = Math.max(b[5] as number, z);
	}

	/**
	 * Gives the system's object a culling sphere around every live particle: the births of this
	 * span of the longest lifetime and the one before, grown by how far a particle can move.
	 */
	private updateBounds(now: number): void {
		const b = this.births;
		const life = this.lifetime[1];
		if (now >= this.epochEnd) {
			b.copyWithin(6, 0, 6);
			b.fill(Infinity, 0, 3);
			b.fill(-Infinity, 3, 6);
			this.epochEnd = now + life;
		}
		const min = (k: number) => Math.min(b[k] as number, b[k + 6] as number);
		const max = (k: number) => Math.max(b[k + 3] as number, b[k + 9] as number);
		if (!(min(0) <= max(0))) return;
		const add = this.options.velocity;
		const speed =
			this.speed[1] + (add ? Math.hypot(add[0] as number, add[1] as number, add[2] as number) : 0);
		const size = this.options.size?.[1] ?? 0.1;
		const grow = reach(this.motion, speed, life) + size * Math.max(1, this.options.aspect ?? 1);
		const cx = (min(0) + max(0)) / 2;
		const cy = (min(1) + max(1)) / 2;
		const cz = (min(2) + max(2)) / 2;
		const radius = Math.hypot(max(0) - cx, max(1) - cy, max(2) - cz) + grow;
		const o = this.bounds;
		if (o[0] === cx && o[1] === cy && o[2] === cz && o[3] === radius) return;
		o[0] = cx;
		o[1] = cy;
		o[2] = cz;
		o[3] = radius;
		this.point[0] = cx;
		this.point[1] = cy;
		this.point[2] = cz;
		this.object.setBounds(this.point, radius);
	}

	/**
	 * Moves the buffer's time back by `shift` seconds, with every record's birth time, so the
	 * GPU's 32-bit times keep their precision in a system that runs for hours.
	 */
	private rebase(shift: number): void {
		if (shift <= 0) return;
		const count = Math.min(this.emitted, this.buffer.capacity);
		const record = this.record;
		for (let i = 0; i < count; i++) {
			this.buffer.read(i, record);
			this.buffer.write(
				i,
				record[0] as number,
				record[1] as number,
				record[2] as number,
				(record[3] as number) - shift,
				record[4] as number,
				record[5] as number,
				record[6] as number,
				record[7] as number,
				record[8] as number,
			);
		}
		this.base += shift;
	}

	/** Removes the system and its particles from the scene. */
	destroy(): void {
		this.buffer.destroy();
	}
}

/** The capacity that fits a system's rate and bursts over its longest lifetime. */
function defaultCapacity(options: ParticleSystemOptions): number {
	const [, longest] = span(options.lifetime, 1);
	let bursts = 0;
	for (const burst of options.bursts ?? []) {
		const repeats = burst.interval ? Math.ceil(longest / burst.interval) + 1 : 1;
		bursts += burst.count * repeats;
	}
	const rate = (options.rate ?? 0) * longest;
	return Math.max(16, Math.ceil(rate * 1.1 + bursts + 1));
}

/**
 * Makes a particle system in the scene: an emitter, and the engine's particle buffer that it fills.
 * Call the system's `update(dt)` once per frame in `onLateUpdate`. The first system downloads the
 * engine's particle code. Throws E1108 for a capacity out of range, and E1406 when the particle
 * code does not download.
 *
 * @category api/particles
 */
export async function createParticles(
	scene: Scene,
	options: ParticleSystemOptions,
): Promise<ParticleSystem> {
	const capacity = options.capacity ?? defaultCapacity(options);
	const buffer = await scene.createParticleBuffer({ ...options, capacity });
	const { object } = buffer;
	if (options.parent) object.setParent(options.parent);
	const position = options.position;
	if (position)
		object.setPosition(position[0] as number, position[1] as number, position[2] as number);
	else if (options.follow) {
		// The system sits where the followed object starts, so its particles' places stay small.
		const place = [0, 0, 0];
		options.follow.getWorldPosition(place);
		object.setPosition(place[0] as number, place[1] as number, place[2] as number);
	}
	return new ParticleSystem(buffer, options);
}
