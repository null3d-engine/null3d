// Particle buffers: the engine's side of particle systems, which the particles add-on drives. A
// buffer is a scene object whose material has the particle shading, and a table of particle records
// in engine memory. The sketch writes a particle's record once, when the particle is born: its birth
// place and time, its start velocity, its lifetime and a seed. The particle shaders then work out
// each particle at its age in every frame, in closed form, from the buffer's values: the motion
// (gravity, drag toward the wind, turbulence and the ground) and the look (sizes, spin, colors and
// curves over life, a flipbook). So a frame uploads only the records of the particles born since
// the frame before, and no pass simulates them, on any GPU path.
//
// `scene.createParticleBuffer` imports this module the first time, so a page without particles
// downloads none of it. Like the sprite code, it imports no engine module but constants and types.

import * as C from '../generated/core';
import type { Mat4Like, Vec3Like } from '../math/types';
import type { ColorInput } from './color';
import type { CoreMemory, ViewHolder } from './memory';
import type { Mesh } from './scene';
import type { Texture } from './textures';

/**
 * How the particles of a buffer move: closed-form motion that the GPU works out at each
 * particle's age. Every vector is in the space of the buffer's object.
 *
 * @category api/particles
 */
export interface ParticleMotion {
	/** The acceleration of gravity, in meters per second squared. The default is none. */
	gravity?: Vec3Like;
	/**
	 * How fast the particles take on the wind's velocity, per second. 0 keeps their own; 2 loses
	 * most of the difference in about a second. The default is 0.
	 */
	drag?: number;
	/** The velocity that drag pulls the particles toward, in meters per second. The default is still air. */
	wind?: Vec3Like;
	/**
	 * How far simplex noise moves each particle from its path, in meters. Each particle starts on its
	 * path and wanders as it ages. The default is 0, for none.
	 */
	turbulence?: number;
	/** The size of the turbulence's swirls, as a frequency in swirls per meter. The default is 1. */
	turbulenceScale?: number;
	/** How fast the turbulence changes along a particle's life, per second. The default is 1. */
	turbulenceSpeed?: number;
	/**
	 * A ground plane at this height, where the particles end, bounce or stop as `groundMode`
	 * says. The default is none.
	 */
	groundHeight?: number;
	/**
	 * What the ground does to a particle that reaches it: `kill` ends it, `bounce` bounces it up to
	 * twice and then stops it, and `stick` stops it. The default is `bounce`.
	 */
	groundMode?: ParticleGroundMode;
	/** The share of the speed off the ground that a bounce keeps, from 0 to 1. The default is 0.4. */
	restitution?: number;
	/** The share of the speed along the ground that a bounce loses, from 0 to 1. The default is 0.2. */
	friction?: number;
}

/**
 * What the ground does to a particle that reaches it.
 *
 * @category api/particles
 */
export type ParticleGroundMode = 'kill' | 'bounce' | 'stick';

/**
 * How the particles' quads turn. With `camera`, a quad faces the camera. With `velocity`, it lies
 * along the particle's motion and stretches with its speed, as sparks and rain do. With `ground`,
 * it lies flat on the object's ground plane, as ripples do. With `tumble`, it turns freely about an
 * axis of its own, as leaves do.
 *
 * @category api/particles
 */
export type ParticleFacing = 'camera' | 'velocity' | 'ground' | 'tumble';

/**
 * A flipbook: a grid of frames in the buffer's map, which each particle plays through.
 *
 * @category api/particles
 */
export interface ParticleFlipbook {
	/** The frames across the map. */
	columns: number;
	/** The frames down the map. Frame 0 is the top left one, and frames count along each row. */
	rows: number;
	/** The frames to play, from 1 to columns times rows. The default is all of them. */
	frames?: number;
	/** Frames per second, or 0 to play the frames once over each particle's life. The default is 0. */
	fps?: number;
	/** True to start each particle on a random frame. The default is false. */
	randomStart?: boolean;
	/** True to blend each frame into the next, so slow flipbooks play smoothly. The default is true. */
	blend?: boolean;
	/**
	 * True to keep each particle on its first frame, so a flipbook of variants, such as leaves of
	 * several shapes, gives each particle one of them with `randomStart`. The default is false.
	 */
	hold?: boolean;
}

/**
 * How the particles of a buffer look. Colors take a hex string or number in sRGB, or three linear
 * components from 0 to 1. Curves over life give values at even steps from birth to death, which
 * the GPU reads with linear filtering. At most 16 steps keep their place, and a longer curve is
 * resampled to 16.
 *
 * @category api/particles
 */
export interface ParticleLook {
	/** The smallest and the largest size at birth, in meters. Each particle takes a random one. */
	size?: readonly [number, number];
	/** The quad's height over its width. The default is 1. */
	aspect?: number;
	/**
	 * With the `velocity` facing, how much the speed lengthens the quad: the quad grows by the
	 * distance that the particle moves in this many seconds. The default is 0.
	 */
	stretch?: number;
	/** The smallest and the largest turn at birth, in radians. The default is none. */
	rotation?: readonly [number, number];
	/** The smallest and the largest spin, in radians per second. The default is none. */
	spin?: readonly [number, number];
	/** How the quads turn. The default is `camera`. */
	facing?: ParticleFacing;
	/**
	 * The color at birth, or two colors that each particle mixes by a random share. The default is
	 * white.
	 */
	colors?: ColorInput | readonly [ColorInput, ColorInput];
	/** A tint over life, which multiplies the birth color. The default is white throughout. */
	colorOverLife?: readonly ColorInput[];
	/** The alpha over life, from 0 to 1. The default is 1 throughout. */
	alphaOverLife?: readonly number[];
	/** Size over life, steps that multiply the birth size. */
	sizeOverLife?: readonly number[];
	/** A factor on the color, above 1 for light that blooms. The default is 1. */
	intensity?: number;
	/** A factor on the alpha. The default is 1. */
	opacity?: number;
	/** The alpha below which a pixel draws nothing. The default is 0.002. */
	alphaCutoff?: number;
	/** The flipbook of the buffer's map. The default plays its whole map as one frame. */
	flipbook?: ParticleFlipbook;
	/**
	 * The distance over which particles fade out where they near the surfaces behind them, in
	 * meters, so they do not cut lines into the ground or walls. 0 turns it off. The default is 0.
	 */
	softness?: number;
	/**
	 * The distance from the camera inside which particles fade out, in meters, so one never fills
	 * the view. 0 turns it off. The default is 0.
	 */
	nearFade?: number;
}

/**
 * The values of a particle buffer, which `set` changes at any time.
 *
 * @category api/particles
 */
export interface ParticleValues extends ParticleMotion, ParticleLook {}

/**
 * Options of `scene.createParticleBuffer`.
 *
 * @category api/particles
 */
export interface ParticleBufferOptions extends ParticleValues {
	/** The most particles alive at once: the buffer's records, from 1 to 4,194,304. */
	capacity: number;
	/**
	 * How the particles meet what lies behind them: `additive` adds their light, for fire, sparks
	 * and glows, and `normal` covers it, for smoke and leaves. The default is `additive`.
	 */
	blending?: 'normal' | 'additive';
	/**
	 * A map whose color and alpha multiply each particle's, or a flipbook's frames with `flipbook`.
	 * Without one, each particle is a soft round dot.
	 */
	map?: Texture;
	/** The layers the particles draw on. The default is the default layer. */
	layers?: number;
}

/**
 * Where an emitter's particles are born, in its own space, and which way they set off. A `point`
 * emits at the emitter, along `direction`. A `sphere` emits inside a ball of `radius`, or on its
 * surface with `surface`, and sends particles outward. A `cone` emits on a disc of `radius` across
 * the emitter's +y axis. It sends particles up within `angle` radians of that axis. A `box` emits
 * inside a box of `size`, centered on the emitter, along `direction`. A `disc` emits on a disc of
 * `radius` across the +y axis, along `direction`.
 *
 * @category api/particles
 */
export type ParticleEmitterShape =
	| { type: 'point' }
	| { type: 'sphere'; radius: number; surface?: boolean }
	| { type: 'cone'; radius: number; angle: number }
	| { type: 'box'; size: Vec3Like }
	| { type: 'disc'; radius: number };

/**
 * A burst of an emitter: `count` particles at once, at `time` seconds after the system starts,
 * then every `interval` seconds, `cycles` times in all.
 *
 * @category api/particles
 */
export interface ParticleEmitterBurst {
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
 * A sub-emitter of an emitter: another particle buffer that bursts where a particle of this one
 * dies or first meets the ground.
 *
 * @category api/particles
 */
export interface ParticleEmitterSub {
	/** The buffer that bursts. */
	buffer: ParticleBuffer;
	/** `death` at the end of the particle's life, or `ground` where it first meets the ground. */
	on: 'death' | 'ground';
	/** The particles of each burst. */
	count: number;
	/** The share of the particle's velocity that the burst's particles take on. The default is 0. */
	inheritVelocity?: number;
}

/**
 * What an emitter writes, and the settings that the core keeps to write its births. The core
 * makes a frame's records in one call from these numbers, so no per-birth loop runs in TypeScript.
 *
 * @category api/particles
 */
export interface ParticleEmitterOptions {
	/** The seed of the emitter's random numbers. Emitters with the same seed emit the same particles. */
	seed?: number;
	/** Where the particles are born. The default is a point. */
	shape?: ParticleEmitterShape;
	/** The way particles set off from a point, box or disc, in the emitter's space. The default is up. */
	direction?: Vec3Like;
	/** How far from `direction` particles set off at random, in radians. The default is 0. */
	spread?: number;
	/** The smallest and the largest start speed, in meters per second. The default is 1. */
	speed?: readonly [number, number];
	/** A velocity that every particle adds to its own at birth, in meters per second. */
	velocity?: Vec3Like;
	/** The smallest and the largest lifetime, in seconds. The default is 1. */
	lifetime?: readonly [number, number];
	/** Bursts of particles at set times. */
	bursts?: readonly ParticleEmitterBurst[];
	/**
	 * Seconds that the emitter emits for. With `loop`, it starts again after it; without, it stops.
	 * The default is no end.
	 */
	duration?: number;
	/** True to start again after `duration`. The default is true. */
	loop?: boolean;
	/** True when particles move with a followed object, which `setEmitterFollow` places. */
	follow?: boolean;
	/** Buffers that burst where this emitter's particles die or meet the ground. */
	subEmitters?: readonly ParticleEmitterSub[];
}

/** The places of a particle emitter's block, which the core reads. */
const E = {
	rate: 0,
	emitting: 1,
	from: 2,
	to: 3,
	time: 4,
	prewarm: 5,
	atFlag: 6,
	at: 7,
	velocityFlag: 10,
	velocity: 11,
	bursts: 14,
	subs: 15,
	last: 16,
	now: 32,
	toLocal: 48,
	world: 64,
	box: 80,
	emitted: 86,
	rows: 88,
} as const;

/** The places of an emitter's fixed settings, after the bursts' and sub-emitters' rows. */
const F = {
	seed: 0,
	shape: 1,
	radius: 2,
	surface: 3,
	angle: 4,
	size: 5,
	speed: 8,
	lifetime: 10,
	velocityFlag: 12,
	velocity: 13,
	frame: 16,
	spread: 25,
	duration: 26,
	loop: 27,
	follow: 28,
	motion: 29,
} as const;

/** The shape codes that the core reads. */
const SHAPES = { point: 0, sphere: 1, cone: 2, box: 3, disc: 4 } as const;

/** The frame of directions about up, for a cone. */
const IDENTITY = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Drag below which a particle's motion is the plain ballistic one. */
const LITTLE_DRAG = 1e-4;

/** The motion of an emitter's particles, which its events use and its bounds grow by. */
interface MotionValues {
	gx: number;
	gy: number;
	gz: number;
	drag: number;
	wx: number;
	wy: number;
	wz: number;
	turbulence: number;
	turbulenceScale: number;
	turbulenceSpeed: number;
	groundHeight: number;
	groundMode: number;
	restitution: number;
	friction: number;
}

/** A new motion at rest. */
function stillMotion(): MotionValues {
	return {
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
		groundMode: 0,
		restitution: 0.4,
		friction: 0.2,
	};
}

/** How far a particle may move from its birth place in `lifetime` seconds at `speed`. */
function reach(m: MotionValues, speed: number, lifetime: number): number {
	const g = Math.sqrt(m.gx * m.gx + m.gy * m.gy + m.gz * m.gz);
	const turbulence = 2 * m.turbulence;
	if (m.drag < LITTLE_DRAG) return speed * lifetime + 0.5 * g * lifetime * lifetime + turbulence;
	const tx = m.wx + m.gx / m.drag;
	const ty = m.wy + m.gy / m.drag;
	const tz = m.wz + m.gz / m.drag;
	const end = Math.sqrt(tx * tx + ty * ty + tz * tz);
	const settle = Math.min(lifetime, 1 / m.drag);
	return end * lifetime + (speed + end) * settle + turbulence;
}

/** The places of the values in a buffer's block of values, which the particle shaders read. */
const V = {
	gravity: 0,
	drag: 3,
	wind: 4,
	turbulence: 7,
	turbulenceScale: 8,
	turbulenceSpeed: 9,
	groundHeight: 10,
	groundMode: 11,
	restitution: 12,
	friction: 13,
	nearFade: 14,
	softness: 15,
	size: 16,
	aspect: 18,
	stretch: 19,
	rotation: 20,
	spin: 22,
	flipbook: 24,
	facing: 28,
	intensity: 29,
	opacity: 30,
	alphaCutoff: 31,
	colorA: 32,
	colorB: 36,
	randomStart: 40,
	blendFrames: 41,
	additive: 42,
	holdFrame: 43,
	colorOverLife: 48,
	sizeOverLife: 112,
} as const;

/** The steps of a curve over life. */
const CURVE_STEPS = 16;

/** The ground's modes, by name: 0 is no ground. */
const GROUND_MODES: Readonly<Record<ParticleGroundMode, number>> = { kill: 1, bounce: 2, stick: 3 };

/** The facings, by name. */
const FACINGS: Readonly<Record<ParticleFacing, number>> = {
	camera: 0,
	velocity: 1,
	ground: 2,
	tumble: 3,
};

/** A 32-bit float and its bits, to pack a lifetime as a 16-bit float. */
const scratch = new Float32Array(1);
const scratchBits = new Uint32Array(scratch.buffer);

/** Writes up to three numbers of `v` into `b` from `at`, when `v` is given. */
function putVector(
	b: Float32Array,
	at: number,
	v: Vec3Like | readonly number[] | undefined,
	n = 3,
) {
	if (!v) return;
	for (let k = 0; k < n; k++) b[at + k] = v[k] as number;
}

/** Writes a 4 by 4 matrix into `b` at `at`. */
function putMatrix(b: Float64Array, at: number, m: Mat4Like): void {
	for (let k = 0; k < 16; k++) b[at + k] = m[k] as number;
}

/** Writes `v` into `b` at `at`, when it is given. */
function putNumber(b: Float32Array, at: number, v: number | undefined) {
	if (v !== undefined) b[at] = v;
}

/**
 * Writes a curve of `count` steps into 16 steps from `at`, `stride` floats apart, resampled with
 * linear filtering. `step(i, c)` gives channel `c` of step `i`, for `channels` channels.
 */
function writeCurve(
	values: Float32Array,
	at: number,
	stride: number,
	count: number,
	channels: number,
	step: (i: number, c: number) => number,
): void {
	const last = count - 1;
	for (let k = 0; k < CURVE_STEPS; k++) {
		const x = last <= 0 ? 0 : (k / (CURVE_STEPS - 1)) * last;
		const i = Math.min(Math.floor(x), Math.max(last - 1, 0));
		const t = x - i;
		const j = Math.min(i + 1, last);
		for (let c = 0; c < channels; c++) {
			const a = step(i, c);
			values[at + k * stride + c] = a + (step(j, c) - a) * t;
		}
	}
}

/**
 * @internal The linear color of a color input, which the scene hands the particle code, so it
 * imports no engine module.
 */
export type LinearColor = (color: ColorInput) => readonly [number, number, number];

/** True for one color input, not a pair of them. */
function isOneColor(colors: ColorInput | readonly [ColorInput, ColorInput]): colors is ColorInput {
	return typeof colors !== 'object' || colors.length === 3;
}

/** An empty view that a dropped view takes, so it holds none of the engine's memory. */
const NO_FLOAT32 = new Float32Array(0);
const NO_UINT32 = new Uint32Array(0);
const NO_FLOAT64 = new Float64Array(0);

/**
 * A particle buffer: a scene object that draws a quad for each live particle record. The
 * particles add-on's emitters write records into it. Write a particle's record once, when it is
 * born, with `write`, or write a frame's births in one call with `writeRecords`. The GPU moves it
 * and changes its look as it ages, as the buffer's values say. It stops drawing the particle at
 * the end of its lifetime. Once per frame, write the buffer's time and the records the GPU reads
 * into `frame`, and call `commit`. Every call takes typed arrays and whole numbers, so a frame's
 * calls allocate nothing.
 *
 * @category api/particles
 */
export class ParticleBuffer implements ViewHolder {
	private generation = -1;
	private floats!: Float32Array;
	private words!: Uint32Array;
	private block!: Float32Array;
	private frameValues!: Float32Array;
	/** The core's block of births' parameters, and the address it was at. */
	private birthAddress = 0;
	private birthView: Float32Array = NO_FLOAT32;
	/** The core's block of the emitter's numbers, its size and its address. */
	private emitterAddress = 0;
	private emitterFloats = 0;
	private emitterView: Float64Array = NO_FLOAT64;
	/** The core's block of the sub-emitters' inverse world matrices, and how many it holds. */
	private subAddress = 0;
	private subCount = 0;
	private subView: Float64Array = NO_FLOAT64;
	/** The buffers that burst for this one, and the block's place of their first row. */
	private subBuffers: ParticleBuffer[] = [];
	private subRows = 0;
	/** The emitter's motion as the core's events use it, and how far its particles may move. */
	private motion: MotionValues = stillMotion();
	private grow = 0;
	private emitterSpeed = 1;
	private emitterLifetime = 1;
	private emitterVelocity: Vec3Like | undefined;
	/** The options that made the values, and the values last set. */
	private initial: ParticleValues = {};
	private lastValues: ParticleValues = {};
	/** The culling sphere last given to the object, and the point that carries its center. */
	private readonly bounds = new Float64Array(4);
	private readonly center = [0, 0, 0];
	/** The records written since the last frame and not yet marked, as a start and an end. */
	private start = 0;
	private end = 0;
	private live = true;

	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** @internal The core's id of the particle system. */
		readonly id: number,
		/** The particles that the buffer holds at once. */
		readonly capacity: number,
		/**
		 * The buffer's scene object: place, turn, scale, layers, visibility and bounds. Moving it
		 * moves every particle with it, so emitters that leave particles behind keep it still.
		 */
		readonly object: Mesh,
		private readonly additive: boolean,
		private readonly linear: LinearColor,
	) {
		core.holdViews(this);
	}

	/** Forgets the record and value arrays, which the next read makes again. */
	dropViews(): void {
		if (this.generation === -1) return;
		this.generation = -1;
		this.floats = NO_FLOAT32;
		this.words = NO_UINT32;
		this.block = NO_FLOAT32;
		this.frameValues = NO_FLOAT32;
		this.birthView = NO_FLOAT32;
		this.birthAddress = 0;
		this.emitterView = NO_FLOAT64;
		this.subView = NO_FLOAT64;
	}

	/** The record and value arrays, made again after the engine's memory grew. */
	private views(): void {
		if (this.generation === this.core.generation) return;
		if (!this.live) throw new Error('this particle buffer was destroyed');
		const { core, id } = this;
		const words = this.capacity * (C.PARTICLE_RECORD_BYTES / 4);
		const records = core.glue.particleRecords(id);
		this.floats = core.f32(records, words);
		this.words = core.u32(records, words);
		const values = core.glue.particleValues(id);
		this.block = core.f32(values, C.PARTICLE_PARAM_FLOATS);
		this.frameValues = core.f32(values + C.PARTICLE_PARAM_FLOATS * 4, C.PARTICLE_FRAME_FLOATS);
		this.birthView = NO_FLOAT32;
		this.birthAddress = 0;
		// The core's own blocks stay in one place while the engine's memory grows: only a block
		// that the core sizes again moves, and the emitter's is sized once.
		if (this.emitterAddress !== 0)
			this.emitterView = core.f64(this.emitterAddress, this.emitterFloats);
		if (this.subAddress !== 0)
			this.subView = core.f64(
				this.subAddress,
				this.subCount * C.PARTICLE_EMITTER_SUB_MATRIX_FLOATS,
			);
		this.generation = core.generation;
	}

	/**
	 * Writes the record of particle `index`, from 0 to the capacity. `record` holds eight numbers:
	 * the birth place (x, y, z) in the space of the buffer's object, the birth time in the buffer's
	 * seconds, the velocity (x, y, z), and the lifetime in seconds. `seed`, from 0 to 65,535, picks
	 * the particle's random size, turn, spin, color and first frame.
	 */
	write(index: number, record: ArrayLike<number>, seed: number): void {
		this.views();
		const at = index * 8;
		const f = this.floats;
		for (let k = 0; k < 7; k++) f[at + k] = record[k] as number;
		// The lifetime as the 16-bit float nearest below it, at most the largest finite one.
		scratch[0] = record[7] as number;
		const bits = scratchBits[0] as number;
		const exponent = ((bits >>> 23) & 0xff) - 112;
		const half =
			exponent <= 0 ? 0 : exponent >= 31 ? 0x7bff : (exponent << 10) | ((bits >>> 13) & 0x3ff);
		this.words[at + 7] = (half << 16) | (seed & 0xffff);
		if (index === this.end) this.end++;
		else {
			this.mark();
			this.start = index;
			this.end = index + 1;
		}
	}

	/**
	 * Writes `count` records from a block of birth parameters, from record `first` on, in one call
	 * into the core, which packs them and marks the ranges it wrote. The block holds nine numbers
	 * for each birth, in the order that `write` takes them: the birth place, the birth time, the
	 * velocity, the lifetime, then the seed. Pass the whole block that the births fill, so the
	 * core's room for it stays the same from frame to frame.
	 */
	writeRecords(block: Float32Array, count: number, first: number): void {
		if (count <= 0 || block.length < count * C.PARTICLE_BIRTH_FLOATS) return;
		this.views();
		// Records that `write` wrote are marked before the core's own range.
		this.mark();
		const births = Math.floor(block.length / C.PARTICLE_BIRTH_FLOATS);
		// The core's room for the block may grow the engine's memory, so the views are made again
		// from the new buffer before the block is written.
		const address = this.core.checkGrowth(
			this.core.glue.particleRecordBlock(births),
			'writeRecords',
			'the particle record block',
		);
		this.views();
		if (address !== this.birthAddress || this.birthView.length !== block.length) {
			this.birthAddress = address;
			this.birthView = this.core.f32(address, block.length);
		}
		this.birthView.set(block);
		this.core.glue.writeParticleRecords(this.id, count, first);
	}

	/**
	 * Takes whole `seconds` off the birth times of records `from` to `to`, which moves the time
	 * that they count from, and marks them. The GPU takes the shift off the birth times that the
	 * move has not reached.
	 */
	shiftRecords(from: number, to: number, seconds: number): void {
		if (from >= to) return;
		this.views();
		this.core.glue.shiftParticleRecords(this.id, from, to, seconds);
	}

	/**
	 * Reads the record of particle `index` into `out`: its birth place and time, its velocity, its
	 * lifetime, as the GPU reads them, and its seed.
	 */
	read(index: number, out: Float32Array): void {
		this.views();
		const at = index * 8;
		for (let k = 0; k < 7; k++) out[k] = this.floats[at + k] as number;
		const half = (this.words[at + 7] as number) >>> 16;
		const exponent = half >>> 10;
		out[7] = exponent === 0 ? 0 : 2 ** (exponent - 15) * (1 + (half & 0x3ff) / 1024);
		out[8] = (this.words[at + 7] as number) & 0xffff;
	}

	/** Marks the records written since the last mark for the next frame's upload. */
	private mark(): void {
		if (this.end > this.start)
			this.core.glue.markParticleRecords(this.id, this.start, this.end - this.start);
		this.start = this.end = 0;
	}

	/**
	 * The frame's values, which the GPU reads in each frame: the buffer's time in seconds, which ages
	 * its particles, then how many records from the first the GPU reads, at most the capacity. Then
	 * a record and a number of seconds, which the GPU takes off the birth times of the records from
	 * that one up. An emitter that moves the time its birth times count from writes the shift
	 * there, and rewrites the records a share at a time, so no frame uploads them all.
	 */
	get frame(): Float32Array {
		this.views();
		return this.frameValues;
	}

	/** Sends the records written since the last call to the GPU with the next frame. Call it once per frame. */
	commit(): void {
		this.mark();
	}

	/**
	 * Gives the core the emitter's settings and starts its birth schedule, its time base and its
	 * events again. From then on the core writes every record that the emitter makes, so the
	 * sketch starts a frame and reads settings but runs no loop over the births. Call this once,
	 * before the first `emitFrame`.
	 */
	configureEmitter(options: ParticleEmitterOptions): void {
		this.views();
		const core = this.core;
		const bursts = options.bursts ?? [];
		const subs = options.subEmitters ?? [];
		const rows = C.PARTICLE_EMITTER_HEADER_FLOATS;
		const floats =
			rows +
			(bursts.length + subs.length) * C.PARTICLE_EMITTER_ROW_FLOATS +
			C.PARTICLE_EMITTER_FIXED_FLOATS;
		const address = core.checkGrowth(
			core.glue.particleEmitterBlock(this.id, floats),
			'configureEmitter',
			'the particle emitter block',
		);
		this.emitterAddress = address;
		this.emitterFloats = floats;
		const e = core.f64(address, floats);
		this.emitterView = e;
		e[E.bursts] = bursts.length;
		e[E.subs] = subs.length;
		const row = (k: number) => rows + k * C.PARTICLE_EMITTER_ROW_FLOATS;
		for (let k = 0; k < bursts.length; k++) {
			const burst = bursts[k] as ParticleEmitterBurst;
			const at = row(k);
			e[at] = burst.time;
			e[at + 1] = burst.count;
			e[at + 2] = burst.interval ?? Number.NaN;
			e[at + 3] = burst.cycles ?? Number.NaN;
		}
		for (let k = 0; k < subs.length; k++) {
			const sub = subs[k] as ParticleEmitterSub;
			const at = row(bursts.length + k);
			e[at] = sub.buffer.id;
			e[at + 1] = sub.on === 'ground' ? 1 : 0;
			e[at + 2] = sub.count;
			e[at + 3] = sub.inheritVelocity ?? 0;
		}
		this.subBuffers = subs.map((sub) => sub.buffer);
		this.subRows = row(bursts.length);
		const f = rows + (bursts.length + subs.length) * C.PARTICLE_EMITTER_ROW_FLOATS;
		const shape = options.shape ?? { type: 'point' };
		e[f + F.seed] = options.seed ?? 1;
		e[f + F.shape] = SHAPES[shape.type];
		e[f + F.radius] = 'radius' in shape ? shape.radius : 0;
		e[f + F.surface] = shape.type === 'sphere' && shape.surface ? 1 : 0;
		e[f + F.angle] = shape.type === 'cone' ? shape.angle : 0;
		if (shape.type === 'box') {
			for (let k = 0; k < 3; k++) e[f + F.size + k] = shape.size[k] as number;
		}
		const speed = options.speed ?? [1, 1];
		e[f + F.speed] = speed[0] as number;
		e[f + F.speed + 1] = speed[1] as number;
		const lifetime = options.lifetime ?? [1, 1];
		e[f + F.lifetime] = lifetime[0] as number;
		e[f + F.lifetime + 1] = lifetime[1] as number;
		const velocity = options.velocity;
		e[f + F.velocityFlag] = velocity ? 1 : 0;
		if (velocity) for (let k = 0; k < 3; k++) e[f + F.velocity + k] = velocity[k] as number;
		const frame = this.directionFrame(options.direction);
		for (let k = 0; k < 9; k++) e[f + F.frame + k] = frame[k] as number;
		e[f + F.spread] = options.spread ?? 0;
		e[f + F.duration] = options.duration ?? Number.POSITIVE_INFINITY;
		e[f + F.loop] = options.loop === false ? 0 : 1;
		e[f + F.follow] = options.follow ? 1 : 0;
		const m = this.motion;
		e[f + F.motion] = m.gx;
		e[f + F.motion + 1] = m.gy;
		e[f + F.motion + 2] = m.gz;
		e[f + F.motion + 3] = m.drag;
		e[f + F.motion + 4] = m.wx;
		e[f + F.motion + 5] = m.wy;
		e[f + F.motion + 6] = m.wz;
		e[f + F.motion + 7] = m.turbulence;
		e[f + F.motion + 8] = m.turbulenceScale;
		e[f + F.motion + 9] = m.turbulenceSpeed;
		e[f + F.motion + 10] = m.groundHeight;
		e[f + F.motion + 11] = m.groundMode;
		e[f + F.motion + 12] = m.restitution;
		e[f + F.motion + 13] = m.friction;
		core.glue.configureParticleEmitter(this.id);
		this.subCount = subs.length;
		const subAddress = core.glue.particleSubMatrices(this.id);
		this.subAddress = subAddress;
		this.subView =
			subAddress === 0
				? NO_FLOAT64
				: core.f64(subAddress, subs.length * C.PARTICLE_EMITTER_SUB_MATRIX_FLOATS);
		this.emitterSpeed = speed[1] as number;
		this.emitterLifetime = lifetime[1] as number;
		this.emitterVelocity = velocity;
		this.updateGrow(this.lastValues.size?.[1], this.lastValues.aspect);
	}

	/** The axes of the frame whose y axis is the emitter's direction, as three columns. */
	private directionFrame(direction: Vec3Like | undefined): ArrayLike<number> {
		if (!direction) return IDENTITY;
		// t = normalize(cross(a, n)) and b = cross(n, t), for n the direction and a an axis apart.
		const [dx, dy, dz] = [direction[0] as number, direction[1] as number, direction[2] as number];
		const len = Math.hypot(dx, dy, dz) || 1;
		const [nx, ny, nz] = [dx / len, dy / len, dz / len];
		const [ax, ay, az] = Math.abs(ny) < 0.99 ? [0, 1, 0] : [1, 0, 0];
		const [cx, cy, cz] = [ay * nz - az * ny, az * nx - ax * nz, ax * ny - ay * nx];
		const tl = Math.hypot(cx, cy, cz) || 1;
		const [tx, ty, tz] = [cx / tl, cy / tl, cz / tl];
		const bx = ny * tz - nz * ty;
		const by = nz * tx - nx * tz;
		const bz = nx * ty - ny * tx;
		return [tx, ty, tz, nx, ny, nz, bx, by, bz];
	}

	/**
	 * Places the followed object's world matrix in this frame and in the frame before, and this
	 * buffer's inverse world matrix, for the births that it follows.
	 */
	setEmitterFollow(last: Mat4Like, now: Mat4Like, toLocal: Mat4Like): void {
		this.views();
		const e = this.emitterView;
		putMatrix(e, E.last, last);
		putMatrix(e, E.now, now);
		putMatrix(e, E.toLocal, toLocal);
	}

	/**
	 * Gives this buffer's world matrix and each sub-emitter's inverse world matrix for the frame's
	 * events, in the order that the sub-emitters were configured.
	 */
	setEmitterEvents(world: Mat4Like, children: readonly Mat4Like[]): void {
		this.views();
		putMatrix(this.emitterView, E.world, world);
		const s = this.subView;
		const count = Math.min(children.length, this.subCount);
		for (let k = 0; k < count; k++)
			putMatrix(s, k * C.PARTICLE_EMITTER_SUB_MATRIX_FLOATS, children[k] as Mat4Like);
	}

	/**
	 * Emits the emitter's particles for one frame, fires the sub-emitters that fall due, and
	 * moves the time base when the time calls for it. The core writes the records, so this call
	 * runs no per-birth loop. Call it once per frame, after `numbers` holds the frame's start and
	 * end in seconds, its rate, and 1 or 0 for whether it emits and whether it is the first frame
	 * of a prewarmed system. The numbers cross in a typed array, so no fraction crosses as a
	 * call argument, which the browser would box.
	 */
	emitFrame(numbers: Float64Array): void {
		this.views();
		const e = this.emitterView;
		// A buffer that the sketch destroyed bursts nothing, and its id may name a new system.
		for (let k = 0; k < this.subBuffers.length; k++) {
			const child = this.subBuffers[k] as ParticleBuffer;
			e[this.subRows + k * C.PARTICLE_EMITTER_ROW_FLOATS] = child.live ? child.id : 0;
		}
		e[E.rate] = numbers[2] as number;
		e[E.emitting] = numbers[3] as number;
		e[E.from] = numbers[0] as number;
		e[E.to] = numbers[1] as number;
		e[E.time] = numbers[1] as number;
		e[E.prewarm] = numbers[4] as number;
		this.core.glue.emitParticleFrame(this.id);
		this.updateBounds();
	}

	/**
	 * Emits `count` particles at once, at the emitter, or at `at` in the buffer's space with the
	 * shape's spread around it. Each particle adds `velocity` to its own start velocity, in place
	 * of the emitter's `velocity` option.
	 */
	emitBurst(count: number, at?: Vec3Like, velocity?: Vec3Like): void {
		this.views();
		const e = this.emitterView;
		e[E.atFlag] = at ? 1 : 0;
		if (at) for (let k = 0; k < 3; k++) e[E.at + k] = at[k] as number;
		e[E.velocityFlag] = velocity ? 1 : 0;
		if (velocity) for (let k = 0; k < 3; k++) e[E.velocity + k] = velocity[k] as number;
		this.core.glue.burstParticles(this.id, count);
	}

	/** The particles that the emitter has made so far. */
	get emitted(): number {
		this.views();
		return this.emitterView[E.emitted] as number;
	}

	/**
	 * Gives the object a culling sphere around every live particle: the births of this span of
	 * the longest lifetime and the one before, grown by how far a particle can move. The core
	 * keeps the births' box and turns it as the lifetimes pass.
	 */
	private updateBounds(): void {
		const e = this.emitterView;
		const o = this.bounds;
		const center = this.center;
		let squared = 0;
		let moved = 0;
		for (let c = 0; c < 3; c++) {
			const low = e[E.box + c] as number;
			const high = e[E.box + 3 + c] as number;
			if (!(low <= high)) return;
			const middle = (low + high) / 2;
			squared += (high - middle) * (high - middle);
			moved += (middle - (o[c] as number)) * (middle - (o[c] as number));
			center[c] = middle;
		}
		const radius = Math.sqrt(squared) + this.grow;
		const kept = o[3] as number;
		if (Math.sqrt(moved) + radius <= kept && radius > kept * 0.8) return;
		for (let c = 0; c < 3; c++) o[c] = center[c] as number;
		o[3] = radius;
		this.object.setBounds(center, radius);
	}

	/** How far a particle may move, which the culling sphere grows by. */
	private updateGrow(size: number | undefined, aspect: number | undefined): void {
		const add = this.emitterVelocity;
		const extra = add ? Math.hypot(add[0] as number, add[1] as number, add[2] as number) : 0;
		const high = Math.max(size ?? 0, this.initial.size?.[1] ?? 0.1);
		const ratio = Math.max(1, aspect ?? this.initial.aspect ?? 1);
		this.grow = reach(this.motion, this.emitterSpeed + extra, this.emitterLifetime) + high * ratio;
	}

	/** Keeps the emitter's copy of the motion in step with the buffer's values. */
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
			if (m.groundMode === 0) m.groundMode = GROUND_MODES.bounce;
		}
		if (values.groundMode) m.groundMode = GROUND_MODES[values.groundMode];
		m.restitution = values.restitution ?? m.restitution;
		m.friction = values.friction ?? m.friction;
		this.lastValues = values;
		this.updateGrow(values.size?.[1], values.aspect);
	}

	/** Changes the values that `values` gives, from the next frame on; the rest keep theirs. */
	set(values: ParticleValues): void {
		this.views();
		const b = this.block;
		putVector(b, V.gravity, values.gravity);
		putNumber(b, V.drag, values.drag);
		putVector(b, V.wind, values.wind);
		putNumber(b, V.turbulence, values.turbulence);
		putNumber(b, V.turbulenceScale, values.turbulenceScale);
		putNumber(b, V.turbulenceSpeed, values.turbulenceSpeed);
		if (values.groundHeight !== undefined) {
			b[V.groundHeight] = values.groundHeight;
			if (b[V.groundMode] === 0) b[V.groundMode] = GROUND_MODES.bounce;
		}
		if (values.groundMode !== undefined) b[V.groundMode] = GROUND_MODES[values.groundMode];
		putNumber(b, V.restitution, values.restitution);
		putNumber(b, V.friction, values.friction);
		putNumber(b, V.nearFade, values.nearFade);
		putNumber(b, V.softness, values.softness);
		putVector(b, V.size, values.size, 2);
		putNumber(b, V.aspect, values.aspect);
		putNumber(b, V.stretch, values.stretch);
		putVector(b, V.rotation, values.rotation, 2);
		putVector(b, V.spin, values.spin, 2);
		if (values.facing !== undefined) b[V.facing] = FACINGS[values.facing];
		putNumber(b, V.intensity, values.intensity);
		putNumber(b, V.opacity, values.opacity);
		putNumber(b, V.alphaCutoff, values.alphaCutoff);
		const { colors } = values;
		if (colors !== undefined) {
			const one = isOneColor(colors);
			b.set(this.linear(one ? colors : colors[0]), V.colorA);
			b.set(this.linear(one ? colors : colors[1]), V.colorB);
		}
		const tint = values.colorOverLife?.map(this.linear);
		if (tint) writeCurve(b, V.colorOverLife, 4, tint.length, 3, (i, c) => tint[i]?.[c] ?? 1);
		const alpha = values.alphaOverLife;
		if (alpha) writeCurve(b, V.colorOverLife + 3, 4, alpha.length, 1, (i) => alpha[i] ?? 1);
		const size = values.sizeOverLife;
		if (size) writeCurve(b, V.sizeOverLife, 1, size.length, 1, (i) => size[i] ?? 1);
		const book = values.flipbook;
		if (book) {
			b[V.flipbook] = book.columns;
			b[V.flipbook + 1] = book.rows;
			b[V.flipbook + 2] = book.frames ?? book.columns * book.rows;
			b[V.flipbook + 3] = book.fps ?? 0;
			b[V.randomStart] = book.randomStart ? 1 : 0;
			b[V.blendFrames] = book.blend === false || book.hold ? 0 : 1;
			b[V.holdFrame] = book.hold ? 1 : 0;
		}
		this.readMotion(values);
		this.core.glue.markParticleValues(this.id);
	}

	/** @internal Writes every value's default, then `values`. */
	reset(values: ParticleValues): void {
		this.views();
		this.initial = values;
		this.motion = stillMotion();
		const b = this.block;
		b.fill(0, 0, C.PARTICLE_PARAM_FLOATS);
		b[V.turbulenceScale] = 1;
		b[V.turbulenceSpeed] = 1;
		b[V.restitution] = 0.4;
		b[V.friction] = 0.2;
		b[V.size] = b[V.size + 1] = 0.1;
		b[V.aspect] = 1;
		b[V.flipbook] = b[V.flipbook + 1] = b[V.flipbook + 2] = 1;
		b[V.blendFrames] = 1;
		b[V.intensity] = 1;
		b[V.opacity] = 1;
		b[V.alphaCutoff] = 0.002;
		b.fill(1, V.colorA, V.colorB + 4);
		b.fill(1, V.colorOverLife, V.sizeOverLife + CURVE_STEPS);
		b[V.additive] = this.additive ? 1 : 0;
		this.set(values);
	}

	/**
	 * Removes the buffer and its object from the scene. It drops its views, so a destroyed buffer
	 * that the sketch still holds keeps none of the engine's memory, and its arrays throw at their
	 * next use.
	 */
	destroy(): void {
		if (!this.live) return;
		this.live = false;
		this.emitterAddress = 0;
		this.subAddress = 0;
		this.dropViews();
		this.core.glue.destroyParticles(this.id);
		this.object.scene.particleBuffers--;
		this.object.destroy();
	}
}
