// The animator: each animated object's calls to play, fade and stop its clips, its layers' weights
// and joint masks, its time scale and its event handlers. The engine core keeps each object's
// clips, times and fades, and its frame step advances and blends them on the job workers. Calls
// here change that state in the core; the layer weights and the time scale are numbers in engine
// memory, which these calls write directly, so a sketch can change them every frame for free.
// After each frame step, the events that the clips passed reach the sketch's handlers. A rig
// holds a skeleton and its named clips in the core, which every object that animates with it
// shares. Only engine code creates rigs, from the models it loads.

import { checkLive, checkNumber, DEV, type Described } from '../errors/checks';
import { coreFailure } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import type { Mesh, Object3D, Quat, Scene, Vec3 } from './scene';

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

/** One joint of a rig's skeleton. Joints come parents first. */
export interface RigJoint {
	name: string;
	/** The index of the parent joint, or -1 for a root. */
	parent: number;
	translation: Vec3;
	rotation: Quat;
	scale: Vec3;
	/** The inverse of the joint's matrix at bind time, row-major 3 × 4: 12 numbers. */
	inverseBind: ArrayLike<number>;
}

/** One track of a rig's clip: keys of one channel of one joint, at any times. */
export interface RigTrack {
	joint: number;
	channel: keyof typeof CHANNELS;
	/** True holds each key until the next, instead of moving in a straight line. */
	step?: boolean;
	times: ArrayLike<number>;
	/** Three numbers per key, or four for a rotation. */
	values: ArrayLike<number>;
}

/** A named clip of a rig, with its events. */
export interface RigClip {
	name: string;
	tracks: readonly RigTrack[];
	events?: readonly { time: number; name: string }[];
}

/** A skeleton and its clips, as a loaded model gives them. */
export interface RigData {
	joints: readonly RigJoint[];
	clips: readonly RigClip[];
	/** Keys per second that clips are stored at, unless their own keys lie on a coarser grid. */
	rate?: number;
}

/** A skeleton and its named clips in the engine core, which animated objects share. */
export class AnimationRig {
	/** The joint masks made so far, by their joint names. */
	readonly masks = new Map<string, number>();

	constructor(
		/** The skeleton's id in the core, plus one. */
		readonly skeleton: number,
		/** Each clip's id in the core, plus one, by name. */
		readonly clips: ReadonlyMap<string, number>,
		readonly jointNames: readonly string[],
		readonly parents: readonly number[],
	) {}
}

/** Throws E1218 with `detail`. */
function refuse(detail: string): never {
	throw new EngineError('E1218', detail);
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
	 * The frame step: advances every played clip by `stepUs` whole microseconds and poses every
	 * animated object, on the job workers.
	 */
	update(stepUs: number): void {
		this.core.check(this.core.glue.updateAnimations(stepUs), 'the animation step', undefined, true);
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
			checkLive(call, this.object);
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
			checkLive(call, this.object);
			this.checkLayer(call, layer);
			checkNumber(call, 'weight', weight, this);
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
			checkLive(call, this.object);
			this.checkLayer(call, layer);
		}
		const mask =
			joints === null ? 0 : this.mask(call, typeof joints === 'string' ? [joints] : joints);
		this.done(this.system.core.glue.setLayerMask(this.instance, layer, mask), call);
	}

	/** Sets the rate of the object's animation time: 1 plays clips as made, 0 pauses them all. */
	setTimeScale(scale: number): void {
		if (DEV) {
			checkLive('setTimeScale', this.object);
			checkNumber('setTimeScale', 'scale', scale, this);
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
	 * @internal Removes the object's animation from the engine core, when the object is destroyed.
	 * The meshes that its joints skin stop being skinned, and keep their last pose's bounds.
	 */
	release(): void {
		if (this.instance === 0) return;
		for (const mesh of this.skinned)
			if (mesh.row !== 0) mesh.scene.command(C.COMMAND_SET_SKIN, mesh.handle, 0, 0, 'destroy');
		this.skinned.length = 0;
		this.done(this.system.core.glue.removeAnimatedInstance(this.instance), 'destroy');
		this.system.animators[this.instance - 1] = undefined;
		this.instance = 0;
	}

	private start(call: string, name: string, fade: number, options: PlayOptions | undefined): void {
		const clip = this.clip(call, name);
		const speed = options?.speed ?? 1;
		const layer = options?.layer ?? 0;
		if (DEV) {
			checkLive(call, this.object);
			this.checkFade(call, fade);
			checkNumber(call, 'speed', speed, this);
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
		if (status !== 0) throw coreFailure(this.system.core.glue, call, this.describe());
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
		checkNumber(call, 'fade', fade, this);
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
	scene.animations ??= new SceneAnimations(scene.core);
	return scene.animations;
}

/** Writes `words` into fresh staging words of the core, for the next call that reads them. */
function stage(core: CoreMemory, call: string, words: Float32Array): void {
	const address = core.checkGrowth(core.glue.animationStaging(words.length), call);
	core.f32(address, words.length).set(words);
}

/**
 * Stores a skeleton and its clips in the engine core, for objects to animate with. Loaders call it
 * once per model; it allocates.
 */
export function createAnimationRig(scene: Scene, data: RigData): AnimationRig {
	const call = 'the animation data';
	const animations = animationsOf(scene);
	const { core } = animations;
	const { joints, clips } = data;
	const count = joints.length;
	// Each joint's parent, then rest poses, then inverse bind matrices, as the core reads them.
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
		words.set(Array.from(joint.inverseBind), bindAt + j * BIND_FLOATS);
	});
	stage(core, call, words);
	const skeleton = core.checkGrowth(core.glue.createSkeleton(count), call);
	const ids = new Map<string, number>();
	for (const clip of clips) {
		if (ids.has(clip.name)) refuse(`the model has two clips named "${clip.name}".`);
		const id = createClip(core, skeleton, clip, data.rate ?? 0);
		ids.set(clip.name, id);
		animations.clipNames[id - 1] = clip.name;
		const events = clip.events ?? [];
		if (events.length === 0) continue;
		const eventWords = new Float32Array(events.length * 2);
		const eventIds = new Uint32Array(eventWords.buffer, events.length * 4, events.length);
		events.forEach((event, k) => {
			if (event.name === LOOP || event.name === FINISHED)
				refuse(
					`the clip "${clip.name}" has an event named "${event.name}", a name the animator keeps for itself.`,
				);
			eventWords[k] = event.time;
			eventIds[k] = animations.eventId(event.name);
		});
		stage(core, call, eventWords);
		core.check(core.glue.setClipEvents(id, events.length), call, undefined, true);
	}
	return new AnimationRig(
		skeleton,
		ids,
		joints.map((j) => j.name),
		joints.map((j) => j.parent),
	);
}

/** Stores one clip's tracks in the core and returns its id plus one. */
function createClip(core: CoreMemory, skeleton: number, clip: RigClip, rate: number): number {
	const { tracks } = clip;
	const keys = tracks.reduce((sum, t) => sum + t.times.length + t.values.length, 0);
	const words = new Float32Array(tracks.length * C.ANIMATION_TRACK_WORDS + keys);
	const header = new Uint32Array(words.buffer);
	let at = tracks.length * C.ANIMATION_TRACK_WORDS;
	tracks.forEach((track, k) => {
		const interpolation = track.step ? C.ANIMATION_STEP : C.ANIMATION_LINEAR;
		header.set(
			[track.joint, CHANNELS[track.channel], interpolation, track.times.length],
			k * C.ANIMATION_TRACK_WORDS,
		);
		words.set(Array.from(track.times), at);
		words.set(Array.from(track.values), at + track.times.length);
		at += track.times.length + track.values.length;
	});
	stage(core, `the clip "${clip.name}"`, words);
	return core.checkGrowth(
		core.glue.createClip(skeleton, tracks.length, rate),
		`the clip "${clip.name}"`,
	);
}

/**
 * Skins `mesh`'s vertices with the joints of the object that `animator` moves, from the next
 * frame: each vertex follows its four joints by its weights, in the space of that object, and the
 * mesh's own world matrix then places it. The mesh's vertices name the skeleton's joints by their
 * places in the rig. A mesh whose geometry has no joints and weights, or names joints that the
 * skeleton lacks, draws as it is. The mesh culls with bounds that the pose moves. Loaders call it.
 */
export function skinObject(mesh: Mesh, animator: Animator): void {
	if (DEV) checkLive('skinObject', mesh);
	if (animator.instance === 0)
		refuse(`skinObject() got the animator of ${animator.describe()}, which is destroyed.`);
	mesh.scene.command(C.COMMAND_SET_SKIN, mesh.handle, animator.instance, 0, 'skinObject');
	animator.skinned.push(mesh);
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
