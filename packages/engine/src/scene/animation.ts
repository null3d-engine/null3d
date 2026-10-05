// The animator: each animated object's calls to play, fade, blend and stop its clips, its clips'
// and layers' weights, its layers' joint masks, its time scale and its event handlers. The engine
// core keeps each object's clips, times and fades, and its frame step advances and blends them on
// the job workers. Calls here change that state in the core; the clip weights, the layer weights,
// the blend values and the time scale are numbers in engine memory, which these calls write
// directly, so a sketch can change them every frame for free. A play reads a frozen options
// object once and keeps what it read, so a game that switches clips with constant options
// allocates nothing.
// After each frame step, the events that the clips passed reach the sketch's handlers. A rig
// holds a skeleton and its named clips in the core, which every object that animates with it
// shares. Only engine code creates rigs: the glTF loader, from the models it loads, and test
// pages. The engine imports this module only with the glTF loader, so a page that loads no model
// downloads none of it.

import type { Described } from '../errors/checks';
import * as C from '../generated/core';
import { DEV } from '../shared/dev';
import type { RigClip, RigData, RigJoint, RigTrack } from './gltf-animation';
import type { CoreMemory } from './memory';
import type { Mesh, Object3D, Scene, SceneChecks } from './scene';

export type { RigClip, RigData, RigJoint, RigTrack };

/** The scene API's checks and errors, from the first scene that animates. */
let checks: SceneChecks;

/**
 * How `Animator.play` plays a clip. A play reads a frozen object once, so a game that keeps its
 * options in frozen constants switches clips without allocating.
 *
 * @category api/animation
 */
export interface PlayOptions {
	/**
	 * Seconds over which the clip fades in while the layer's other clips fade out. The default, 0,
	 * switches at once.
	 */
	fade?: number;
	/** True, the default, repeats the clip. False plays it once and holds its last frame. */
	loop?: boolean;
	/**
	 * The rate of the clip's time. 1, the default, plays it as made, and 2 twice as fast. A negative
	 * rate plays it backward from its end.
	 */
	speed?: number;
	/**
	 * The layer, a whole number from 0, the default, to 3. Each layer above 0 replaces the pose of
	 * the layers below by its weight, on the joints of its mask.
	 */
	layer?: number;
	/**
	 * True adds the clip's change from its first frame to the pose of the layers, as three.js's
	 * additive clips do. A breathing or aiming clip then plays on top of a walk. An additive play
	 * replaces only the additive clips of its layer, and a plain play only the plain ones.
	 */
	additive?: boolean;
	/**
	 * Seconds into the clip at which it starts, as three.js's `action.time` sets it. A repeating
	 * clip wraps the time into its length, and a clip that plays once holds it within its length.
	 * Without it, a clip starts at its first frame, and a clip that already plays keeps its time.
	 */
	time?: number;
	/**
	 * The clip's own weight, 0 or more, as three.js's `setEffectiveWeight` sets it. A play with a
	 * weight joins the other clips of its layer instead of fading them out, so a walk at 0.3 and a
	 * run at 0.7 blend. A fade multiplies the weight. Without it, a clip that starts takes 1, and a
	 * clip that already plays keeps its weight.
	 */
	weight?: number;
}

/**
 * How `Animator.playBlend` plays a 1D blend. Like `PlayOptions`, a frozen object is read once.
 *
 * @category api/animation
 */
export interface BlendOptions {
	/**
	 * The blend value, which picks the mix, as `setBlend` sets it. Without it, the layer keeps its
	 * value, 0 at first.
	 */
	value?: number;
	/**
	 * Seconds over which the blend fades in while the layer's other clips fade out. The default,
	 * 0, switches at once.
	 */
	fade?: number;
	/** True, the default, repeats the clips. False plays them once and holds their last frames. */
	loop?: boolean;
	/**
	 * The rate of the blend. 1, the default, moves it through one cycle in the length of its
	 * clips, averaged by their weights. A negative rate plays it backward.
	 */
	speed?: number;
	/** The layer, a whole number from 0, the default, to 3. */
	layer?: number;
	/**
	 * The share of their cycle, from 0 to 1, at which the clips start: 0.5 starts each clip
	 * halfway through. Without it, the blend takes the phase of the layer's blend, or of the first
	 * of its clips that the layer plays, so the switch keeps the step. Otherwise the clips start at
	 * their first frames.
	 */
	phase?: number;
}

/**
 * How `Animator.stop` stops clips.
 *
 * @category api/animation
 */
export interface StopOptions {
	/** Seconds over which the clips fade out. The default, 0, stops them at once. */
	fade?: number;
}

/**
 * An event that a playing clip reached, which `Animator.onEvent` handlers get. The animator passes
 * the same object to every handler of every event, so copy what you keep.
 *
 * @category api/animation
 */
export interface AnimationEvent {
	/**
	 * The event's name: one of the clip's events, 'loop' when a repeating clip starts again, or
	 * 'finished' when a clip that plays once reaches its end.
	 */
	readonly name: string;
	/** The clip's name. */
	readonly clip: string;
	/** The layer the clip plays on. */
	readonly layer: number;
}

/**
 * A handler of an animated object's events.
 *
 * @category api/animation
 */
export type AnimationEventHandler = (event: AnimationEvent) => void;

/** The names the animator gives its own events, which clip events cannot take. */
const LOOP = 'loop';
const FINISHED = 'finished';

/** The animated objects and joints that the animation table holds. */
const ANIMATED_OBJECTS = 1024;
const ANIMATED_JOINTS = 65_536;

/** Floats per joint's inverse bind matrix: row-major 3 × 4. */
const BIND_FLOATS = 12;
/** The parent of a root joint in the core's arrays. */
const NO_PARENT = 0xffff_ffff;

const CHANNELS = {
	translation: C.ANIMATION_TRANSLATION,
	rotation: C.ANIMATION_ROTATION,
	scale: C.ANIMATION_SCALE,
} as const;

const INTERPOLATIONS = {
	linear: C.ANIMATION_LINEAR,
	step: C.ANIMATION_STEP,
	cubic: C.ANIMATION_CUBIC_SPLINE,
} as const;

/**
 * What a play reads from its options: its numbers at the `ANIMATION_ARG_*` places, its
 * `ANIMATION_PLAY_*` flags and its layer. A play copies the numbers into engine memory with one
 * array copy, which makes no number objects in the browser.
 */
class ReadOptions {
	readonly numbers = new Float32Array(C.ANIMATION_ARGS);
	flags = C.ANIMATION_PLAY_LOOP;
	layer = 0;

	constructor() {
		this.numbers[C.ANIMATION_ARG_SPEED] = 1;
		this.numbers[C.ANIMATION_ARG_WEIGHT] = 1;
	}
}

/** What a blend reads from its points: the clips' names and their points, in order. */
class ReadPoints {
	readonly names: string[] = new Array<string>(C.ANIMATION_MAX_BLEND).fill('');
	readonly points = new Float32Array(C.ANIMATION_MAX_BLEND);
	/** The clips that the points name, which can be more than the record holds. */
	count = 0;
}

/**
 * What plays read from each frozen options object and points object. A frozen object never
 * changes, so a play reads it once. Reading a fraction from an object that a play gets makes a
 * number object in the browser each time, once the object's shape is one of several that the
 * play has seen, as in any game. The records keep a switch between clips free of such objects.
 */
const playRecords = new WeakMap<PlayOptions, ReadOptions>();
const blendRecords = new WeakMap<BlendOptions, ReadOptions>();
const pointRecords = new WeakMap<Readonly<Record<string, number>>, ReadPoints>();
/** The record of a play without options. */
const NO_OPTIONS = new ReadOptions();
/** The records that plays fill again from objects that are not frozen. */
const sharedOptions = new ReadOptions();
const sharedPoints = new ReadPoints();

/** A new record for a frozen `object`, which its play keeps, or else the shared one. */
function recordFor<T>(object: object, shared: T, make: new () => T): T {
	return typeof object === 'object' && Object.isFrozen(object) ? new make() : shared;
}

/** A skeleton and its named clips in the engine core, which animated objects share. */
export class AnimationRig {
	/** The joint masks made so far, by their joint names. */
	readonly masks = new Map<string, number>();
	readonly jointNames: readonly string[];
	readonly parents: readonly number[];
	/** True for each joint of a skin, which `debug.skeleton` draws. */
	readonly bones: readonly boolean[];
	/**
	 * Each joint's place at bind time, 3 numbers per joint: the point that its inverse bind matrix
	 * maps to the origin. Its skinning matrix carries that point to the joint's place in the pose.
	 */
	readonly bindPlaces: Float64Array;

	constructor(
		/** The skeleton's id in the core, plus one. */
		readonly skeleton: number,
		/** Each clip's id in the core, plus one, by name. */
		readonly clips: ReadonlyMap<string, number>,
		joints: readonly RigJoint[],
	) {
		this.jointNames = joints.map((j) => j.name);
		this.parents = joints.map((j) => j.parent);
		this.bones = joints.map((j) => j.bone === true);
		this.bindPlaces = new Float64Array(joints.length * 3);
		joints.forEach((joint, j) => {
			invertedOrigin(joint.inverseBind, this.bindPlaces, j * 3);
		});
	}
}

/**
 * Writes at `at` the point that a row-major 3 × 4 matrix maps to the origin: the translation of
 * its inverse. A matrix with no inverse gives the origin.
 */
function invertedOrigin(m: ArrayLike<number>, out: Float64Array, at: number): void {
	const e = (r: number, c: number) => m[r * 4 + c] as number;
	const [a, b, c] = [e(0, 0), e(0, 1), e(0, 2)];
	const [d, f, g] = [e(1, 0), e(1, 1), e(1, 2)];
	const [h, i, k] = [e(2, 0), e(2, 1), e(2, 2)];
	const det = a * (f * k - g * i) - b * (d * k - g * h) + c * (d * i - f * h);
	if (det === 0) return;
	// The inverse's rotation part, by the adjugate, times the negated translation.
	const [x, y, z] = [-e(0, 3), -e(1, 3), -e(2, 3)];
	out[at] = ((f * k - g * i) * x + (c * i - b * k) * y + (b * g - c * f) * z) / det;
	out[at + 1] = ((g * h - d * k) * x + (a * k - c * h) * y + (c * d - a * g) * z) / det;
	out[at + 2] = ((d * i - f * h) * x + (b * h - a * i) * y + (a * f - b * d) * z) / det;
}

/** Throws E1218 with `detail`. */
function refuse(detail: string): never {
	throw checks.error('E1218', detail);
}

/** A list of names for a message, such as "a, b and c". */
function listed(names: Iterable<string>): string {
	const all = [...names];
	return all.length < 2 ? (all[0] ?? 'none') : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}

/**
 * The scene's animated objects: the animation table in the engine core, the arrays of it that
 * calls write, and the events of each frame step. The first rig creates it.
 */
export class SceneAnimations {
	private generation = -1;
	private scales!: Float32Array;
	private weights!: Float32Array;
	private sources!: Uint32Array;
	private clipWeights!: Float32Array;
	private blends!: Float32Array;
	private words!: Uint32Array;
	private floats!: Float32Array;
	private args!: Float32Array;
	private records!: Uint32Array;
	private totals!: Uint32Array;
	/** The animator of each object, by its instance id in the core. */
	readonly animators: (Animator | undefined)[] = [];
	/** Each clip's name, by its id in the core. */
	readonly clipNames: string[] = [];
	/** Each event name, by its id; 0 has none. */
	private readonly eventNames: string[] = [''];
	private readonly eventIds = new Map<string, number>();
	/** The event that handlers get, which each event refills. */
	private readonly event = { name: '', clip: '', layer: 0 };
	private warnedDropped = false;

	constructor(readonly core: CoreMemory) {
		core.checkGrowth(
			core.glue.initAnimations(ANIMATED_OBJECTS, ANIMATED_JOINTS),
			'the animation table',
			undefined,
			true,
		);
	}

	/** The id of event name `name`, which it gives a new name. */
	eventId(name: string): number {
		let id = this.eventIds.get(name);
		if (id === undefined) {
			id = this.eventNames.length;
			this.eventNames.push(name);
			this.eventIds.set(name, id);
		}
		return id;
	}

	/**
	 * The arrays of the animation table, made again after the engine's memory grew. Sketches set
	 * weights every frame, so this check stays small enough for the browser to inline into their
	 * code, and creates no closure: either way, each number passed to it would allocate.
	 */
	private views(): void {
		if (this.generation !== this.core.generation) this.makeViews();
	}

	private makeViews(): void {
		const { core } = this;
		const at = (field: number) => core.glue.animationArrays(field);
		this.scales = core.f32(at(C.ANIMATION_FIELD_TIME_SCALES), ANIMATED_OBJECTS);
		this.weights = core.f32(
			at(C.ANIMATION_FIELD_LAYER_WEIGHTS),
			ANIMATED_OBJECTS * C.ANIMATION_MAX_LAYERS,
		);
		this.blends = core.f32(
			at(C.ANIMATION_FIELD_BLEND_VALUES),
			ANIMATED_OBJECTS * C.ANIMATION_MAX_LAYERS,
		);
		const slots = ANIMATED_OBJECTS * C.ANIMATION_MAX_BLEND;
		this.sources = core.u32(at(C.ANIMATION_FIELD_SLOT_SOURCES), slots);
		this.clipWeights = core.f32(at(C.ANIMATION_FIELD_SLOT_WEIGHTS), slots);
		this.words = new Uint32Array(core.memory.buffer);
		this.floats = new Float32Array(core.memory.buffer);
		this.args = core.f32(at(C.ANIMATION_FIELD_PLAY_ARGS), C.ANIMATION_ARGS);
		this.records = core.u32(
			at(C.ANIMATION_FIELD_EVENTS),
			C.ANIMATION_EVENT_CAPACITY * C.ANIMATION_EVENT_WORDS,
		);
		this.totals = core.u32(at(C.ANIMATION_FIELD_EVENT_TOTALS), 2);
		this.generation = core.generation;
	}

	/**
	 * The skinning matrices of an animated instance's joints from the last frame step, 12 numbers
	 * per joint: a view of engine memory that is good until the next call into the core. Debug
	 * drawing reads it.
	 */
	instanceMatrices(instance: number, joints: number): Float32Array {
		const { core } = this;
		const first = core.check(core.glue.animatedInstanceJoints(instance), 'debug.skeleton') - 1;
		const at = core.glue.animationArrays(C.ANIMATION_FIELD_MATRICES);
		return core.f32(at + first * 48, joints * 12);
	}

	/** The rate of each instance's time, by its id in the core. */
	timeScales(): Float32Array {
		this.views();
		return this.scales;
	}

	/** The weight of each layer of each instance, `ANIMATION_MAX_LAYERS` per instance. */
	layerWeights(): Float32Array {
		this.views();
		return this.weights;
	}

	/**
	 * The numbers of the next play, `ANIMATION_ARGS` of them at the `ANIMATION_ARG_*` places. They
	 * reach the core through engine memory, as numbers passed to a call the browser does not
	 * inline would each allocate.
	 */
	playArgs(): Float32Array {
		this.views();
		return this.args;
	}

	/** The whole engine memory as 32-bit words, for staging words without a view of their own. */
	memoryWords(): Uint32Array {
		this.views();
		return this.words;
	}

	/** The whole engine memory as 32-bit floats. */
	memoryFloats(): Float32Array {
		this.views();
		return this.floats;
	}

	/** The blend value of each layer of each instance, `ANIMATION_MAX_LAYERS` per instance. */
	blendValues(): Float32Array {
		this.views();
		return this.blends;
	}

	/**
	 * The clip that a play put in each sample slot, `ANIMATION_MAX_BLEND` per instance, or
	 * `ANIMATION_NO_SOURCE`.
	 */
	slotSources(): Uint32Array {
		this.views();
		return this.sources;
	}

	/** The weight of each sample slot, `ANIMATION_MAX_BLEND` per instance. */
	slotWeights(): Float32Array {
		this.views();
		return this.clipWeights;
	}

	/**
	 * Calls the handlers of each event of the last frame step, in order of object and time. A
	 * handler's error goes to `report`, and the other handlers still run.
	 */
	dispatch(report: (error: unknown) => void): void {
		this.views();
		const count = this.totals[0] as number;
		if (DEV && !this.warnedDropped && (this.totals[1] as number) > 0) {
			this.warnedDropped = true;
			console.warn(
				`null3D: animated objects passed more than ${C.ANIMATION_EVENT_CAPACITY} clip events in one frame; the animator dropped the rest.`,
			);
		}
		const { event } = this;
		for (let k = 0; k < count; k++) {
			// A handler can create objects, which can grow the engine's memory.
			this.views();
			const at = k * C.ANIMATION_EVENT_WORDS;
			const records = this.records;
			const animator = this.animators[records[at] as number];
			if (animator === undefined) continue;
			const word = records[at + 1] as number;
			const kind = (word >>> 8) & 0xff;
			event.name =
				kind === C.ANIMATION_EVENT_CLIP
					? (this.eventNames[records[at + 3] as number] ?? '')
					: kind === C.ANIMATION_EVENT_LOOP
						? LOOP
						: FINISHED;
			event.clip = this.clipNames[records[at + 2] as number] ?? '';
			event.layer = word & 0xff;
			animator.emit(event, report);
		}
	}
}

/**
 * Plays an animated object's clips. It fades between them, blends them in layers with joint masks,
 * adds additive clips on top, and calls handlers for the clips' events. The engine advances every
 * animator on its job workers each frame, so a sketch has no update call to make. Get an object's
 * animator with `object.animator()`.
 *
 * @category api/animation
 */
export class Animator implements Described {
	/** Handlers by event name. */
	private readonly handlers = new Map<string, AnimationEventHandler[]>();
	/** @internal The meshes that the object's joints skin. */
	readonly skinned: Mesh[] = [];
	/** @internal The meshes whose morph weights the object's clips animate. */
	readonly morphed: Mesh[] = [];

	/** @internal */
	constructor(
		private readonly system: SceneAnimations,
		/** The object that the animator moves. */
		readonly object: Object3D,
		/** @internal */ readonly rig: AnimationRig,
		/** @internal The object's instance id in the core, plus one; 0 once it is destroyed. */
		public instance: number,
	) {}

	/** The names of the clips that the object can play. */
	get clips(): readonly string[] {
		return [...this.rig.clips.keys()];
	}

	/** The rate of the object's animation time: 1 by default, 0 to pause every clip. */
	get timeScale(): number {
		return this.system.timeScales()[this.instance - 1] ?? 1;
	}

	/** @internal The skinning matrices of the object's joints from the last frame step. */
	matrices(): Float32Array {
		return this.system.instanceMatrices(this.instance, this.rig.parents.length);
	}

	/** The object, as error messages name it. */
	describe(): string {
		return this.object.describe();
	}

	/**
	 * Plays a clip. It fades in over `fade` seconds while the other clips of its layer fade out,
	 * or with no fade, takes over at once. With a `weight`, it joins the layer's other clips
	 * instead. A clip that already plays on the layer keeps its time and fades back in. A clip
	 * that played once and reached its end starts again.
	 */
	play(name: string, options?: PlayOptions): void {
		this.start('play', name, options, true);
	}

	/**
	 * Fades to a clip over `duration` seconds while the layer's other clips fade out, as
	 * three.js's `crossFadeTo` does. It is `play(name, { ...options, fade: duration })`, but a
	 * clip with a weight still takes over.
	 */
	crossFade(name: string, duration: number, options?: PlayOptions): void {
		this.start('crossFade', name, options, false, duration);
	}

	/**
	 * Sets the weight of a clip that plays, 0 or more, on every layer that plays it, as three.js's
	 * `setEffectiveWeight` does. A clip at weight 0 leaves the pose but keeps playing, so its time
	 * moves on. A fade multiplies the weight. It writes engine memory, so calling it every frame
	 * costs nothing.
	 */
	setWeight(name: string, weight: number): void {
		const call = 'setWeight';
		const clip = this.clip(call, name) - 1;
		if (DEV) {
			checks.checkLive(call, this.object);
			this.checkWeight(call, weight);
		}
		const weights = this.system.slotWeights();
		const sources = this.system.slotSources();
		const first = (this.instance - 1) * C.ANIMATION_MAX_BLEND;
		let set = 0;
		for (let k = first; k < first + C.ANIMATION_MAX_BLEND; k++) {
			if (sources[k] !== clip) continue;
			weights[k] = weight;
			set++;
		}
		if (DEV && set === 0)
			refuse(
				`${call}() got "${name}", which does not play on ${this.describe()}. Play it first, for example with play('${name}', { weight }).`,
			);
	}

	/**
	 * Plays a 1D blend of clips. Each clip counts in full at its point, such as
	 * `{ idle: 0, walk: 1.4, run: 4 }` for a blend by speed. Between two points, the two clips
	 * around the blend value share it, and `setBlend` moves the value. The clips keep one phase:
	 * each clip's time moves at its length over the length of the blend's clips, averaged by
	 * their weights. A walk and a run of different lengths then keep their steps together. The
	 * layer's other clips fade out over `fade` seconds, as with `play`.
	 */
	playBlend(points: Readonly<Record<string, number>>, options?: BlendOptions): void {
		const call = 'playBlend';
		if (DEV) checks.checkLive(call, this.object);
		const read = this.blendOptions(call, options);
		const blend = this.blendPoints(call, points);
		const { count } = blend;
		const { core } = this.system;
		const at = core.checkGrowth(core.glue.animationStaging(count * 2), call) >>> 2;
		const words = this.system.memoryWords();
		const floats = this.system.memoryFloats();
		// Past the most clips a blend takes, the staged words reach the core's check unwritten.
		const named = Math.min(count, C.ANIMATION_MAX_BLEND);
		for (let k = 0; k < named; k++) {
			words[at + k] = this.clip(call, blend.names[k] as string);
			floats[at + count + k] = blend.points[k] as number;
		}
		this.system.playArgs().set(read.numbers);
		this.done(core.glue.animatorPlayBlend(this.instance, count, read.layer, read.flags), call);
	}

	/**
	 * Sets the blend value of a layer's blend: the clip at that point counts in full, and a value
	 * between two points mixes the two clips around it. A value past the first or the last point
	 * gives that point's clip. It writes engine memory, so calling it every frame costs nothing.
	 */
	setBlend(value: number, layer = 0): void {
		if (DEV) {
			checks.checkLive('setBlend', this.object);
			checks.checkNumber('setBlend', 'value', value, this);
		}
		this.system.blendValues()[this.layerAt('setBlend', layer)] = value;
	}

	/** Stops a clip on every layer, or with no name, every clip, fading out over `fade` seconds. */
	stop(name?: string, options?: StopOptions): void {
		const call = 'stop';
		const clip = name === undefined ? 0 : this.clip(call, name);
		const fade = options?.fade ?? 0;
		if (DEV) {
			checks.checkLive(call, this.object);
			this.checkFade(call, fade);
		}
		this.done(this.system.core.glue.animatorStop(this.instance, clip, fade), call);
	}

	/**
	 * Sets a layer's weight, from 0 to 1. Layer 0 blends with the rest pose below it, and each
	 * layer above replaces the pose below by its weight. Weights start at 1. It writes engine
	 * memory, so calling it every frame costs nothing.
	 */
	setLayerWeight(layer: number, weight: number): void {
		const call = 'setLayerWeight';
		if (DEV) {
			checks.checkLive(call, this.object);
			checks.checkNumber(call, 'weight', weight, this);
			if (weight < 0 || weight > 1)
				refuse(`${call}() got the weight ${weight} on ${this.describe()}; it takes 0 to 1.`);
		}
		this.system.layerWeights()[this.layerAt(call, layer)] = weight;
	}

	/**
	 * Limits a layer to some joints: each named joint and every joint below it, such as 'Spine'
	 * for the upper body. `null` gives the layer every joint again.
	 */
	setLayerMask(layer: number, joints: string | readonly string[] | null): void {
		const call = 'setLayerMask';
		if (DEV) {
			checks.checkLive(call, this.object);
			this.checkLayer(call, layer);
		}
		const mask =
			joints === null ? 0 : this.mask(call, typeof joints === 'string' ? [joints] : joints);
		this.done(this.system.core.glue.setLayerMask(this.instance, layer, mask), call);
	}

	/** Sets the rate of the object's animation time: 1 plays clips as made, 0 pauses them all. */
	setTimeScale(scale: number): void {
		if (DEV) {
			checks.checkLive('setTimeScale', this.object);
			checks.checkNumber('setTimeScale', 'scale', scale, this);
		}
		this.system.timeScales()[this.instance - 1] = scale;
	}

	/**
	 * Calls `handler` for each event named `name` that a playing clip reaches: an event in the
	 * clip's data, 'loop' when a repeating clip starts again, or 'finished' when a clip that plays
	 * once reaches its end. Handlers run on the sketch's thread at the start of the next frame's
	 * update, before `onFixedUpdate` and `onUpdate`. Returns a function that removes the handler.
	 */
	onEvent(name: string, handler: AnimationEventHandler): () => void {
		let list = this.handlers.get(name);
		if (list === undefined) {
			list = [];
			this.handlers.set(name, list);
		}
		list.push(handler);
		return () => {
			const at = list.indexOf(handler);
			if (at >= 0) list.splice(at, 1);
		};
	}

	/** @internal Calls the handlers of `event`'s name. */
	emit(event: AnimationEvent, report: (error: unknown) => void): void {
		const list = this.handlers.get(event.name);
		if (list === undefined) return;
		for (let k = 0; k < list.length; k++) {
			try {
				(list[k] as AnimationEventHandler)(event);
			} catch (error) {
				report(error);
			}
		}
	}

	/**
	 * @internal Gives `object`, a copy of this animator's object, an animator of the same rig, which
	 * skins the copies of the meshes that this one skins: each mesh's copy in `copies`, or the mesh
	 * itself when the copy left it out.
	 */
	copyTo(object: Object3D, copies: ReadonlyMap<Object3D, Object3D>): Animator {
		const animator = animateObject(object, this.rig);
		for (const mesh of this.skinned)
			if (mesh.destroyedFrame === -1)
				skinObject((copies.get(mesh) as Mesh | undefined) ?? mesh, animator);
		for (const mesh of this.morphed)
			if (mesh.destroyedFrame === -1)
				morphObject((copies.get(mesh) as Mesh | undefined) ?? mesh, animator);
		return animator;
	}

	/**
	 * @internal Removes the object's animation from the engine core, when the object is destroyed.
	 * The meshes that its joints skin stop being skinned, and keep their last pose's bounds.
	 */
	release(): void {
		if (this.instance === 0) return;
		for (const mesh of this.skinned)
			if (mesh.row !== 0) mesh.scene.command(C.COMMAND_SET_SKIN, mesh.handle, 0, 0, 'destroy');
		this.skinned.length = 0;
		const { glue } = this.system.core;
		for (const mesh of this.morphed)
			if (mesh.morphBlock !== 0) glue.linkMorphWeights(mesh.morphBlock - 1, 0, 0);
		this.morphed.length = 0;
		this.done(this.system.core.glue.removeAnimatedInstance(this.instance), 'destroy');
		this.system.animators[this.instance - 1] = undefined;
		this.instance = 0;
	}

	/**
	 * Plays clip `name` with `options`, fading over `duration` seconds or else the options' fade.
	 * With `join`, a play with a weight joins the layer's other clips.
	 */
	private start(
		call: string,
		name: string,
		options: PlayOptions | undefined,
		join: boolean,
		duration?: number,
	): void {
		const clip = this.clip(call, name);
		if (DEV) {
			checks.checkLive(call, this.object);
			if (duration !== undefined) this.checkFade(call, duration);
		}
		const read = this.playOptions(call, options);
		const { core } = this.system;
		const args = this.system.playArgs();
		args.set(read.numbers);
		if (duration !== undefined) args[C.ANIMATION_ARG_FADE] = duration;
		const joins = join && (read.flags & C.ANIMATION_PLAY_WEIGHT) !== 0;
		const flags = read.flags | (joins ? C.ANIMATION_PLAY_JOIN : 0);
		const status = core.glue.animatorPlay(this.instance, clip, read.layer, flags);
		// The first additive play of a clip stores its additive form, which can grow the memory.
		core.refresh();
		this.done(status, call);
	}

	/** What a play reads from `options`, which it checks in development builds. */
	private playOptions(call: string, options: PlayOptions | undefined): ReadOptions {
		if (options === undefined) return NO_OPTIONS;
		const known = playRecords.get(options);
		if (known !== undefined) return known;
		const fade = options.fade ?? 0;
		const speed = options.speed ?? 1;
		const layer = options.layer ?? 0;
		const { time, weight } = options;
		if (DEV) {
			this.checkFade(call, fade);
			checks.checkNumber(call, 'speed', speed, this);
			this.checkLayer(call, layer);
			if (time !== undefined) checks.checkNumber(call, 'time', time, this);
			if (weight !== undefined) this.checkWeight(call, weight);
		}
		const read = recordFor(options, sharedOptions, ReadOptions);
		const { numbers } = read;
		numbers[C.ANIMATION_ARG_FADE] = fade;
		numbers[C.ANIMATION_ARG_SPEED] = speed;
		numbers[C.ANIMATION_ARG_TIME] = time ?? 0;
		numbers[C.ANIMATION_ARG_WEIGHT] = weight ?? 1;
		read.flags =
			(options.loop === false ? 0 : C.ANIMATION_PLAY_LOOP) |
			(options.additive ? C.ANIMATION_PLAY_ADDITIVE : 0) |
			(time === undefined ? 0 : C.ANIMATION_PLAY_TIME) |
			(weight === undefined ? 0 : C.ANIMATION_PLAY_WEIGHT);
		read.layer = layer;
		if (read !== sharedOptions) playRecords.set(options, read);
		return read;
	}

	/** What a blend reads from `options`, which it checks in development builds. */
	private blendOptions(call: string, options: BlendOptions | undefined): ReadOptions {
		if (options === undefined) return NO_OPTIONS;
		const known = blendRecords.get(options);
		if (known !== undefined) return known;
		const fade = options.fade ?? 0;
		const speed = options.speed ?? 1;
		const layer = options.layer ?? 0;
		const { phase, value } = options;
		if (DEV) {
			this.checkFade(call, fade);
			checks.checkNumber(call, 'speed', speed, this);
			this.checkLayer(call, layer);
			if (value !== undefined) checks.checkNumber(call, 'value', value, this);
			if (phase !== undefined) checks.checkNumber(call, 'phase', phase, this);
		}
		const read = recordFor(options, sharedOptions, ReadOptions);
		const { numbers } = read;
		numbers[C.ANIMATION_ARG_FADE] = fade;
		numbers[C.ANIMATION_ARG_SPEED] = speed;
		numbers[C.ANIMATION_ARG_TIME] = phase ?? 0;
		numbers[C.ANIMATION_ARG_VALUE] = value ?? 0;
		read.flags =
			(options.loop === false ? 0 : C.ANIMATION_PLAY_LOOP) |
			(phase === undefined ? 0 : C.ANIMATION_PLAY_TIME) |
			(value === undefined ? 0 : C.ANIMATION_PLAY_VALUE);
		read.layer = layer;
		if (read !== sharedOptions) blendRecords.set(options, read);
		return read;
	}

	/**
	 * What a blend reads from `points`, which it checks in development builds. The names are
	 * counted and read with `for...in`, which builds no array.
	 */
	private blendPoints(call: string, points: Readonly<Record<string, number>>): ReadPoints {
		const known = pointRecords.get(points);
		if (known !== undefined) return known;
		const read = recordFor(points, sharedPoints, ReadPoints);
		let count = 0;
		for (const name in points) {
			if (count < C.ANIMATION_MAX_BLEND) {
				read.names[count] = name;
				read.points[count] = points[name] as number;
			}
			count++;
		}
		read.count = count;
		if (DEV) {
			if (count === 0 || count > C.ANIMATION_MAX_BLEND)
				refuse(
					`${call}() got ${count} clips on ${this.describe()}; a blend takes 1 to ${C.ANIMATION_MAX_BLEND}.`,
				);
			const named = new Map<number, string>();
			for (const name in points) {
				const point = points[name] as number;
				checks.checkNumber(call, `the point of "${name}"`, point, this);
				const other = named.get(point);
				if (other !== undefined)
					refuse(
						`${call}() got the point ${point} for "${other}" and "${name}" on ${this.describe()}; give each clip a point of its own.`,
					);
				named.set(point, name);
			}
		}
		if (read !== sharedPoints) pointRecords.set(points, read);
		return read;
	}

	/**
	 * Throws the core's failure of `call` when `status` is not 0. The object's description is made
	 * only then, so a call that succeeds allocates nothing.
	 */
	private done(status: number, call: string): void {
		if (status !== 0) this.system.core.check(status, call, this.describe(), true);
	}

	/** The core's id, plus one, of the clip named `name`. */
	private clip(call: string, name: string): number {
		const clip = this.rig.clips.get(name);
		if (clip === undefined)
			refuse(
				`${call}() got "${name}", which names no clip of ${this.describe()}. Its clips are ${listed(this.rig.clips.keys())}.`,
			);
		return clip;
	}

	private checkFade(call: string, fade: number): void {
		checks.checkNumber(call, 'fade', fade, this);
		if (fade < 0)
			refuse(`${call}() got the fade ${fade} on ${this.describe()}; it takes 0 or more.`);
	}

	private checkWeight(call: string, weight: number): void {
		checks.checkNumber(call, 'weight', weight, this);
		if (weight < 0)
			refuse(`${call}() got the weight ${weight} on ${this.describe()}; it takes 0 or more.`);
	}

	private checkLayer(call: string, layer: number): void {
		if (Number.isInteger(layer) && layer >= 0 && layer < C.ANIMATION_MAX_LAYERS) return;
		refuse(
			`${call}() got the layer ${layer} on ${this.describe()}; it takes a whole number from 0 to ${C.ANIMATION_MAX_LAYERS - 1}.`,
		);
	}

	/**
	 * The place of layer `layer` of the object in the arrays of layers. It checks the layer in
	 * every build, so a write never reaches another object's layers.
	 */
	private layerAt(call: string, layer: number): number {
		if (layer >>> 0 !== layer || layer >= C.ANIMATION_MAX_LAYERS) this.checkLayer(call, layer);
		return (this.instance - 1) * C.ANIMATION_MAX_LAYERS + layer;
	}

	/** The core's id, plus one, of the mask of `joints` and the joints below them. */
	private mask(call: string, joints: readonly string[]): number {
		const { rig } = this;
		const key = joints.join('\n');
		const known = rig.masks.get(key);
		if (known !== undefined) return known;
		const named = new Set(joints);
		for (const joint of named)
			if (!rig.jointNames.includes(joint))
				refuse(`${call}() got "${joint}", which names no joint of ${this.describe()}.`);
		const count = rig.jointNames.length;
		const { core } = this.system;
		const weights = new Float32Array(count);
		// Joints come parents first, so each parent's weight is known before its children's.
		for (let j = 0; j < count; j++) {
			const parent = rig.parents[j] as number;
			const inherited = parent >= 0 && weights[parent] === 1;
			weights[j] = inherited || named.has(rig.jointNames[j] as string) ? 1 : 0;
		}
		const address = core.checkGrowth(core.glue.animationStaging(count), call, this.describe());
		core.f32(address, count).set(weights);
		const mask = core.checkGrowth(core.glue.createJointMask(rig.skeleton), call, this.describe());
		rig.masks.set(key, mask);
		return mask;
	}
}

/** The scene's animated objects, which the first rig of the scene creates. */
function animationsOf(scene: Scene): SceneAnimations {
	checks = scene.checks;
	scene.animations ??= new SceneAnimations(scene.core);
	return scene.animations;
}

/** Writes `words` into fresh staging words of the core, for the next call that reads them. */
function stage(core: CoreMemory, call: string, words: Float32Array): void {
	const address = core.checkGrowth(core.glue.animationStaging(words.length), call);
	core.f32(address, words.length).set(words);
}

/** A rig's skeleton in the core, while its clips are made. */
interface RigStart {
	animations: SceneAnimations;
	core: CoreMemory;
	skeleton: number;
	rate: number;
}

/**
 * Stores a skeleton and its clips in the engine core, for objects to animate with, and resamples
 * the clips on this thread. Test pages call it; the glTF loader calls `loadAnimationRig`. It
 * allocates.
 */
export function createAnimationRig(scene: Scene, data: RigData): AnimationRig {
	const start = startRig(scene, data);
	const { core } = start;
	const ids = data.clips.map((clip) => {
		stageClip(core, clip);
		const call = `the clip "${clip.name}"`;
		return core.checkGrowth(
			core.glue.createClip(start.skeleton, clip.tracks.length, start.rate),
			call,
		);
	});
	return finishRig(start, data, ids);
}

/**
 * Stores a skeleton and its clips in the engine core, as `createAnimationRig` does, but the job
 * workers resample the clips between frames, so no frame waits for them. Without job workers,
 * this thread resamples them, a few milliseconds at a time between frames. Throws the core's
 * E1218 for a clip that the core refuses, after every other clip is done.
 */
export async function loadAnimationRig(scene: Scene, data: RigData): Promise<AnimationRig> {
	const start = startRig(scene, data);
	const { core } = start;
	const tickets = data.clips.map((clip) => {
		stageClip(core, clip);
		const call = `the clip "${clip.name}"`;
		return core.checkGrowth(
			core.glue.createClipLater(start.skeleton, clip.tracks.length, start.rate),
			call,
		);
	});
	const ids = new Array<number>(tickets.length).fill(0);
	let failure: unknown;
	for (let left = tickets.length; left > 0; ) {
		const round = performance.now();
		for (let k = 0; k < tickets.length && performance.now() - round < CLIP_ROUND_MS; k++) {
			if (ids[k] !== 0) continue;
			const id = core.glue.clipReady(tickets[k] as number);
			if (id === C.ANIMATION_CLIP_PENDING) continue;
			// A job worker's resampling can grow the engine's memory.
			core.refresh();
			left--;
			ids[k] = id === 0 ? -1 : id;
			if (id === 0 && failure === undefined)
				try {
					core.check(id, 'assets.loadGltf', `the clip "${data.clips[k]?.name}"`);
				} catch (error) {
					failure = error;
				}
		}
		if (left > 0) await new Promise((resolve) => setTimeout(resolve, CLIP_WAIT_MS));
	}
	if (failure !== undefined) throw failure;
	return finishRig(start, data, ids);
}

/**
 * The longest that one round of `loadAnimationRig` asks for finished clips before it lets the
 * thread run frames. Without job workers, each ask resamples a clip.
 */
const CLIP_ROUND_MS = 4;
/** How long `loadAnimationRig` waits between rounds, in milliseconds. */
const CLIP_WAIT_MS = 2;

/** Checks a rig's names, and stores its skeleton in the core. */
function startRig(scene: Scene, data: RigData): RigStart {
	const animations = animationsOf(scene);
	const names = new Set<string>();
	for (const clip of data.clips) {
		if (names.has(clip.name)) refuse(`the model has two clips named "${clip.name}".`);
		names.add(clip.name);
		for (const event of clip.events ?? [])
			if (event.name === LOOP || event.name === FINISHED)
				refuse(
					`the clip "${clip.name}" has an event named "${event.name}", a name the animator keeps for itself.`,
				);
	}
	const { core } = animations;
	stage(core, RIG_CALL, skeletonWords(data.joints));
	const skeleton = core.checkGrowth(core.glue.createSkeleton(data.joints.length), RIG_CALL);
	return { animations, core, skeleton, rate: data.rate ?? 0 };
}

/** What error messages call the data of a rig. */
const RIG_CALL = 'the animation data';

/** Names a rig's clips and stores their events, once the core holds the clips with `ids`. */
function finishRig(start: RigStart, data: RigData, ids: readonly number[]): AnimationRig {
	const { animations, core } = start;
	const named = new Map<string, number>();
	data.clips.forEach((clip, k) => {
		const id = ids[k] as number;
		named.set(clip.name, id);
		animations.clipNames[id - 1] = clip.name;
		const events = clip.events ?? [];
		if (events.length === 0) return;
		const eventWords = new Float32Array(events.length * 2);
		const eventIds = new Uint32Array(eventWords.buffer, events.length * 4, events.length);
		events.forEach((event, e) => {
			eventWords[e] = event.time;
			eventIds[e] = animations.eventId(event.name);
		});
		stage(core, RIG_CALL, eventWords);
		core.check(core.glue.setClipEvents(id, events.length), RIG_CALL, undefined, true);
	});
	return new AnimationRig(start.skeleton, named, data.joints);
}

/**
 * A skeleton's staging words, as `createSkeleton` reads them: each joint's parent, then the rest
 * poses, then the inverse bind matrices.
 */
export function skeletonWords(joints: readonly RigJoint[]): Float32Array {
	const count = joints.length;
	const restAt = count;
	const bindAt = restAt + count * C.ANIMATION_REST_FLOATS;
	const words = new Float32Array(bindAt + count * BIND_FLOATS);
	const parents = new Uint32Array(words.buffer, 0, count);
	joints.forEach((joint, j) => {
		parents[j] = joint.parent < 0 ? NO_PARENT : joint.parent;
		words.set(
			[...joint.translation, ...joint.rotation, ...joint.scale],
			restAt + j * C.ANIMATION_REST_FLOATS,
		);
		words.set(joint.inverseBind, bindAt + j * BIND_FLOATS);
	});
	return words;
}

/** Writes one clip's tracks into the staging words, as `createClip` reads them. */
function stageClip(core: CoreMemory, clip: RigClip): void {
	stage(core, `the clip "${clip.name}"`, clipWords(clip));
}

/**
 * A clip's staging words, as `createClip` and `createClipLater` read them: a header per track
 * (joint, channel, interpolation, key count), then each track's key times and values.
 */
export function clipWords(clip: RigClip): Float32Array {
	const { tracks } = clip;
	const keys = tracks.reduce((sum, t) => sum + t.times.length + t.values.length, 0);
	const words = new Float32Array(tracks.length * C.ANIMATION_TRACK_WORDS + keys);
	const header = new Uint32Array(words.buffer);
	let at = tracks.length * C.ANIMATION_TRACK_WORDS;
	tracks.forEach((track, k) => {
		const interpolation = INTERPOLATIONS[track.interpolation ?? 'linear'];
		header.set(
			[track.joint, CHANNELS[track.channel], interpolation, track.times.length],
			k * C.ANIMATION_TRACK_WORDS,
		);
		words.set(track.times, at);
		words.set(track.values, at + track.times.length);
		at += track.times.length + track.values.length;
	});
	return words;
}

/**
 * Skins `mesh`'s vertices with the joints of the object that `animator` moves, from the next
 * frame: each vertex follows its four joints by its weights, in the space of that object, and the
 * mesh's own world matrix then places it. The mesh's vertices name the skeleton's joints by their
 * places in the rig. A mesh whose geometry has no joints and weights, or names joints that the
 * skeleton lacks, draws as it is. The mesh culls with bounds that the pose moves. Loaders call it.
 */
export function skinObject(mesh: Mesh, animator: Animator): void {
	if (DEV) checks.checkLive('skinObject', mesh);
	if (animator.instance === 0)
		refuse(`skinObject() got the animator of ${animator.describe()}, which is destroyed.`);
	mesh.scene.command(C.COMMAND_SET_SKIN, mesh.handle, animator.instance, 0, 'skinObject');
	animator.skinned.push(mesh);
}

/**
 * Animates the morph weights of `mesh` with the clips of the object that `animator` moves, from
 * the next frame: the joints of its skeleton from `mesh.morphJoint` on hold the weights that the
 * clips give, three to a joint, which blend with the mesh's own as `setMorphWeight` says. A mesh
 * without morph weights stays as it is. Loaders call it.
 */
export function morphObject(mesh: Mesh, animator: Animator): void {
	if (DEV) checks.checkLive('morphObject', mesh);
	if (mesh.morphBlock === 0 || mesh.morphJoint < 0) return;
	const { core } = mesh.scene;
	const linked = core.glue.linkMorphWeights(
		mesh.morphBlock - 1,
		animator.instance,
		mesh.morphJoint,
	);
	core.check(linked, 'morphObject', mesh.describe(), true);
	animator.morphed.push(mesh);
}

/** Animates `object` with `rig`: gives it an animator, which `object.animator()` returns. */
export function animateObject(object: Object3D, rig: AnimationRig): Animator {
	const animations = animationsOf(object.scene);
	const { core } = animations;
	const instance = core.checkGrowth(
		core.glue.createAnimatedInstance(rig.skeleton),
		'animateObject',
		object.label,
	);
	const animator = new Animator(animations, object, rig, instance);
	animations.animators[instance - 1] = animator;
	object.animation = animator;
	return animator;
}
