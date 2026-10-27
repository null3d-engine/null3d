// Property animation: the keyframes that move one value of a light, a camera, a material or an
// object, and the players that sample them each frame. A glTF file's `KHR_animation_pointer`
// channels become tracks of a clip, which the model's animator plays with the clip's other tracks,
// so a property follows the clip's time, speed, fades and weights. A sketch starts one with
// `scene.animateProperty`.
//
// A clip's property tracks render on the sketch's thread, after the job workers advanced the clips:
// each reads the clip time and weight of every sample slot, mixes the tracks by those weights, and
// writes the mixed value through the target's ordinary setter. The rest of a blend's weight goes to
// the value that the file gave the property, as three.js's mixer mixes a clip at less than full
// weight with the value that the property had when its action started. Sampling and writing
// allocate nothing, so a track costs a few key lookups a frame.

import { slerp } from '../math/quat';

/** A material's value, named by its binding's `name`. */
export const PROPERTY_MATERIAL = 0;
export const PROPERTY_LIGHT_INTENSITY = 1;
export const PROPERTY_LIGHT_COLOR = 2;
export const PROPERTY_LIGHT_RANGE = 3;
export const PROPERTY_LIGHT_DECAY = 4;
export const PROPERTY_LIGHT_ANGLE = 5;
export const PROPERTY_LIGHT_PENUMBRA = 6;
export const PROPERTY_CAMERA_FOV = 7;
export const PROPERTY_CAMERA_NEAR = 8;
export const PROPERTY_CAMERA_FAR = 9;
export const PROPERTY_CAMERA_HEIGHT = 10;
export const PROPERTY_POSITION = 11;
export const PROPERTY_ROTATION = 12;
export const PROPERTY_SCALE = 13;
export const PROPERTY_VISIBLE = 14;

/**
 * How a track's value moves between its keys: in a straight line (the default), held until the
 * next key (`'step'`), or along glTF's cubic spline (`'cubic'`).
 *
 * @category api/animation
 */
export type PropertyInterpolation = 'linear' | 'step' | 'cubic';

/**
 * The keyframes of one property: the time of each key in seconds, and the value of each key. A key
 * holds one number for a value such as an intensity, three for a color or a position, and four for
 * a rotation as a quaternion `[x, y, z, w]`. A cubic key holds three times as many numbers: an
 * in-tangent, the value and an out-tangent.
 *
 * @category api/animation
 */
export interface PropertyKeyframes {
	/** The key times in seconds, in order, never falling back. */
	times: ArrayLike<number>;
	/** The values of the keys, one key after another. */
	values: ArrayLike<number>;
	/** How the value moves between keys: `'linear'` (the default), `'step'` or `'cubic'`. */
	interpolation?: PropertyInterpolation;
	/** True, the default, repeats the animation. False plays it once and holds its last key. */
	loop?: boolean;
	/** The rate of the animation's time: 1, the default, plays it as made, and 2 twice as fast. */
	speed?: number;
	/** The time in seconds at which the animation starts, or its first key. */
	time?: number;
	/** True starts the animation paused. */
	paused?: boolean;
}

/**
 * A property that tracks animate: which value it is, the name that a material knows it by, how many
 * numbers a key holds, and the value that the file gave it, which a blend at less than full weight
 * mixes with.
 *
 * @category api/animation
 */
export interface PropertyBinding {
	/** The value of the target that the tracks write, one of the `PROPERTY_*` names. */
	what: number;
	/** A material value's name, such as `'opacity'`; empty for the other kinds of target. */
	name: string;
	/** Numbers per key: 1 for a number, 3 for a color, a position or a scale, 4 for a rotation. */
	components: number;
	/** The value before any animation moves it, `components` numbers. */
	base: Float32Array;
	/**
	 * The map slot whose texture transform the value moves, for a material's offset and scale: one
	 * map's where a file's pointer names it, and every map's when it is left out.
	 */
	slot?: number;
}

/** One track of a clip: the keys of one property, and the binding that names the property. */
export interface PropertyTrack {
	/** The binding whose property the track writes, by its index in the data's binding list. */
	binding: number;
	interpolation: PropertyInterpolation;
	times: Float32Array;
	values: Float32Array;
}

/** The property tracks of each clip, by the clip's id in the core minus one. */
export type PropertyClipTracks = readonly (readonly PropertyTrack[] | undefined)[];

/**
 * The clip times and weights that tracks follow: the animation table's sample slots, which the job
 * workers advance. The players read them again each frame, because a growth of the engine's memory
 * moves them.
 */
export interface SlotSource {
	/** The clip of each sample slot, or `ANIMATION_NO_SOURCE`. */
	slotSources(): Uint32Array;
	/** The time of each sample slot, in seconds. */
	slotTimes(): Float32Array;
	/** The weight of each sample slot. */
	slotWeights(): Float32Array;
}

/** The player of one animated object's clips, whose class lives with the animator. */
export interface PropertyStepper {
	/** Samples the playing clips and writes each property that they move. */
	step(write: PropertyWriter): void;
}

/** Writes a property of a target from the sample at `at`, mixed with its base by `weight`. */
export type PropertyWriter = (
	target: object,
	binding: PropertyBinding,
	values: Float32Array,
	at: number,
	weight: number,
) => void;

/** The rotation keys of one sample, which `slerp` mixes. */
const ROTATION_A = new Float64Array(4);
const ROTATION_B = new Float64Array(4);

/**
 * Writes one sample of `track` at `time` seconds into `out` from `at`. A time outside the keys
 * gives the first or the last key. Two rotation keys turn along the shorter arc between them, as
 * three.js's quaternion tracks do.
 */
export function sample(
	track: PropertyTrack,
	binding: PropertyBinding,
	time: number,
	out: Float32Array,
	at: number,
): void {
	const { times, values } = track;
	const keys = times.length;
	if (keys === 0) return;
	const components = binding.components;
	// A cubic key holds an in-tangent, the value and an out-tangent; the value sits one group in.
	const cubic = track.interpolation === 'cubic';
	const stride = cubic ? components * 3 : components;
	const valueAt = cubic ? components : 0;
	const last = keys - 1;
	if (!(time > (times[0] as number))) {
		for (let c = 0; c < components; c++) out[at + c] = values[valueAt + c] as number;
		return;
	}
	if (time >= (times[last] as number)) {
		const from = last * stride + valueAt;
		for (let c = 0; c < components; c++) out[at + c] = values[from + c] as number;
		return;
	}
	// The key before the time, by a binary search over the track's keys.
	let low = 0;
	let high = last;
	while (high - low > 1) {
		const middle = (low + high) >>> 1;
		if ((times[middle] as number) <= time) low = middle;
		else high = middle;
	}
	const t0 = times[low] as number;
	const span = (times[high] as number) - t0;
	const p = span > 0 ? (time - t0) / span : 0;
	const from = low * stride;
	if (track.interpolation === 'step') {
		for (let c = 0; c < components; c++) out[at + c] = values[from + c] as number;
		return;
	}
	if (cubic) {
		// glTF's cubic spline between two keys, as three.js's GLTFCubicSplineInterpolant works it
		// out: the two values and the tangents that the keys around them hold, times the span.
		const pp = p * p;
		const ppp = pp * p;
		const s2 = -2 * ppp + 3 * pp;
		const s3 = ppp - pp;
		const s0 = 1 - s2;
		const s1 = s3 - pp + p;
		const next = high * stride;
		for (let c = 0; c < components; c++) {
			const p0 = values[from + components + c] as number;
			const m0 = (values[from + components * 2 + c] as number) * span;
			const p1 = values[next + components + c] as number;
			const m1 = (values[next + c] as number) * span;
			out[at + c] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1;
		}
		if (binding.what === PROPERTY_ROTATION) normalise(out, at, 4);
		return;
	}
	if (binding.what === PROPERTY_ROTATION) {
		for (let c = 0; c < 4; c++) {
			ROTATION_A[c] = values[from + c] as number;
			ROTATION_B[c] = values[from + stride + c] as number;
		}
		slerp(ROTATION_A, ROTATION_A, ROTATION_B, p);
		for (let c = 0; c < 4; c++) out[at + c] = ROTATION_A[c] as number;
		return;
	}
	for (let c = 0; c < components; c++) {
		const a = values[from + c] as number;
		const b = values[from + stride + c] as number;
		out[at + c] = a + (b - a) * p;
	}
}

/** Divides the `count` numbers at `at` by their length, so a rotation stays a unit quaternion. */
function normalise(values: Float32Array, at: number, count: number): void {
	let length = 0;
	for (let c = 0; c < count; c++) length += (values[at + c] as number) ** 2;
	length = Math.sqrt(length);
	if (length === 0) {
		values[at] = 0;
		values[at + 1] = 0;
		values[at + 2] = 0;
		values[at + 3] = 1;
		return;
	}
	for (let c = 0; c < count; c++) values[at + c] = (values[at + c] as number) / length;
}

/**
 * The scene's property animations: the tracks that sketches start, and the players that follow
 * clips. The engine steps it once a frame, after the job workers advanced the clips.
 */
export class PropertySystem {
	private readonly animations: PropertyAnimation[] = [];
	private readonly players: PropertyStepper[] = [];

	constructor(private readonly write: PropertyWriter) {}

	/** @internal Starts `animation`, which the next frame steps. */
	add(animation: PropertyAnimation): void {
		this.animations.push(animation);
	}

	/** @internal Stops stepping `animation`. */
	remove(animation: PropertyAnimation): void {
		const at = this.animations.indexOf(animation);
		if (at >= 0) this.animations.splice(at, 1);
	}

	/** @internal Follows the clips of one animated object. */
	addPlayer(player: PropertyStepper): void {
		this.players.push(player);
	}

	/** @internal Stops following the clips of an object that was destroyed. */
	removePlayer(player: PropertyStepper): void {
		const at = this.players.indexOf(player);
		if (at >= 0) this.players.splice(at, 1);
	}

	/** True when nothing animates, so a frame has no property work to do. */
	get idle(): boolean {
		return this.animations.length === 0 && this.players.length === 0;
	}

	/** Advances each sketch animation by `seconds` and writes every property. */
	step(seconds: number): void {
		if (this.idle) return;
		const { animations, players, write } = this;
		for (let k = 0; k < animations.length; k++)
			(animations[k] as PropertyAnimation).step(seconds, write);
		for (let k = 0; k < players.length; k++) (players[k] as PropertyStepper).step(write);
	}
}

/**
 * One property's keyframes, playing. `scene.animateProperty` returns one: the engine samples it
 * each frame and writes the target's value, so a sketch has no update call to make. A frozen
 * keyframes object is read once.
 *
 * @category api/animation
 */
export class PropertyAnimation {
	private seconds: number;
	private rate = 1;
	private running: boolean;
	private repeats: boolean;
	private live = true;
	private readonly key = new Float32Array(4);

	/** @internal */
	constructor(
		private readonly system: PropertySystem,
		private readonly target: object,
		private readonly binding: PropertyBinding,
		private readonly track: PropertyTrack,
		keyframes: PropertyKeyframes,
	) {
		this.seconds = keyframes.time ?? (track.times[0] as number);
		this.running = keyframes.paused !== true;
		this.repeats = keyframes.loop !== false;
		this.rate = keyframes.speed ?? 1;
	}

	/** The animation's time in seconds. */
	get time(): number {
		return this.seconds;
	}

	/** True while the animation runs. */
	get playing(): boolean {
		return this.running;
	}

	/** True when the animation repeats, and false when it holds its last key. */
	get loop(): boolean {
		return this.repeats;
	}

	/** The rate of the animation's time: 1 plays it as made, and a negative rate plays it backward. */
	get speed(): number {
		return this.rate;
	}

	/** Sets the animation's time in seconds, as three.js's `action.time` does. */
	setTime(seconds: number): void {
		this.seconds = seconds;
	}

	/** Starts or stops the time, without changing the value that the target holds. */
	setPaused(paused: boolean): void {
		this.running = !paused;
	}

	/** Repeats the animation, or makes it hold its last key at its end. */
	setLoop(loop: boolean): void {
		this.repeats = loop;
	}

	/**
	 * Sets the rate of the animation's time: 1 plays it as made, and 2 twice as fast. A negative
	 * rate plays it backward.
	 */
	setSpeed(speed: number): void {
		this.rate = speed;
	}

	/** Stops the animation, and leaves the target at the value that the last frame wrote. */
	stop(): void {
		if (!this.live) return;
		this.live = false;
		this.system.remove(this);
	}

	/** @internal Advances the time and writes the target's value. */
	step(seconds: number, write: PropertyWriter): void {
		if (!this.live) return;
		const { track, binding } = this;
		const { times } = track;
		const first = times[0] as number;
		const last = times[times.length - 1] as number;
		if (this.running) {
			this.seconds += seconds * this.rate;
			if (this.repeats) {
				const length = last - first;
				if (length > 0) {
					const offset = (this.seconds - first) % length;
					this.seconds = first + (offset < 0 ? offset + length : offset);
				} else this.seconds = first;
			} else if (this.seconds < first) this.seconds = first;
			else if (this.seconds > last) this.seconds = last;
		}
		sample(track, binding, this.seconds, this.key, 0);
		write(this.target, binding, this.key, 0, 1);
	}
}
