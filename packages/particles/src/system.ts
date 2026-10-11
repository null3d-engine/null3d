// Particle systems: an emitter that fills one of the engine's particle buffers. The emitter runs on
// the sketch's thread in `update`, once per frame. It works out which particles are born in the
// frame, at even times between the frame before and this one, writes each one's record once, and
// gives the buffer the frame's time. The GPU does the rest: each particle moves, turns, changes
// color and dies in closed form, so a system of a million particles costs the CPU only its births.
//
// `update` allocates nothing. Its numbers move through typed arrays and fields, never as the
// arguments or the results of calls that the engine may not inline, which would box them.

import type {
	Mat4Like,
	Mesh,
	Object3D,
	ParticleBuffer,
	ParticleBufferOptions,
	ParticleValues,
	SketchContext,
	SketchTime,
	Vec3Like,
} from '@null3d/engine';
import { mat4 } from '@null3d/engine';
import {
	AGE,
	BIRTH,
	GROUND_BOUNCE,
	GROUND_KILL,
	GROUND_NONE,
	GROUND_STICK,
	HIT,
	impact,
	type MotionValues,
	P,
	PARTICLE_FLOATS,
	particleState,
	reach,
	SEED,
	stateAt,
	T,
	V,
	VELOCITY,
} from './motion';
import { NUMBER, PARTICLE_SEED, pcg, randomize, SYSTEM_SEED } from './random';

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
/** Floats of a pending sub-emitter event: its time and sub-emitter, then the particle's numbers. */
const EVENT_FLOATS = 2 + PARTICLE_FLOATS;
/** The random channels of a particle: its speed, shape, direction, place in a box, and lifetime. */
const SPEED = 0;
const U = 1;
const W = 2;
const R = 3;
const ANGLE = 4;
const BOX_Y = 5;
const BOX_Z = 6;
const LIFE = 7;
const CHANNELS = 8;
/** The places of the record that the system writes for each particle. */
const RECORD_TIME = 3;
const RECORD_LIFE = 7;
/** The places of the emitter's numbers: the span of emission, and the next birth's time and share. */
const FROM = 0;
const TO = 1;
const BIRTH_TIME = 2;
const SHARE = 3;

/** The share of its culling sphere's radius below which a system's new sphere replaces it. */
const BOUNDS_SLACK = 0.8;

/** The ground's mode codes, by name. */
const GROUND_MODES = { kill: GROUND_KILL, bounce: GROUND_BOUNCE, stick: GROUND_STICK } as const;

/** The frame of directions about up, for the cone. */
const IDENTITY = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** The smallest and the largest of a range. */
function span(range: ParticleRange | undefined, fallback: number): readonly [number, number] {
	if (range === undefined) return [fallback, fallback];
	return typeof range === 'number' ? [range, range] : range;
}

/**
 * A particle system: an emitter that fills a particle buffer. `createParticles` makes one. Call
 * `update()` once per frame, in `onLateUpdate`, where objects' world places are the frame's.
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
	/** How far beyond its births' box a live particle may be, for the culling sphere. */
	private grow = 0;
	/** The followed object's world matrix in this frame and the frame before, and the system's inverse. */
	private readonly emitter = new Float64Array(16);
	private readonly lastEmitter = new Float64Array(16);
	private readonly toLocal = new Float64Array(16);
	private hasLast = false;
	/** The births' box in the system's space, for this span of the longest lifetime and the one before. */
	private readonly births = new Float64Array(12);
	private epochEnd = 0;
	/** The culling sphere last given to the object, and the point that carries its center. */
	private readonly bounds = new Float64Array(4);
	private readonly center = [0, 0, 0];
	/** The pending sub-emitter events, EVENT_FLOATS each. */
	private readonly events: Float64Array;
	private eventCount = 0;
	/** The emitter's numbers: see FROM, TO, BIRTH_TIME and SHARE. */
	private readonly span = new Float64Array(4);
	/** The system's seed, a particle's number and its seed, for `randomize`. */
	private readonly seeds = new Uint32Array(3);
	private readonly random = new Float64Array(CHANNELS);
	/** The record of the particle being born, as the buffer takes it. */
	private readonly record = new Float64Array(8);
	/** The axes of the frame whose y axis is the emitter's direction, as three columns. */
	private readonly frame = new Float64Array(9);
	/** A particle's numbers for the motion functions, and its state at an event. */
	private readonly particle = new Float64Array(PARTICLE_FLOATS);
	private readonly flightNumbers = new Float64Array(14);
	private readonly state = particleState();
	/** A burst's place and its added velocity, made in the sub-emitter's space. */
	private readonly point = [0, 0, 0];
	private readonly inherited = [0, 0, 0];
	/** This system's world matrix and the matrix into a sub-emitter's space, while events fire. */
	private readonly world = new Float64Array(16);
	private readonly childLocal = new Float64Array(16);
	private readonly saved = new Float32Array(9);

	/** @internal */
	constructor(
		/** The engine's particle buffer that the system fills, with its scene object. */
		readonly buffer: ParticleBuffer,
		private readonly options: ParticleSystemOptions,
		private readonly clock: SketchTime,
	) {
		this.rate = options.rate ?? 0;
		this.lifetime = span(options.lifetime, 1);
		this.speed = span(options.speed, 1);
		this.seeds[SYSTEM_SEED] = pcg(options.seed ?? 1);
		const subs = options.subEmitters?.length ?? 0;
		this.events = new Float64Array(subs > 0 ? buffer.capacity * subs * EVENT_FLOATS : 0);
		this.resetBirths();
		this.readMotion(options);
		this.frame.set(IDENTITY);
		const d = options.direction;
		if (d) {
			// t = normalize(cross(a, n)) and b = cross(n, t), for n the direction and a an axis apart.
			const [dx, dy, dz] = [d[0] as number, d[1] as number, d[2] as number];
			const len = Math.hypot(dx, dy, dz) || 1;
			const [nx, ny, nz] = [dx / len, dy / len, dz / len];
			const [ax, ay, az] = Math.abs(ny) < 0.99 ? [0, 1, 0] : [1, 0, 0];
			const [cx, cy, cz] = [ay * nz - az * ny, az * nx - ax * nz, ax * ny - ay * nx];
			const tl = Math.hypot(cx, cy, cz) || 1;
			const [tx, ty, tz] = [cx / tl, cy / tl, cz / tl];
			const bx = ny * tz - nz * ty;
			const by = nz * tx - nx * tz;
			const bz = nx * ty - ny * tx;
			this.frame.set([tx, ty, tz, nx, ny, nz, bx, by, bz]);
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

	/** Keeps the CPU's copy of the motion values in step with the buffer's, and the reach. */
	private readMotion(values: ParticleValues): void {
		const m = this.motion;
		const { gravity, wind } = values;
		if (gravity) {
			m.gx = gravity[0] as number;
			m.gy = gravity[1] as number;
			m.gz = gravity[2] as number;
		}
		if (wind) {
			m.wx = wind[0] as number;
			m.wy = wind[1] as number;
			m.wz = wind[2] as number;
		}
		m.drag = values.drag ?? m.drag;
		m.turbulence = values.turbulence ?? m.turbulence;
		m.turbulenceScale = values.turbulenceScale ?? m.turbulenceScale;
		m.turbulenceSpeed = values.turbulenceSpeed ?? m.turbulenceSpeed;
		if (values.groundHeight !== undefined) {
			m.groundHeight = values.groundHeight;
			if (m.groundMode === GROUND_NONE) m.groundMode = GROUND_BOUNCE;
		}
		if (values.groundMode) m.groundMode = GROUND_MODES[values.groundMode];
		m.restitution = values.restitution ?? m.restitution;
		m.friction = values.friction ?? m.friction;
		const add = this.options.velocity;
		const extra = add ? Math.hypot(add[0] as number, add[1] as number, add[2] as number) : 0;
		const size = Math.max(values.size?.[1] ?? 0, this.options.size?.[1] ?? 0.1);
		const aspect = Math.max(1, values.aspect ?? this.options.aspect ?? 1);
		this.grow = reach(m, this.speed[1] + extra, this.lifetime[1]) + size * aspect;
	}

	/**
	 * Moves the system on by the frame's step, or by `dt` seconds: emits the particles born in that
	 * time, fires the sub-emitters of particles that died or met the ground, and gives the buffer
	 * its time. Call it once per frame in `onLateUpdate`. It allocates nothing.
	 */
	update(dt?: number): void {
		const s = this.span;
		this.readEmitter();
		if (this.time === 0 && this.emitted === 0 && this.options.prewarm) {
			// A prewarmed system emits its first span of the longest lifetime at once.
			s[FROM] = 0;
			s[TO] = this.lifetime[1];
			this.emitBetween();
			this.time = this.lifetime[1];
		}
		// The step goes through the typed array: a number that may be either of two values would be
		// boxed on its way.
		s[TO] = this.clock.dt;
		if (dt !== undefined) s[TO] = dt;
		s[FROM] = this.time;
		s[TO] = this.time + Math.max(s[TO] as number, 0);
		this.emitBetween();
		this.time = s[TO] as number;
		this.fireEvents();
		if (this.time - this.base > REBASE_AFTER) this.rebase();
		const frame = this.buffer.frame;
		frame[0] = this.time - this.base;
		frame[1] = Math.min(this.emitted, this.buffer.capacity);
		this.buffer.commit();
		this.updateBounds();
	}

	/**
	 * Emits `count` particles at once, at the emitter, or born at `at` in the system's space with
	 * the shape's spread and `velocity` added.
	 */
	burst(count: number, at?: Vec3Like, velocity?: Vec3Like): void {
		this.span[BIRTH_TIME] = this.time;
		this.span[SHARE] = 1;
		for (let k = 0; k < count; k++) this.emit(at, velocity);
	}

	/** Emits the rate's and the bursts' particles born after the span's start and up to its end. */
	private emitBetween(): void {
		const s = this.span;
		const from = s[FROM] as number;
		const to = s[TO] as number;
		const length = Math.max(to - from, 1e-9);
		const { duration, loop = true, bursts } = this.options;
		const end = duration !== undefined && !loop ? duration : Infinity;
		if (this.emitting && this.rate > 0) {
			const step = 1 / this.rate;
			if (this.nextBirth === Infinity || this.nextBirth < from) this.nextBirth = from + step;
			let budget = this.buffer.capacity;
			while (this.nextBirth <= to && this.nextBirth <= end && budget-- > 0) {
				s[BIRTH_TIME] = this.nextBirth;
				s[SHARE] = (this.nextBirth - from) / length;
				this.emit(undefined, undefined);
				this.nextBirth += step;
			}
		} else this.nextBirth = Infinity;
		if (!this.emitting || !bursts) return;
		for (let b = 0; b < bursts.length; b++) {
			const burst = bursts[b] as ParticleBurst;
			const interval = burst.interval ?? (loop && duration !== undefined ? duration : 0);
			const cycles = burst.interval !== undefined || loop ? (burst.cycles ?? Infinity) : 1;
			// The bursts whose times fall after the span's start and up to its end.
			let first = interval > 0 ? Math.max(0, Math.ceil((from - burst.time) / interval)) : 0;
			if (interval > 0 && burst.time + first * interval <= from) first++;
			for (let j = first; j < cycles; j++) {
				const at = burst.time + j * interval;
				if (at > to || at > end) break;
				if (at > from || (from === 0 && at === 0)) {
					s[BIRTH_TIME] = at;
					s[SHARE] = (at - from) / length;
					for (let k = 0; k < burst.count; k++) this.emit(undefined, undefined);
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
	 * Emits one particle, born at the span's birth time, its share of the way through the frame for
	 * a followed emitter that moves. `at` and `velocity` give a burst's place and added velocity.
	 */
	private emit(at: Vec3Like | undefined, velocity: Vec3Like | undefined): void {
		const seeds = this.seeds;
		const number = this.emitted++;
		seeds[NUMBER] = number;
		randomize(seeds, this.random);
		const r = this.record;
		this.sampleShape();
		if (at) {
			for (let c = 0; c < 3; c++) r[c] = (r[c] as number) + (at[c] as number);
		} else if (this.options.follow) this.placeFollowed();
		const add = velocity ?? this.options.velocity;
		if (add) for (let c = 0; c < 3; c++) r[4 + c] = (r[4 + c] as number) + (add[c] as number);
		const shortest = this.lifetime[0];
		r[RECORD_LIFE] = shortest + (this.lifetime[1] - shortest) * (this.random[LIFE] as number);
		r[RECORD_TIME] = (this.span[BIRTH_TIME] as number) - this.base;
		const seed = (seeds[PARTICLE_SEED] as number) & 0xffff;
		this.buffer.write(number % this.buffer.capacity, r, seed);
		this.growBirths();
		const subs = this.options.subEmitters;
		if (subs) for (let k = 0; k < subs.length; k++) this.planEvent(k);
	}

	/**
	 * Moves the record's place and velocity from the emitter's space to the world, between the
	 * emitter's places in the two frames, then into the system's space.
	 */
	private placeFollowed(): void {
		const r = this.record;
		const a = this.lastEmitter;
		const b = this.emitter;
		const m = this.toLocal;
		const p = this.point;
		const d = this.inherited;
		const share = this.span[SHARE] as number;
		for (let c = 0; c < 3; c++) {
			const from = a[12 + c] as number;
			const moved = from + ((b[12 + c] as number) - from) * share;
			p[c] = moved;
			d[c] = 0;
			for (let k = 0; k < 3; k++) {
				const axis = b[4 * k + c] as number;
				p[c] = (p[c] as number) + axis * (r[k] as number);
				d[c] = (d[c] as number) + axis * (r[4 + k] as number);
			}
		}
		for (let c = 0; c < 3; c++) {
			let place = m[12 + c] as number;
			let speed = 0;
			for (let k = 0; k < 3; k++) {
				place += (m[4 * k + c] as number) * (p[k] as number);
				speed += (m[4 * k + c] as number) * (d[k] as number);
			}
			r[c] = place;
			r[4 + c] = speed;
		}
	}

	/** Writes a place and a velocity from the shape, in the emitter's space, into the record. */
	private sampleShape(): void {
		const shape = this.options.shape;
		const rand = this.random;
		const r = this.record;
		const speed = this.speed[0] + (this.speed[1] - this.speed[0]) * (rand[SPEED] as number);
		const u = rand[U] as number;
		const v = rand[W] as number;
		const w = rand[R] as number;
		let px = 0;
		let py = 0;
		let pz = 0;
		let dx: number;
		let dy: number;
		let dz: number;
		if (shape?.type === 'sphere') {
			const z = 2 * u - 1;
			const ring = Math.sqrt(1 - z * z);
			const a = 2 * Math.PI * v;
			dx = ring * Math.cos(a);
			dy = z;
			dz = ring * Math.sin(a);
			const at = shape.radius * (shape.surface ? 1 : Math.cbrt(w));
			px = dx * at;
			py = dy * at;
			pz = dz * at;
		} else {
			// A direction within the cone's angle of up, or within the spread of the option's
			// direction, evenly over the cap of the sphere that the angle cuts.
			const cone = shape?.type === 'cone';
			const angle = shape?.type === 'cone' ? shape.angle : (this.options.spread ?? 0);
			const cos = 1 - u * (1 - Math.cos(angle));
			const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
			const a = 2 * Math.PI * v;
			const x = sin * Math.cos(a);
			const z = sin * Math.sin(a);
			const f = cone ? IDENTITY : this.frame;
			dx = (f[0] as number) * x + (f[3] as number) * cos + (f[6] as number) * z;
			dy = (f[1] as number) * x + (f[4] as number) * cos + (f[7] as number) * z;
			dz = (f[2] as number) * x + (f[5] as number) * cos + (f[8] as number) * z;
			if (shape?.type === 'cone' || shape?.type === 'disc') {
				const radius = shape.radius * Math.sqrt(w);
				const turn = 2 * Math.PI * (rand[ANGLE] as number);
				px = radius * Math.cos(turn);
				pz = radius * Math.sin(turn);
			} else if (shape?.type === 'box') {
				px = (w - 0.5) * (shape.size[0] as number);
				py = ((rand[BOX_Y] as number) - 0.5) * (shape.size[1] as number);
				pz = ((rand[BOX_Z] as number) - 0.5) * (shape.size[2] as number);
			}
		}
		r[0] = px;
		r[1] = py;
		r[2] = pz;
		r[4] = dx * speed;
		r[5] = dy * speed;
		r[6] = dz * speed;
	}

	/** Records when the newest particle's sub-emitter `sub` fires, if it does within its life. */
	private planEvent(sub: number): void {
		const m = this.motion;
		const r = this.record;
		const on = this.options.subEmitters?.[sub]?.on;
		const lifetime = r[RECORD_LIFE] as number;
		let age = lifetime;
		if (m.groundMode !== GROUND_NONE) {
			const io = this.flightNumbers;
			for (let k = 0; k < 3; k++) {
				io[P + k] = r[k] as number;
				io[V + k] = r[4 + k] as number;
			}
			io[T] = lifetime;
			impact(m, io);
			const hit = io[HIT] as number;
			if (on === 'ground' && hit < 0) return;
			if (hit >= 0 && (on === 'ground' || m.groundMode === GROUND_KILL)) age = hit;
		} else if (on === 'ground') return;
		if ((this.eventCount + 1) * EVENT_FLOATS > this.events.length) return;
		const e = this.events;
		const at = this.eventCount++ * EVENT_FLOATS;
		e[at] = (this.span[BIRTH_TIME] as number) + age;
		e[at + 1] = sub;
		for (let k = 0; k < 3; k++) {
			e[at + 2 + BIRTH + k] = r[k] as number;
			e[at + 2 + VELOCITY + k] = r[4 + k] as number;
		}
		e[at + 2 + AGE] = age;
		e[at + 2 + SEED] = this.seeds[PARTICLE_SEED] as number;
	}

	/** Fires the sub-emitters whose events fall due by now. */
	private fireEvents(): void {
		const subs = this.options.subEmitters;
		if (!subs || this.eventCount === 0) return;
		const e = this.events;
		const s = this.state;
		const w = this.world;
		const local = this.childLocal;
		const input = this.particle;
		const p = this.point;
		this.object.getWorldMatrix(w as unknown as Mat4Like);
		let child: ParticleSystem | undefined;
		for (let k = 0; k < this.eventCount; ) {
			const at = k * EVENT_FLOATS;
			if ((e[at] as number) > this.time) {
				k++;
				continue;
			}
			const sub = subs[e[at + 1] as number] as SubEmitter;
			for (let j = 0; j < PARTICLE_FLOATS; j++) input[j] = e[at + 2 + j] as number;
			stateAt(this.motion, input, s);
			// From this system's space to the world, then into the sub-emitter's space.
			if (child !== sub.system) {
				child = sub.system;
				child.object.getWorldMatrix(local as unknown as Mat4Like);
				mat4.invert(local as unknown as Mat4Like, local as unknown as Mat4Like);
			}
			for (let c = 0; c < 3; c++) {
				const world =
					(w[c] as number) * s.px +
					(w[4 + c] as number) * s.py +
					(w[8 + c] as number) * s.pz +
					(w[12 + c] as number);
				input[c] = world;
			}
			for (let c = 0; c < 3; c++) {
				let place = local[12 + c] as number;
				for (let j = 0; j < 3; j++) place += (local[4 * j + c] as number) * (input[j] as number);
				p[c] = place;
			}
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

	/** Grows this span's box of births by the newest birth place. */
	private growBirths(): void {
		const b = this.births;
		const r = this.record;
		for (let c = 0; c < 3; c++) {
			b[c] = Math.min(b[c] as number, r[c] as number);
			b[3 + c] = Math.max(b[3 + c] as number, r[c] as number);
		}
	}

	/**
	 * Gives the system's object a culling sphere around every live particle: the births of this
	 * span of the longest lifetime and the one before, grown by how far a particle can move. The
	 * object keeps its sphere while the new one fits in it and is not much smaller, so a steady
	 * emitter sets its bounds only now and then.
	 */
	private updateBounds(): void {
		const b = this.births;
		if (this.time >= this.epochEnd) {
			b.copyWithin(6, 0, 6);
			b.fill(Infinity, 0, 3);
			b.fill(-Infinity, 3, 6);
			this.epochEnd = this.time + this.lifetime[1];
		}
		const o = this.bounds;
		const center = this.center;
		let squared = 0;
		let moved = 0;
		for (let c = 0; c < 3; c++) {
			const low = Math.min(b[c] as number, b[6 + c] as number);
			const high = Math.max(b[3 + c] as number, b[9 + c] as number);
			if (!(low <= high)) return;
			const middle = (low + high) / 2;
			squared += (high - middle) * (high - middle);
			moved += (middle - (o[c] as number)) * (middle - (o[c] as number));
			center[c] = middle;
		}
		const radius = Math.sqrt(squared) + this.grow;
		const kept = o[3] as number;
		if (Math.sqrt(moved) + radius <= kept && radius > kept * BOUNDS_SLACK) return;
		for (let c = 0; c < 3; c++) o[c] = center[c] as number;
		o[3] = radius;
		this.object.setBounds(center, radius);
	}

	/**
	 * Moves the buffer's time back by whole seconds, with every record's birth time, so the GPU's
	 * 32-bit times keep their precision in a system that runs for hours.
	 */
	private rebase(): void {
		const shift = Math.floor(this.time - this.base - this.lifetime[1] - 1);
		if (shift <= 0) return;
		const count = Math.min(this.emitted, this.buffer.capacity);
		const saved = this.saved;
		const r = this.record;
		for (let i = 0; i < count; i++) {
			this.buffer.read(i, saved);
			for (let k = 0; k < 8; k++) r[k] = saved[k] as number;
			r[RECORD_TIME] = (r[RECORD_TIME] as number) - shift;
			this.buffer.write(i, r, saved[8] as number);
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
 * Makes a particle system in the sketch's scene: an emitter, and the engine's particle buffer that
 * it fills. Call the system's `update()` once per frame in `onLateUpdate`. The first system
 * downloads the engine's particle code. Throws E1108 for a capacity out of range, and E1406 when
 * the particle code does not download.
 *
 * @category api/particles
 */
export async function createParticles(
	context: SketchContext,
	options: ParticleSystemOptions,
): Promise<ParticleSystem> {
	const capacity = options.capacity ?? defaultCapacity(options);
	const buffer = await context.scene.createParticleBuffer({ ...options, capacity });
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
	return new ParticleSystem(buffer, options, context.time);
}
