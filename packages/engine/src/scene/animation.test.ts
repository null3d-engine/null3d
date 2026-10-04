import { beforeEach, describe, expect, test } from 'bun:test';
import type { EngineError } from '../errors/engine-error';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import type { CoreGlue } from '../shared/core';
import {
	type AnimationEvent,
	animateObject,
	createAnimationRig,
	type RigData,
	type RigJoint,
} from './animation';
import { CoreMemory } from './memory';
import { Group, Scene } from './scene';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Where the fake core keeps each array in its memory, in bytes. */
const AT = {
	timeScales: 0,
	layerWeights: 4096,
	events: 20_480,
	totals: 36_864,
	staging: 40_960,
	sceneArrays: 131_072,
	ring: 196_608,
	slotSources: 262_144,
	slotWeights: 294_912,
	blendValues: 327_680,
	playArgs: 344_064,
};
/** Object slots of the fake scene. */
const CAPACITY = 7;

/**
 * A core whose animation calls record their arguments and the staging words they read. Its ids
 * count up from 1, as the core's ids plus one do.
 */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 8 });
	const calls: [string, ...number[]][] = [];
	const staged: number[][] = [];
	let stagedWords = 0;
	let next = 1;
	let failure = { code: 0, details: [0, 0] };
	const words = () => {
		const out = [...new Uint32Array(memory.buffer, AT.staging, stagedWords)];
		staged.push(out);
		return out;
	};
	const record =
		(name: string, result = 0) =>
		(...args: number[]) => {
			calls.push([name, ...args]);
			return result;
		};
	const created =
		(name: string, readsStaging = false) =>
		(...args: number[]) => {
			if (readsStaging) words();
			calls.push([name, ...args]);
			return next++;
		};
	const fields: Record<number, number> = {
		[C.ANIMATION_FIELD_TIME_SCALES]: AT.timeScales,
		[C.ANIMATION_FIELD_LAYER_WEIGHTS]: AT.layerWeights,
		[C.ANIMATION_FIELD_EVENTS]: AT.events,
		[C.ANIMATION_FIELD_EVENT_TOTALS]: AT.totals,
		[C.ANIMATION_FIELD_SLOT_SOURCES]: AT.slotSources,
		[C.ANIMATION_FIELD_SLOT_WEIGHTS]: AT.slotWeights,
		[C.ANIMATION_FIELD_BLEND_VALUES]: AT.blendValues,
		[C.ANIMATION_FIELD_PLAY_ARGS]: AT.playArgs,
	};
	/** The play numbers that a call reads, in the order of the `ANIMATION_ARG_*` places. */
	const args = () => [...new Float32Array(memory.buffer, AT.playArgs, C.ANIMATION_ARGS)];
	const glue = {
		initAnimations: record('initAnimations'),
		animationArrays: (field: number) => fields[field],
		animationStaging: (count: number) => {
			stagedWords = count;
			return AT.staging;
		},
		createSkeleton: created('createSkeleton', true),
		createClip: created('createClip', true),
		createJointMask: created('createJointMask', true),
		setClipEvents: (clip: number, count: number) => {
			words();
			calls.push(['setClipEvents', clip, count]);
			return 0;
		},
		createAnimatedInstance: created('createAnimatedInstance'),
		removeAnimatedInstance: record('removeAnimatedInstance'),
		animatorPlay: (...given: number[]) => {
			calls.push(['animatorPlay', ...given, ...args()]);
			return 0;
		},
		animatorPlayBlend: (...given: number[]) => {
			words();
			calls.push(['animatorPlayBlend', ...given, ...args().slice(0, 3)]);
			return 0;
		},
		animatorStop: record('animatorStop'),
		setLayerMask: record('setLayerMask'),
		updateAnimations: record('updateAnimations'),
		sceneCapacity: () => CAPACITY,
		sceneArrays: () => AT.sceneArrays,
		commandRing: (field: number) => (field === C.RING_FIELD_CAPACITY ? 16 : AT.ring),
		lastErrorCode: () => failure.code,
		lastErrorDetail: (index: number) => failure.details[index] ?? 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const scene = new Scene(core, { frame: 5 }, false);
	return {
		scene,
		calls,
		staged,
		fail(code: number, details: [number, number]) {
			failure = { code, details };
			glue.animatorPlay = () => code;
		},
		/** Writes the records of a frame step's events: instance id, kind, layer, clip id, event id. */
		events(records: [number, number, number, number, number][], dropped = 0) {
			const out = new Uint32Array(memory.buffer, AT.events, records.length * 4);
			records.forEach(([instance, kind, layer, clip, id], k) => {
				out.set([instance, (k << 16) | (kind << 8) | layer, clip, id], k * 4);
			});
			new Uint32Array(memory.buffer, AT.totals, 2).set([records.length, dropped]);
		},
		f32: (at: number, length: number) => [...new Float32Array(memory.buffer, at, length)],
		/** Puts clip ids, as the core's ids, into the sample slots of instance `instance`. */
		slots(instance: number, clips: number[]) {
			const at = AT.slotSources + instance * C.ANIMATION_MAX_BLEND * 4;
			const sources = new Uint32Array(memory.buffer, at, C.ANIMATION_MAX_BLEND);
			sources.fill(C.ANIMATION_NO_SOURCE);
			sources.set(clips);
		},
	};
}

/** A joint at rest with an identity bind matrix. */
function joint(name: string, parent: number): RigJoint {
	return {
		name,
		parent,
		translation: [0, 1, 0],
		rotation: [0, 0, 0, 1],
		scale: [1, 1, 1],
		inverseBind: [1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0],
	};
}

/** A body: hips, then a spine with a head and an arm, and a leg. */
const RIG: RigData = {
	joints: [
		joint('Hips', -1),
		joint('Spine', 0),
		joint('Head', 1),
		joint('Arm', 1),
		joint('Leg', 0),
	],
	clips: [
		{
			name: 'walk',
			tracks: [
				{ joint: 0, channel: 'translation', times: [0, 1], values: [0, 1, 0, 0, 1, 1] },
				{ joint: 3, channel: 'rotation', interpolation: 'step', times: [0], values: [0, 0, 0, 1] },
			],
			events: [
				{ time: 0.5, name: 'footstep' },
				{ time: 0.25, name: 'wave' },
			],
		},
		{
			name: 'run',
			tracks: [{ joint: 4, channel: 'scale', times: [0, 0.5], values: [1, 1, 1, 2, 2, 2] }],
		},
	],
};

/** A scene with the rig, and an object that animates with it. */
function animated() {
	const fake = fakeCore();
	const rig = createAnimationRig(fake.scene, RIG);
	const hero = new Group(fake.scene, 3, 'Hero');
	const animator = animateObject(hero, rig);
	fake.calls.length = 0;
	return { ...fake, rig, hero, animator };
}

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

describe('rigs', () => {
	test('stage the skeleton and clips as the core reads them', () => {
		const fake = fakeCore();
		createAnimationRig(fake.scene, { ...RIG, rate: 24 });
		const floats = (words: number[]) => [...new Float32Array(new Uint32Array(words).buffer)];
		const [skeleton, walk, run, walkEvents] = fake.staged as number[][];
		const joints = RIG.joints.length;
		expect(skeleton?.slice(0, joints)).toEqual([0xffff_ffff, 0, 1, 1, 0]);
		const rest = floats(skeleton as number[]).slice(joints, joints + C.ANIMATION_REST_FLOATS);
		expect(rest).toEqual([0, 1, 0, 0, 0, 0, 1, 1, 1, 1]);
		expect(skeleton).toHaveLength(joints * (1 + C.ANIMATION_REST_FLOATS + 12));
		// Two track headers, then each track's times and values.
		expect(walk?.slice(0, 8)).toEqual([
			0,
			C.ANIMATION_TRANSLATION,
			C.ANIMATION_LINEAR,
			2,
			3,
			C.ANIMATION_ROTATION,
			C.ANIMATION_STEP,
			1,
		]);
		expect(floats(walk as number[]).slice(8)).toEqual([0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1]);
		// Event times, then their ids: one per name.
		expect(floats(walkEvents as number[]).slice(0, 2)).toEqual([0.5, 0.25]);
		expect(walkEvents?.slice(2)).toEqual([1, 2]);
		expect(run?.slice(0, 4)).toEqual([4, C.ANIMATION_SCALE, C.ANIMATION_LINEAR, 2]);
		expect(fake.calls).toEqual([
			['initAnimations', 1024, 65_536],
			['createSkeleton', joints],
			['createClip', 1, 2, 24],
			['createClip', 1, 1, 24],
			['setClipEvents', 2, 2],
		]);
	});

	test('refuse two clips of one name, and events with the names the animator keeps', () => {
		const { scene } = fakeCore();
		const [walk] = RIG.clips;
		const twice = thrown(() => createAnimationRig(scene, { ...RIG, clips: [walk, walk] as never }));
		expect(twice.code).toBe('E1218');
		expect(twice.message).toContain('two clips named "walk"');
		const looping = { name: 'jump', tracks: [], events: [{ time: 0, name: 'loop' }] };
		const kept = thrown(() => createAnimationRig(scene, { ...RIG, clips: [looping] }));
		expect(kept.message).toContain('an event named "loop"');
	});
});

describe('the animator', () => {
	test('belongs only to objects with animation clips', () => {
		const { scene, hero, animator } = animated();
		expect(hero.animator()).toBe(animator);
		expect(animator.clips).toEqual(['walk', 'run']);
		const box = new Group(scene, 4, 'Box');
		const error = thrown(() => box.animator());
		expect(error.code).toBe('E1218');
		expect(error.message).toContain('animator() was called on "Box" (slot 4)');
	});

	test('plays, cross-fades and stops clips by name', () => {
		const { calls, animator } = animated();
		const { ANIMATION_PLAY_LOOP: LOOP, ANIMATION_PLAY_ADDITIVE: ADD } = C;
		animator.play('walk');
		animator.play('run', { fade: 0.25, speed: -2, layer: 1, loop: false });
		animator.play('walk', { layer: 3, additive: true });
		animator.crossFade('run', 0.5, { speed: 1.5 });
		animator.stop('walk', { fade: 0.2 });
		animator.stop();
		const instance = 4;
		expect(calls).toEqual([
			// The instance, clip and layer, the flags, then the fade, speed, time and weight.
			['animatorPlay', instance, 2, 0, LOOP, 0, 1, 0, 1],
			['animatorPlay', instance, 3, 1, 0, 0.25, -2, 0, 1],
			['animatorPlay', instance, 2, 3, LOOP | ADD, 0, 1, 0, 1],
			['animatorPlay', instance, 3, 0, LOOP, 0.5, 1.5, 0, 1],
			['animatorStop', instance, 2, 0.2],
			['animatorStop', instance, 0, 0],
		]);
	});

	test('plays clips from a start time and at a weight, beside the clips of their layer', () => {
		const { calls, animator } = animated();
		const { ANIMATION_PLAY_LOOP: LOOP, ANIMATION_PLAY_TIME: TIME } = C;
		const WEIGHT = C.ANIMATION_PLAY_WEIGHT;
		const JOIN = C.ANIMATION_PLAY_JOIN;
		const f = Math.fround;
		animator.play('walk', { time: 0.4 });
		animator.play('walk', { time: 0.25, weight: 0.3 });
		animator.play('run', { weight: 0 });
		// A cross-fade takes over its layer, with a weight too.
		animator.crossFade('run', 0.5, { weight: 0.5 });
		const instance = 4;
		expect(calls).toEqual([
			['animatorPlay', instance, 2, 0, LOOP | TIME, 0, 1, f(0.4), 1],
			['animatorPlay', instance, 2, 0, LOOP | TIME | WEIGHT | JOIN, 0, 1, 0.25, f(0.3)],
			['animatorPlay', instance, 3, 0, LOOP | WEIGHT | JOIN, 0, 1, 0, 0],
			['animatorPlay', instance, 3, 0, LOOP | WEIGHT, 0.5, 1, 0, 0.5],
		]);
	});

	test('sets the weight of each slot that plays a clip, in engine memory', () => {
		const { animator, f32, slots, calls } = animated();
		// The object's instance is the core's instance 3. Walk is clip 1 in the core, run clip 2;
		// walk plays on two layers.
		slots(3, [1, 2, 1]);
		animator.setWeight('walk', 0.25);
		animator.setWeight('run', 0);
		const at = AT.slotWeights + 3 * C.ANIMATION_MAX_BLEND * 4;
		expect(f32(at, 4)).toEqual([0.25, 0, 0.25, 0]);
		expect(f32(AT.slotWeights, C.ANIMATION_MAX_BLEND)).toEqual(
			new Array(C.ANIMATION_MAX_BLEND).fill(0),
		);
		expect(calls).toEqual([]);
	});

	test('refuses weights it cannot set', () => {
		const { animator, slots } = animated();
		slots(3, [2]);
		const idle = thrown(() => animator.setWeight('walk', 0.5));
		expect(idle.code).toBe('E1218');
		expect(idle.message).toContain(
			`setWeight() got "walk", which does not play on "Hero" (slot 3). Play it first, for example with play('walk', { weight }).`,
		);
		expect(thrown(() => animator.setWeight('run', -0.5)).message).toContain(
			'setWeight() got the weight -0.5 on "Hero" (slot 3); it takes 0 or more.',
		);
		expect(thrown(() => animator.setWeight('run', Number.NaN)).code).toBe('E1203');
		expect(thrown(() => animator.setWeight('jog', 1)).code).toBe('E1218');
		expect(thrown(() => animator.play('walk', { weight: -1 })).message).toContain(
			'play() got the weight -1',
		);
		expect(thrown(() => animator.play('walk', { time: Infinity })).code).toBe('E1203');
	});

	test('plays a 1D blend, and writes its value into engine memory', () => {
		const { calls, staged, animator, f32 } = animated();
		const { ANIMATION_PLAY_LOOP: LOOP, ANIMATION_PLAY_TIME: TIME } = C;
		animator.playBlend({ walk: 1.5, run: 4 }, { value: 2, fade: 0.3, layer: 1 });
		animator.playBlend({ run: 0 }, { loop: false, speed: -1, phase: 0.25 });
		animator.setBlend(3.25, 2);
		const instance = 4;
		expect(calls).toEqual([
			// The instance, the clip count, the layer and the flags, then the fade, speed and phase.
			['animatorPlayBlend', instance, 2, 1, LOOP, Math.fround(0.3), 1, 0],
			['animatorPlayBlend', instance, 1, 0, TIME, 0, -1, 0.25],
		]);
		// The clips' ids plus one, then their points.
		const [two, one] = staged.slice(-2) as number[][];
		const floats = (words: number[]) => [...new Float32Array(new Uint32Array(words).buffer)];
		expect(two?.slice(0, 2)).toEqual([2, 3]);
		expect(floats(two as number[]).slice(2)).toEqual([1.5, 4]);
		expect(one?.[0]).toBe(3);
		const at = AT.blendValues + 3 * C.ANIMATION_MAX_LAYERS * 4;
		expect(f32(at, C.ANIMATION_MAX_LAYERS)).toEqual([0, 2, 3.25, 0]);
	});

	test('refuses blends it cannot play', () => {
		const { animator, calls } = animated();
		expect(thrown(() => animator.playBlend({})).message).toContain(
			'playBlend() got 0 clips on "Hero" (slot 3); a blend takes 1 to 8.',
		);
		expect(thrown(() => animator.playBlend({ walk: 1, run: 1 })).message).toContain(
			'playBlend() got the point 1 for "walk" and "run" on "Hero" (slot 3); give each clip a point of its own.',
		);
		expect(thrown(() => animator.playBlend({ walk: 0, jog: 1 })).message).toContain(
			'playBlend() got "jog", which names no clip',
		);
		expect(thrown(() => animator.playBlend({ walk: Number.NaN })).code).toBe('E1203');
		expect(thrown(() => animator.playBlend({ walk: 0 }, { phase: Infinity })).code).toBe('E1203');
		expect(thrown(() => animator.playBlend({ walk: 0 }, { layer: 5 })).code).toBe('E1218');
		expect(thrown(() => animator.setBlend(Number.NaN)).code).toBe('E1203');
		expect(calls).toEqual([]);
	});

	test('checks the layer of a write into engine memory in every build', () => {
		const { animator, f32 } = animated();
		for (const layer of [4, -1, 1.5, Number.NaN]) {
			expect(thrown(() => animator.setBlend(1, layer)).code).toBe('E1218');
			expect(thrown(() => animator.setLayerWeight(layer, 1)).code).toBe('E1218');
		}
		// The next object's layers stay as they were.
		const next = AT.blendValues + 4 * C.ANIMATION_MAX_LAYERS * 4;
		expect(f32(next, C.ANIMATION_MAX_LAYERS)).toEqual([0, 0, 0, 0]);
	});

	test('refuses names and options it cannot use', () => {
		const { animator, calls } = animated();
		const unknown = thrown(() => animator.play('rnu'));
		expect(unknown.code).toBe('E1218');
		expect(unknown.message).toContain(
			'play() got "rnu", which names no clip of "Hero" (slot 3). Its clips are walk and run.',
		);
		expect(thrown(() => animator.stop('jog')).code).toBe('E1218');
		expect(thrown(() => animator.play('walk', { layer: 4 })).message).toContain(
			'got the layer 4 on "Hero" (slot 3); it takes a whole number from 0 to 3',
		);
		expect(thrown(() => animator.play('walk', { layer: 1.5 })).code).toBe('E1218');
		expect(thrown(() => animator.crossFade('walk', -1)).message).toContain(
			'crossFade() got the fade -1',
		);
		expect(thrown(() => animator.play('walk', { fade: Number.NaN })).code).toBe('E1203');
		expect(thrown(() => animator.play('walk', { speed: Infinity })).code).toBe('E1203');
		expect(thrown(() => animator.setLayerWeight(0, 1.5)).code).toBe('E1218');
		expect(thrown(() => animator.setLayerWeight(-1, 0.5)).code).toBe('E1218');
		expect(thrown(() => animator.setLayerWeight(1, Number.NaN)).code).toBe('E1203');
		expect(thrown(() => animator.setTimeScale(Number.NaN)).code).toBe('E1203');
		expect(thrown(() => animator.setLayerMask(1, 'Tail')).message).toContain(
			'setLayerMask() got "Tail", which names no joint of "Hero" (slot 3).',
		);
		expect(calls).toEqual([]);
	});

	test('names the core failure of a call', () => {
		const { animator, fail } = animated();
		fail(1218, [C.ANIMATION_PROBLEM_PLAY, 1]);
		const error = thrown(() => animator.play('walk'));
		expect(error.code).toBe('E1218');
		expect(error.message).toContain('play() on "Hero" (slot 3) failed');
	});

	test('writes layer weights and the time scale into engine memory', () => {
		const { animator, f32 } = animated();
		expect(animator.timeScale).toBe(0);
		animator.setTimeScale(0.5);
		animator.setLayerWeight(2, 0.75);
		expect(animator.timeScale).toBe(0.5);
		// The object's instance is the core's instance 3: the fourth of each array.
		expect(f32(AT.timeScales, 4)).toEqual([0, 0, 0, 0.5]);
		const weights = f32(AT.layerWeights + 3 * C.ANIMATION_MAX_LAYERS * 4, C.ANIMATION_MAX_LAYERS);
		expect(weights).toEqual([0, 0, 0.75, 0]);
	});

	test('masks layers to the named joints and every joint below them', () => {
		const { animator, calls, staged } = animated();
		animator.setLayerMask(1, 'Spine');
		animator.setLayerMask(2, ['Spine']);
		animator.setLayerMask(3, ['Leg', 'Head']);
		animator.setLayerMask(1, null);
		const masks = staged
			.slice(-2)
			.map((words) => [...new Float32Array(new Uint32Array(words).buffer)]);
		// Hips, Spine, Head, Arm, Leg.
		expect(masks).toEqual([
			[0, 1, 1, 1, 0],
			[0, 0, 1, 0, 1],
		]);
		expect(calls).toEqual([
			['createJointMask', 1],
			['setLayerMask', 4, 1, 5],
			['setLayerMask', 4, 2, 5],
			['createJointMask', 1],
			['setLayerMask', 4, 3, 6],
			['setLayerMask', 4, 1, 0],
		]);
	});

	test('gives each handler its events, in order, with the clip and the layer', () => {
		const { scene, animator, rig, events } = animated();
		const other = animateObject(new Group(scene, 5, 'Guard'), rig);
		const heard: string[] = [];
		const hear = (who: string) => (e: AnimationEvent) =>
			heard.push(`${who} ${e.name} ${e.clip} ${e.layer}`);
		animator.onEvent('footstep', hear('hero'));
		const stop = animator.onEvent('loop', hear('hero'));
		animator.onEvent('finished', hear('hero'));
		other.onEvent('wave', hear('guard'));
		const failures: unknown[] = [];
		animator.onEvent('wave', () => {
			throw new Error('a broken handler');
		});
		animator.onEvent('wave', hear('hero'));
		const CLIP = C.ANIMATION_EVENT_CLIP;
		const LOOP = C.ANIMATION_EVENT_LOOP;
		const END = C.ANIMATION_EVENT_FINISHED;
		// Instances 3 and 4 in the core are the hero and the guard; clip 1 is walk, 2 is run.
		events([
			[3, CLIP, 0, 1, 1],
			[3, CLIP, 2, 1, 2],
			[3, LOOP, 0, 1, 0],
			[3, END, 1, 2, 0],
			[4, CLIP, 0, 1, 2],
			[4, CLIP, 0, 1, 1],
		]);
		scene.animations?.dispatch((error) => failures.push(error));
		expect(heard).toEqual([
			'hero footstep walk 0',
			'hero wave walk 2',
			'hero loop walk 0',
			'hero finished run 1',
			'guard wave walk 0',
		]);
		expect(failures).toHaveLength(1);
		stop();
		heard.length = 0;
		events([[3, LOOP, 0, 1, 0]]);
		scene.animations?.dispatch(() => {});
		expect(heard).toEqual([]);
	});

	test('leaves the core when its object is destroyed', () => {
		const { hero, animator, calls, scene, events } = animated();
		const heard: string[] = [];
		animator.onEvent('loop', () => heard.push('loop'));
		hero.destroy();
		expect(calls).toEqual([['removeAnimatedInstance', 4]]);
		expect(thrown(() => animator.play('walk')).code).toBe('E1101');
		expect(thrown(() => hero.animator()).code).toBe('E1101');
		events([[3, C.ANIMATION_EVENT_LOOP, 0, 1, 0]]);
		scene.animations?.dispatch(() => {});
		expect(heard).toEqual([]);
	});
});
