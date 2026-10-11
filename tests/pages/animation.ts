// Times the engine core's animation step on the job workers, with no drawing: a crowd of generated
// characters, each blending two clips at times of its own (`lib/animation.ts`). The page runs the
// core on its own thread, as the sketch worker does, and starts its own job workers. Each frame
// starts in a requestAnimationFrame callback, wakes the workers as the engine does, and runs the
// step. Switches: ?characters= (500), ?joints=, ?jobs= (logical cores minus 2, at least 1),
// ?frames= and ?warmup=.
import * as C from '../../packages/engine/src/generated/core';
import {
	ANIMATION,
	type AnimationResult,
	crowdCharacter,
	stepTimes,
	type Track,
} from './lib/animation';
import { check, created, stage, startCorePage } from './lib/core-page';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const setting = (name: string, fallback: number) => {
	const value = Number(params.get(name) ?? fallback);
	if (!Number.isInteger(value) || value < 0) throw new Error(`?${name}= takes a whole number`);
	return value;
};

/** A clip's staging words: the track headers, then each track's key times and values. */
function clipWords(tracks: readonly Track[]): Float32Array {
	const keys = tracks.reduce((sum, t) => sum + t.times.length + t.values.length, 0);
	const words = new Float32Array(tracks.length * C.ANIMATION_TRACK_WORDS + keys);
	const header = new Uint32Array(words.buffer);
	tracks.forEach((t, k) => {
		header.set(
			[t.joint, t.channel, C.ANIMATION_LINEAR, t.times.length],
			k * C.ANIMATION_TRACK_WORDS,
		);
	});
	let at = tracks.length * C.ANIMATION_TRACK_WORDS;
	for (const t of tracks) {
		words.set(t.times, at);
		words.set(t.values, at + t.times.length);
		at += t.times.length + t.values.length;
	}
	return words;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

run('animation', async () => {
	const characters = setting('characters', 500);
	const joints = setting('joints', ANIMATION.joints);
	const jobWorkers = setting('jobs', Math.max(1, (navigator.hardwareConcurrency ?? 1) - 2));
	const frames = setting('frames', ANIMATION.frames);
	const warmup = setting('warmup', ANIMATION.warmupFrames);

	const { core, memory, stop } = await startCorePage(jobWorkers, progress);
	try {
		check(core, 'initAnimations', core.initAnimations(characters, characters * joints));
		const character = crowdCharacter(joints);
		const skeletonWords = new Float32Array(joints * (1 + C.ANIMATION_REST_FLOATS + 12));
		new Uint32Array(skeletonWords.buffer).set(character.parents);
		skeletonWords.set(character.rest, joints);
		skeletonWords.set(character.inverseBind, joints * (1 + C.ANIMATION_REST_FLOATS));
		stage(core, memory, skeletonWords);
		const skeleton = created(core, 'createSkeleton', core.createSkeleton(joints));
		const clips = character.clips.map((tracks) => {
			stage(core, memory, clipWords(tracks));
			return (
				created(
					core,
					'createClip',
					core.createClip(skeleton, tracks.length, C.ANIMATION_DEFAULT_RATE),
				) - 1
			);
		});
		for (let i = 0; i < characters; i++)
			created(core, 'createAnimatedInstance', core.createAnimatedInstance(skeleton));

		// The tables are complete, so the memory no longer grows and the views stay valid.
		const slots = characters * C.ANIMATION_MAX_BLEND;
		const view = <T>(
			Type: new (b: ArrayBufferLike, at: number, n: number) => T,
			field: number,
			n: number,
		) => new Type(memory.buffer, created(core, 'animationArrays', core.animationArrays(field)), n);
		const slotClips = view(Uint32Array, C.ANIMATION_FIELD_SLOT_CLIPS, slots);
		const slotTimes = view(Float32Array, C.ANIMATION_FIELD_SLOT_TIMES, slots);
		const slotWeights = view(Float32Array, C.ANIMATION_FIELD_SLOT_WEIGHTS, slots);
		for (let i = 0; i < characters; i++) {
			const at = i * C.ANIMATION_MAX_BLEND;
			slotClips.set(clips, at);
			slotWeights.set(ANIMATION.weights, at);
		}

		const times: number[] = [];
		const busy = () => {
			let sum = 0;
			for (let w = 0; w < jobWorkers; w++) sum += core.takeJobBusyUs(w);
			return sum / 1000;
		};
		for (let frame = 0; frame < warmup + frames; frame++) {
			await nextFrame();
			if (frame === warmup) busy();
			const start = performance.now();
			core.prepareJobs();
			for (let i = 0; i < characters; i++) {
				const t = (frame + i * 7) / 60;
				slotTimes[i * C.ANIMATION_MAX_BLEND] = t % 1;
				slotTimes[i * C.ANIMATION_MAX_BLEND + 1] = (t * 1.3) % 0.75;
			}
			check(core, 'updateAnimations', core.updateAnimations(0));
			if (frame >= warmup) times.push(performance.now() - start);
		}
		const jobMs = busy();
		// The frame steps take turns between two buffers, so the last step's comes after them.
		const matrices = view(
			Float32Array,
			C.ANIMATION_FIELD_MATRICES,
			characters * joints * C.CORE_MATRIX_FLOATS,
		);
		const first = matrices.subarray(0, joints * C.CORE_MATRIX_FLOATS);
		const second = matrices.subarray(
			joints * C.CORE_MATRIX_FLOATS,
			2 * joints * C.CORE_MATRIX_FLOATS,
		);
		const result: AnimationResult = {
			characters,
			joints,
			jobWorkers,
			frames: times.length,
			step: stepTimes(times),
			jobMsPerFrame: times.length ? jobMs / times.length : 0,
			finite: matrices.every(Number.isFinite),
			moved: characters < 2 || first.some((v, k) => v !== second[k]),
		};
		return { ...result };
	} finally {
		await stop();
	}
});
