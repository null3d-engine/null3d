// Loads glTF sample models with the engine's parser, hands their skeletons and clips to the engine
// core, which resamples the clips on its job workers, and plays each clip of `lib/gltf-poses.ts`
// at its chosen times. It compares the skinning matrices of every skin joint, and the matrices of
// the meshes that clips move without a skin, with what three.js's GLTFLoader and AnimationMixer
// give for the same files (`lib/gltf-poses.json`, from bench/three-fixtures.ts). The page runs the
// core on its own thread, as the sketch worker does, with job workers of its own.
//
// Each model loads a second time after the asset tool, whose clip step puts the clips on the
// core's frames. Those clips pose the source's skeleton, so the same comparison covers them, and
// the core must copy them all: none may need a resample.

import type { CoreGlue } from '@null3d/engine/internal';
import knightTool from '/samples/sources/characters/kaykit-knight/Knight.glb?optimized';
import boxTool from '/samples/sources/khronos/BoxAnimated/glTF-Binary/BoxAnimated.glb?optimized';
import foxTool from '/samples/sources/khronos/Fox/glTF-Binary/Fox.glb?optimized';
import interpolationTool from '/samples/sources/khronos/InterpolationTest/glTF-Binary/InterpolationTest.glb?optimized';
import figureTool from '/samples/sources/khronos/RiggedFigure/glTF-Binary/RiggedFigure.glb?optimized';
import simpleTool from '/samples/sources/khronos/RiggedSimple/glTF-Binary/RiggedSimple.glb?optimized';
import skinTool from '/samples/sources/khronos/SimpleSkin/glTF-Embedded/SimpleSkin.gltf?optimized';
import * as C from '../../packages/engine/src/generated/core';
import { clipWords, skeletonWords } from '../../packages/engine/src/scene/animation';
import type { AnimationData, ClipData } from '../../packages/engine/src/scene/gltf-animation';
import { meshoptDecoder } from '../../packages/engine/src/scene/gltf-meshopt';
import {
	type GltfData,
	parseGltf,
	readContainer,
} from '../../packages/engine/src/scene/gltf-parse';
import { check, created, stage, startCorePage } from './lib/core-page';
import {
	POSE_MODELS,
	type PoseCase,
	type PoseFixture,
	type PoseModel,
	type PoseResult,
	poseTime,
	TOOL_SUFFIX,
} from './lib/gltf-poses';
import poses from './lib/gltf-poses.json';
import { progress, run } from './lib/result';

/** The job workers that resample the clips and pose the skeletons. */
const JOB_WORKERS = 2;

/** Each model after the asset tool, by the source's address. */
const AFTER_TOOL: Readonly<Record<string, string>> = {
	'/samples/sources/characters/kaykit-knight/Knight.glb': knightTool,
	'/samples/sources/khronos/Fox/glTF-Binary/Fox.glb': foxTool,
	'/samples/sources/khronos/RiggedFigure/glTF-Binary/RiggedFigure.glb': figureTool,
	'/samples/sources/khronos/RiggedSimple/glTF-Binary/RiggedSimple.glb': simpleTool,
	'/samples/sources/khronos/SimpleSkin/glTF-Embedded/SimpleSkin.gltf': skinTool,
	'/samples/sources/khronos/BoxAnimated/glTF-Binary/BoxAnimated.glb': boxTool,
	'/samples/sources/khronos/InterpolationTest/glTF-Binary/InterpolationTest.glb': interpolationTool,
};

/** The joints of a mesh that one joint moves: the skeleton joint of its first vertex. */
function movedJoint(data: GltfData, name: string): number {
	const node = data.nodes.find((n) => n.name === name && n.skinned && n.skin < 0);
	const joints = node ? data.meshes[node.mesh]?.primitives[0]?.joints?.array : undefined;
	if (joints === undefined) throw new Error(`no moved mesh named ${name}`);
	return joints[0] as number;
}

/** The largest differences between a matrix of the core and three.js's, which `into` keeps. */
function compare(
	got: Float32Array,
	at: number,
	want: readonly number[],
	from: number,
	into: number[],
) {
	for (let r = 0; r < 3; r++)
		for (let c = 0; c < 4; c++) {
			const difference = Math.abs(
				(got[at + r * 4 + c] as number) - (want[from + r * 4 + c] as number),
			);
			const k = c === 3 ? 1 : 0;
			into[k] = Math.max(into[k] as number, difference);
			if (c === 3)
				into[2] = Math.max(into[2] as number, Math.abs(want[from + r * 4 + c] as number));
		}
}

/** The meshopt decoder's module file, which the engine ships. */
const MESHOPT_WASM = new URL(
	'../../packages/engine/vendor/meshopt/meshopt_decoder.wasm',
	import.meta.url,
);

/** Parses a model file, with the meshopt decoder, and returns it with the parse's milliseconds. */
async function parse(url: string): Promise<{ data: GltfData; parseMs: number }> {
	const address = new URL(url, location.href).href;
	const bytes = new Uint8Array(await (await fetch(address)).arrayBuffer());
	const decode = await meshoptDecoder(await WebAssembly.compileStreaming(fetch(MESHOPT_WASM)));
	const started = performance.now();
	const data = parseGltf(readContainer(bytes, address), new Map(), address, { meshopt: decode });
	return { data, parseMs: performance.now() - started };
}

/**
 * Hands clips to the core, which builds them on its job workers, and waits for them. Returns
 * their ids plus one, the milliseconds from the first clip handed over to the last one back, and
 * the clips that the core resampled.
 */
async function loadClips(
	core: CoreGlue,
	memory: WebAssembly.Memory,
	skeleton: number,
	clips: readonly ClipData[],
) {
	const before = created(core, 'resampledClips', core.resampledClips());
	const started = performance.now();
	const tickets = clips.map((clip) => {
		stage(core, memory, clipWords(clip));
		return created(core, 'createClipLater', core.createClipLater(skeleton, clip.tracks.length, 0));
	});
	const ids = tickets.map(() => 0);
	while (ids.includes(0)) {
		tickets.forEach((ticket, k) => {
			if (ids[k] !== 0) return;
			const id = core.clipReady(ticket);
			if (id !== C.ANIMATION_CLIP_PENDING) ids[k] = created(core, 'clipReady', id);
		});
		if (ids.includes(0)) await new Promise((resolve) => setTimeout(resolve, 1));
	}
	const loadMs = performance.now() - started;
	const resampled = created(core, 'resampledClips', core.resampledClips()) - before;
	return { ids, loadMs, resampled };
}

/**
 * The clips of a file after the asset tool, with their tracks moved onto the joints of the
 * source's skeleton. The tool keeps the file's nodes in order and adds nodes only below them, so
 * the joints that clips move come in the same order in both skeletons.
 */
function onSourceJoints(source: AnimationData, tool: AnimationData): ClipData[] {
	const moved = (a: AnimationData) =>
		[...new Set(a.clips.flatMap((clip) => clip.tracks.map((t) => t.joint)))].sort((x, y) => x - y);
	const from = moved(tool);
	const to = moved(source);
	if (from.length !== to.length)
		throw new Error(`the tool's clips move ${from.length} joints, and the source's ${to.length}`);
	const joint = new Map(from.map((j, k) => [j, to[k] as number]));
	return tool.clips.map((clip) => ({
		...clip,
		tracks: clip.tracks.map((track) => ({ ...track, joint: joint.get(track.joint) as number })),
	}));
}

/** Plays each case's clip alone on `instance` and compares its pose with three.js's. */
function comparePoses(
	core: CoreGlue,
	memory: WebAssembly.Memory,
	instance: number,
	model: PoseModel,
	data: GltfData,
	clips: readonly ClipData[],
	ids: readonly number[],
	expected: readonly PoseCase[],
) {
	const animation = data.animation as AnimationData;
	// [rotation and scale, translation, the largest translation three.js gives]
	const largest = [0, 0, 0];
	let matrices = 0;
	let worst = '';
	const note = (where: string, before: number) => {
		if ((largest[0] as number) > before) worst = where;
	};
	for (const want of expected) {
		const k = clips.findIndex((clip) => clip.name === want.clip);
		const duration = Math.max(
			...(clips[k]?.tracks ?? []).map((t) => t.times[t.times.length - 1] ?? 0),
		);
		const share = model.clips[want.clip]?.find((s) => poseTime(s, duration) === want.time);
		if (share === undefined)
			throw new Error(`${model.url}: ${want.clip} has no case at ${want.time}`);
		const at = (instance - 1) * C.ANIMATION_MAX_BLEND;
		const slot = (Type: Uint32ArrayConstructor | Float32ArrayConstructor, field: number) =>
			new Type(memory.buffer, core.animationArrays(field), instance * C.ANIMATION_MAX_BLEND);
		(slot(Uint32Array, C.ANIMATION_FIELD_SLOT_CLIPS) as Uint32Array)[at] = (ids[k] as number) - 1;
		(slot(Float32Array, C.ANIMATION_FIELD_SLOT_TIMES) as Float32Array)[at] = want.time;
		const weights = slot(Float32Array, C.ANIMATION_FIELD_SLOT_WEIGHTS) as Float32Array;
		weights.fill(0, at, at + C.ANIMATION_MAX_BLEND);
		weights[at] = 1;
		core.prepareJobs();
		check(core, 'updateAnimations', core.updateAnimations(0));
		const first =
			created(core, 'animatedInstanceJoints', core.animatedInstanceJoints(instance)) - 1;
		const got = new Float32Array(
			memory.buffer,
			core.animationArrays(C.ANIMATION_FIELD_MATRICES) + first * 48,
			animation.joints.length * 12,
		);
		want.skins.forEach((skin, s) => {
			const joints = animation.skins[s] ?? [];
			joints.forEach((joint, j) => {
				const before = largest[0] as number;
				compare(got, joint * 12, skin, j * 12, largest);
				note(
					`${want.clip} at ${want.time}, skin ${s} joint ${j} (${animation.joints[joint]?.name})`,
					before,
				);
				matrices++;
			});
		});
		for (const [name, matrix] of Object.entries(want.moved)) {
			const before = largest[0] as number;
			compare(got, movedJoint(data, name) * 12, matrix, 0, largest);
			note(`${want.clip} at ${want.time}, ${name}`, before);
			matrices++;
		}
	}
	return {
		linear: largest[0] as number,
		translation: (largest[1] as number) / Math.max(largest[2] as number, 1e-6),
		matrices,
		worst,
	};
}

run('gltf-poses', async () => {
	const { core, memory, stop } = await startCorePage(JOB_WORKERS, progress);
	const fixture = poses as PoseFixture;
	try {
		check(core, 'initAnimations', core.initAnimations(POSE_MODELS.length, 4096));
		const results: PoseResult[] = [];
		for (const model of POSE_MODELS) {
			const expected = fixture.models.find((m) => m.url === model.url)?.cases ?? [];
			const { data, parseMs } = await parse(model.url);
			const animation = data.animation;
			if (!animation) throw new Error(`${model.url} has no skeleton`);
			stage(core, memory, skeletonWords(animation.joints));
			const skeleton = created(
				core,
				'createSkeleton',
				core.createSkeleton(animation.joints.length),
			);
			const instance = created(
				core,
				'createAnimatedInstance',
				core.createAnimatedInstance(skeleton),
			);
			const tool = await parse(AFTER_TOOL[model.url] as string);
			if (!tool.data.animation)
				throw new Error(`${model.url} has no skeleton after the asset tool`);
			const variants = [
				{ url: model.url, clips: animation.clips, parseMs },
				{
					url: `${model.url}${TOOL_SUFFIX}`,
					clips: onSourceJoints(animation, tool.data.animation),
					parseMs: tool.parseMs,
				},
			];
			for (const variant of variants) {
				const { ids, loadMs, resampled } = await loadClips(core, memory, skeleton, variant.clips);
				const poses = comparePoses(
					core,
					memory,
					instance,
					model,
					data,
					variant.clips,
					ids,
					expected,
				);
				results.push({
					url: variant.url,
					joints: animation.joints.length,
					clips: variant.clips.length,
					parseMs: variant.parseMs,
					resampleMs: loadMs,
					resampled,
					...poses,
				});
				progress(`${variant.url}: ${poses.matrices} matrices`);
			}
		}
		return { revision: fixture.revision, models: results };
	} finally {
		await stop();
	}
});
