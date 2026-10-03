// Loads glTF sample models with the engine's parser, hands their skeletons and clips to the engine
// core, which resamples the clips on its job workers, and plays each clip of `lib/gltf-poses.ts`
// at its chosen times. It compares the skinning matrices of every skin joint, and the matrices of
// the meshes that clips move without a skin, with what three.js's GLTFLoader and AnimationMixer
// give for the same files (`lib/gltf-poses.json`, from bench/three-fixtures.ts). The page runs the
// core on its own thread, as the sketch worker does, with job workers of its own.
import * as C from '../../packages/engine/src/generated/core';
import { clipWords, skeletonWords } from '../../packages/engine/src/scene/animation';
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
	type PoseResult,
	poseTime,
} from './lib/gltf-poses';
import poses from './lib/gltf-poses.json';
import { progress, run } from './lib/result';

/** The job workers that resample the clips and pose the skeletons. */
const JOB_WORKERS = 2;

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

run('gltf-poses', async () => {
	const { core, memory, stop } = await startCorePage(JOB_WORKERS, progress);
	const fixture = poses as PoseFixture;
	try {
		check(core, 'initAnimations', core.initAnimations(POSE_MODELS.length, 4096));
		const results: PoseResult[] = [];
		for (const model of POSE_MODELS) {
			const expected = fixture.models.find((m) => m.url === model.url)?.cases ?? [];
			const address = new URL(model.url, location.href).href;
			const bytes = new Uint8Array(await (await fetch(address)).arrayBuffer());
			const data = parseGltf(readContainer(bytes, address), new Map(), address);
			const animation = data.animation;
			if (!animation) throw new Error(`${model.url} has no skeleton`);
			stage(core, memory, skeletonWords(animation.joints));
			const skeleton = created(
				core,
				'createSkeleton',
				core.createSkeleton(animation.joints.length),
			);
			const started = performance.now();
			const tickets = animation.clips.map((clip) => {
				stage(core, memory, clipWords(clip));
				return created(
					core,
					'createClipLater',
					core.createClipLater(skeleton, clip.tracks.length, 0),
				);
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
			const resampleMs = performance.now() - started;
			const instance = created(
				core,
				'createAnimatedInstance',
				core.createAnimatedInstance(skeleton),
			);
			// [rotation and scale, translation, the largest translation three.js gives]
			const largest = [0, 0, 0];
			let matrices = 0;
			let worst = '';
			const note = (where: string, before: number) => {
				if ((largest[0] as number) > before) worst = where;
			};
			for (const want of expected as PoseCase[]) {
				const k = animation.clips.findIndex((clip) => clip.name === want.clip);
				const duration = Math.max(
					...(animation.clips[k]?.tracks ?? []).map((t) => t.times[t.times.length - 1] ?? 0),
				);
				const share = model.clips[want.clip]?.find((s) => poseTime(s, duration) === want.time);
				if (share === undefined)
					throw new Error(`${model.url}: ${want.clip} has no case at ${want.time}`);
				const at = (instance - 1) * C.ANIMATION_MAX_BLEND;
				const slot = (Type: Uint32ArrayConstructor | Float32ArrayConstructor, field: number) =>
					new Type(memory.buffer, core.animationArrays(field), instance * C.ANIMATION_MAX_BLEND);
				(slot(Uint32Array, C.ANIMATION_FIELD_SLOT_CLIPS) as Uint32Array)[at] =
					(ids[k] as number) - 1;
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
			results.push({
				url: model.url,
				joints: animation.joints.length,
				clips: animation.clips.length,
				resampleMs,
				linear: largest[0] as number,
				translation: (largest[1] as number) / Math.max(largest[2] as number, 1e-6),
				matrices,
				worst,
			});
			progress(`${model.url}: ${matrices} matrices`);
		}
		return { revision: fixture.revision, models: results };
	} finally {
		await stop();
	}
});
