// Times the engine core's animation step on the job workers, with no drawing: a crowd of generated
// characters, each blending two clips at times of its own (`lib/animation.ts`). The page runs the
// core on its own thread, as the sketch worker does, and starts its own job workers. Each frame
// starts in a requestAnimationFrame callback, wakes the workers as the engine does, and runs the
// step. Switches: ?characters= (500), ?joints=, ?jobs= (logical cores minus 2, at least 1),
// ?frames= and ?warmup=.
import { type CoreGlue, loadCore, startCore, stopJobWorkersAt } from '@null3d/engine/internal';
import * as C from '../../packages/engine/src/generated/core';
import {
	ANIMATION,
	type AnimationResult,
	crowdCharacter,
	stepTimes,
	type Track,
} from './lib/animation';
import { progress, run } from './lib/result';

/** How long the job workers may take to start, or to leave their loops at the end. */
const WORKER_TIMEOUT_MS = 20_000;

const params = new URLSearchParams(location.search);
const setting = (name: string, fallback: number) => {
	const value = Number(params.get(name) ?? fallback);
	if (!Number.isInteger(value) || value < 0) throw new Error(`?${name}= takes a whole number`);
	return value;
};

/** Fails with the core's last error when a call returned `status`, which is 0 for success. */
function check(glue: CoreGlue, call: string, status: number): void {
	if (status !== 0)
		throw new Error(
			`${call} failed: code ${glue.lastErrorCode()} (${glue.lastErrorDetail(0)}, ${glue.lastErrorDetail(1)})`,
		);
}

/** An id that a create call returned: the table's id plus one, or 0 on failure. */
function created(glue: CoreGlue, call: string, id: number): number {
	if (id === 0) check(glue, call, glue.lastErrorCode() || 1);
	return id;
}

/** Writes `words` into fresh staging words of the core. */
function stage(core: CoreGlue, memory: WebAssembly.Memory, words: Float32Array): void {
	const address = created(core, 'animationStaging', core.animationStaging(words.length));
	new Float32Array(memory.buffer, address, words.length).set(words);
}

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

/** Starts the job workers in the core's memory and waits until each runs. */
async function startWorkers(module: WebAssembly.Module, memory: WebAssembly.Memory, count: number) {
	const workers = Array.from(
		{ length: count },
		(_, index) =>
			new Worker(new URL('./lib/animation-worker.ts', import.meta.url), {
				type: 'module',
				name: `animation-job-${index}`,
			}),
	);
	const replies = (type: string) =>
		Promise.all(
			workers.map(
				(worker) =>
					new Promise<void>((resolve, reject) => {
						const timer = setTimeout(
							() => reject(new Error(`a job worker sent no ${type} reply`)),
							WORKER_TIMEOUT_MS,
						);
						worker.addEventListener('message', ({ data }) => {
							if (data.type === 'error') reject(new Error(`a job worker failed: ${data.message}`));
							if (data.type !== type) return;
							clearTimeout(timer);
							resolve();
						});
					}),
			),
		);
	const ready = replies('ready');
	const stopped = replies('stopped');
	// The page waits for the stop replies only at the end.
	stopped.catch(() => {});
	workers.forEach((worker, index) => {
		worker.postMessage({ module, memory, index });
	});
	await ready;
	return { workers, stopped };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

run('animation', async () => {
	const characters = setting('characters', 500);
	const joints = setting('joints', ANIMATION.joints);
	const jobWorkers = setting('jobs', Math.max(1, (navigator.hardwareConcurrency ?? 1) - 2));
	const frames = setting('frames', ANIMATION.frames);
	const warmup = setting('warmup', ANIMATION.warmupFrames);

	const { module, memory } = await loadCore('threaded');
	if (!memory)
		throw new Error('the page is not cross-origin isolated, so it has no threaded build');
	const { glue: core } = await startCore('threaded', module, memory);
	// An engine for WebGL2 with a small scene: the page uses its job system and animation table.
	check(
		core,
		'initEngine',
		core.initEngine(jobWorkers, 64, 1, 64, 0, true, 0, 2048, 0, 0, false, true, false),
	);
	const { workers, stopped } = await startWorkers(module, memory, jobWorkers);
	progress(`${jobWorkers} job workers ready`);
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
		const matrices = view(
			Float32Array,
			C.ANIMATION_FIELD_MATRICES,
			characters * joints * C.CORE_MATRIX_FLOATS,
		);
		for (let i = 0; i < characters; i++) {
			const at = i * C.ANIMATION_MAX_BLEND;
			slotClips.set(clips, at);
			slotWeights.set(ANIMATION.weights, at);
		}

		const times: number[] = [];
		const busy = () => {
			let sum = 0;
			for (let w = 0; w < jobWorkers; w++) sum += core.takeJobBusyMs(w);
			return sum;
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
		stopJobWorkersAt(memory, core.jobsWakeAddress(), core.jobsStopAddress());
		await stopped.catch(() => progress('a job worker did not stop'));
		for (const worker of workers) worker.terminate();
	}
});
