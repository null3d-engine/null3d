// Particle systems: an emitter that fills one of the engine's particle buffers. The emitter's
// settings go to the engine's core once, and each frame the system gives the core the frame's
// span and its rate. The core makes every record of the frame, plans and fires the sub-emitters,
// and moves the time base, so the sketch starts the frame and reads settings but runs no loop over
// the births. The GPU does the rest: each particle moves, turns, changes color and dies in closed
// form, so a system of a million particles costs the CPU only its births.
//
// `update` allocates nothing: its numbers move through typed arrays and fields, never as the
// arguments or the results of calls that the engine may not inline, which would box them.
//
// Birth times are 32-bit floats on the GPU, so every 1,024 seconds a system moves the time that
// its buffer's time counts from. The core rewrites the records' birth times a share at a time,
// over many frames, and the GPU takes the move off the birth times of the records that the
// rewrite has not reached.

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

/** The thread's identity matrix, for a sub-emitter whose object is gone. */
const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

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
	get time(): number {
		return this.started[0] as number;
	}

	set time(value: number) {
		this.started[0] = value;
	}

	/** The system's time in a typed array, so a frame's write to it is no boxed number. */
	private readonly started = new Float64Array(1);
	/** True once the system has run a frame or taken a burst, so a prewarm is decided once. */
	private startedOnce = false;
	private readonly lifetime: readonly [number, number];
	private readonly options: ParticleSystemOptions;
	/** True once the system is destroyed, so a parent's events skip it. */
	private destroyed = false;
	/** The followed object's world matrix in this frame and the frame before, and the system's inverse. */
	private readonly emitter = new Float64Array(16);
	private readonly lastEmitter = new Float64Array(16);
	private readonly toLocal = new Float64Array(16);
	private hasLast = false;
	/** This system's world matrix, and each sub-emitter's inverse world matrix. */
	private readonly world = new Float64Array(16);
	private readonly childMatrices: Float64Array[];
	/** The frame's numbers: its start and end, its rate, and its two flags. */
	private readonly frame = new Float64Array(5);

	/** @internal */
	constructor(
		/** The engine's particle buffer that the system fills, with its scene object. */
		readonly buffer: ParticleBuffer,
		options: ParticleSystemOptions,
		private readonly clock: SketchTime,
	) {
		this.options = options;
		this.rate = options.rate ?? 0;
		this.lifetime = span(options.lifetime, 1);
		const subs = options.subEmitters ?? [];
		this.childMatrices = subs.map(() => new Float64Array(16));
		buffer.configureEmitter({
			seed: options.seed ?? 1,
			shape: options.shape,
			direction: options.direction,
			spread: options.spread,
			speed: span(options.speed, 1),
			velocity: options.velocity,
			lifetime: this.lifetime,
			bursts: options.bursts,
			duration: options.duration,
			loop: options.loop ?? true,
			follow: options.follow !== undefined,
			subEmitters: subs.map((sub) => ({
				buffer: sub.system.buffer,
				on: sub.on,
				count: sub.count,
				inheritVelocity: sub.inheritVelocity,
			})),
		});
	}

	/** The system's scene object: place, layers, visibility and bounds. */
	get object(): Mesh {
		return this.buffer.object;
	}

	/** Changes the motion and the look from the next frame on, as the options name them. */
	set(values: ParticleValues): void {
		this.buffer.set(values);
	}

	/**
	 * Moves the system on by the frame's step, or by `dt` seconds: emits the particles born in that
	 * time, fires the sub-emitters of particles that died or met the ground, and gives the buffer
	 * its time. The core writes the records in one call, so `update` runs no loop over the births.
	 * Call it once per frame in `onLateUpdate`. It allocates nothing.
	 */
	update(dt?: number): void {
		const step = dt ?? this.clock.dt;
		let prewarm = false;
		if (!this.startedOnce && this.started[0] === 0 && this.options.prewarm) {
			// A prewarmed system emits its first span of the longest lifetime at once.
			prewarm = true;
			this.started[0] = this.lifetime[1];
		}
		this.startedOnce = true;
		const from = this.started[0] as number;
		const to = from + Math.max(step, 0);
		this.readFollow();
		this.readEvents();
		const frame = this.frame;
		frame[0] = from;
		frame[1] = to;
		frame[2] = this.rate;
		frame[3] = this.emitting ? 1 : 0;
		frame[4] = prewarm ? 1 : 0;
		this.buffer.emitFrame(frame);
		this.started[0] = to;
	}

	/**
	 * Emits `count` particles at once, at the emitter, or at `at` in the system's space with the
	 * shape's spread around it. Each particle adds `velocity` to its own start velocity, in place of
	 * the system's `velocity` option. The core writes the records.
	 */
	burst(count: number, at?: Vec3Like, velocity?: Vec3Like): void {
		this.startedOnce = true;
		this.buffer.emitBurst(count, at, velocity);
	}

	/** Reads the followed object's matrices for the frame's births. */
	private readFollow(): void {
		const follow = this.options.follow;
		if (!follow) return;
		if (this.hasLast) this.lastEmitter.set(this.emitter);
		follow.getWorldMatrix(this.emitter as unknown as Mat4Like);
		this.buffer.object.getWorldMatrix(this.toLocal as unknown as Mat4Like);
		mat4.invert(this.toLocal as unknown as Mat4Like, this.toLocal as unknown as Mat4Like);
		if (!this.hasLast) {
			this.lastEmitter.set(this.emitter);
			this.hasLast = true;
		}
		this.buffer.setEmitterFollow(this.lastEmitter, this.emitter, this.toLocal);
	}

	/** Reads this system's world matrix and each sub-emitter's inverse world matrix. */
	private readEvents(): void {
		const subs = this.options.subEmitters;
		if (!subs || subs.length === 0) return;
		this.buffer.object.getWorldMatrix(this.world as unknown as Mat4Like);
		for (let k = 0; k < subs.length; k++) {
			const child = subs[k] as SubEmitter;
			const local = this.childMatrices[k] as Float64Array;
			if (child.system.destroyed) {
				local.set(IDENTITY);
				continue;
			}
			child.system.object.getWorldMatrix(local as unknown as Mat4Like);
			mat4.invert(local as unknown as Mat4Like, local as unknown as Mat4Like);
		}
		this.buffer.setEmitterEvents(this.world, this.childMatrices);
	}

	/** Removes the system and its particles from the scene. */
	destroy(): void {
		this.destroyed = true;
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
