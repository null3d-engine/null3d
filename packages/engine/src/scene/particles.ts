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
import type { Vec3Like } from '../math/types';
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

/**
 * A particle buffer: a scene object that draws a quad for each live particle record. The
 * particles add-on's emitters write records into it. Write a particle's record once, when it is
 * born, with `write`. The GPU moves it and changes its look as it ages, as the buffer's values
 * say. It stops drawing the particle at the end of its lifetime. Once per frame, write the
 * buffer's time and the records the GPU reads into `frame`, and call `commit`. Every call takes
 * typed arrays and whole numbers, so a frame's calls allocate nothing.
 *
 * @category api/particles
 */
export class ParticleBuffer implements ViewHolder {
	private generation = -1;
	private floats!: Float32Array;
	private words!: Uint32Array;
	private block!: Float32Array;
	private frameValues!: Float32Array;
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
	 * its particles, then how many records from the first the GPU reads, at most the capacity.
	 */
	get frame(): Float32Array {
		this.views();
		return this.frameValues;
	}

	/** Sends the records written since the last call to the GPU with the next frame. Call it once per frame. */
	commit(): void {
		this.mark();
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
		this.core.glue.markParticleValues(this.id);
	}

	/** @internal Writes every value's default, then `values`. */
	reset(values: ParticleValues): void {
		this.views();
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

	/** Removes the buffer and its object from the scene. Its arrays then throw at their next use. */
	destroy(): void {
		if (!this.live) return;
		this.live = false;
		this.generation = -1;
		this.core.glue.destroyParticles(this.id);
		this.object.scene.particleBuffers--;
		this.object.destroy();
	}
}
