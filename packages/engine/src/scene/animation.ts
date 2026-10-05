// The animator: each animated object's calls to play, fade and stop its clips, its layers' weights
// and joint masks, its time scale and its event handlers. The engine core keeps each object's
// clips, times and fades, and its frame step advances and blends them on the job workers. Calls
// here change that state in the core; the layer weights and the time scale are numbers in engine
// memory, which these calls write directly, so a sketch can change them every frame for free.
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
 * How `Animator.play` plays a clip.
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
	 * additive clips do. A breathing or aiming clip then plays on top of a walk.
	 */
	additive?: boolean;
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
	 * or with no fade, takes over at once. A clip that already plays on the layer keeps its time
	 * and fades back in. A clip that played once and reached its end starts again.
	 */
	play(name: string, options?: PlayOptions): void {
		this.start('play', name, options?.fade ?? 0, options);
	}

	/**
	 * Fades to a clip over `duration` seconds: `play(name, { ...options, fade: duration })`, the
	 * three.js `crossFadeTo` of the layer's other clips.
	 */
	crossFade(name: string, duration: number, options?: PlayOptions): void {
		this.start('crossFade', name, duration, options);
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
		if (DEV) {
			const call = 'setLayerWeight';
			checks.checkLive(call, this.object);
			this.checkLayer(call, layer);
			checks.checkNumber(call, 'weight', weight, this);
			if (weight < 0 || weight > 1)
				refuse(`${call}() got the weight ${weight} on ${this.describe()}; it takes 0 to 1.`);
		}
		this.system.layerWeights()[(this.instance - 1) * C.ANIMATION_MAX_LAYERS + layer] = weight;
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

	private start(call: string, name: string, fade: number, options: PlayOptions | undefined): void {
		const clip = this.clip(call, name);
		const speed = options?.speed ?? 1;
		const layer = options?.layer ?? 0;
		if (DEV) {
			checks.checkLive(call, this.object);
			this.checkFade(call, fade);
			checks.checkNumber(call, 'speed', speed, this);
			this.checkLayer(call, layer);
		}
		const flags =
			(options?.loop === false ? 0 : C.ANIMATION_PLAY_LOOP) |
			(options?.additive ? C.ANIMATION_PLAY_ADDITIVE : 0);
		const { core } = this.system;
		const status = core.glue.animatorPlay(this.instance, clip, layer, fade, speed, flags);
		// The first additive play of a clip stores its additive form, which can grow the memory.
		core.refresh();
		this.done(status, call);
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

	private checkLayer(call: string, layer: number): void {
		if (Number.isInteger(layer) && layer >= 0 && layer < C.ANIMATION_MAX_LAYERS) return;
		refuse(
			`${call}() got the layer ${layer} on ${this.describe()}; it takes a whole number from 0 to ${C.ANIMATION_MAX_LAYERS - 1}.`,
		);
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
 * Frees a rig's skeleton, clips and joint masks in the engine core, once no animated object uses
 * them. Their ids go to later rigs. Throws E1111 while an animated object uses the skeleton.
 */
export function destroyRig(core: CoreMemory, rig: AnimationRig): void {
	core.check(core.glue.destroySkeleton(rig.skeleton), 'prefab.destroy', 'a model', true);
	rig.masks.clear();
}

/**
 * Stores a skeleton and its clips in the engine core, as `createAnimationRig` does, but the job
 * workers resample the clips between frames, so no frame waits for them. Without job workers,
 * this thread resamples them, a few milliseconds at a time between frames. Throws the core's
 * E1218 for a clip that the core refuses, after every other clip is done, and frees the skeleton
 * and the clips made so far.
 */
export async function loadAnimationRig(scene: Scene, data: RigData): Promise<AnimationRig> {
	const start = startRig(scene, data);
	try {
		return await finishLoad(start, data);
	} catch (error) {
		start.core.glue.destroySkeleton(start.skeleton);
		throw error;
	}
}

/** Makes the clips of a rig whose skeleton `start` stored, on the job workers. */
async function finishLoad(start: RigStart, data: RigData): Promise<AnimationRig> {
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
