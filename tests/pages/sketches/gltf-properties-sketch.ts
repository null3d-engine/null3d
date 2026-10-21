// Loads the property cases of `lib/gltf-properties.ts` with the engine, and plays each model's clip
// at each sampled time with the object's time scale at 0, so the clip holds that time. A frame
// after each play, it reads the value that the animator wrote to every property, and the page
// compares them with what three.js's loader, its animation-pointer plugin and its mixer give
// (`lib/gltf-properties.json`). Then it starts three of a sketch's own animations at chosen times,
// and reads the values that reached a light and a camera, with the codes of the calls that must
// fail.
import { type Animator, defineSketch, EngineError, type PrefabInstance } from '@null3d/engine';
import {
	builtFile,
	builtUrl,
	PROPERTY_MODELS,
	type PropertyReading,
	propertyTime,
} from '../lib/gltf-properties';

/** One model's clip at one time, which the sketch plays and reads in turn. */
interface Job {
	id: string;
	animator: Animator;
	clip: string;
	keys: readonly string[];
	time: number;
}

/** The code of the error that `call` throws, or 'none'. */
function codeOf(call: () => unknown): string {
	try {
		call();
	} catch (error) {
		return error instanceof EngineError ? error.code : String(error);
	}
	return 'none';
}

export default defineSketch(async ({ scene, assets, page }) => {
	scene.setBackground('#20242a');
	scene.createAmbientLight({ intensity: 1 });
	const lens = scene.createPerspectiveCamera({ fov: 30, position: [0, 2, 8], target: [0, 1, 0] });
	scene.setActiveCamera(lens);
	const jobs: Job[] = [];
	for (const [k, model] of PROPERTY_MODELS.entries()) {
		const url = model.url || builtUrl(builtFile());
		const prefab = await assets.loadGltf(url);
		const copy: PrefabInstance = scene.instantiate(prefab, { position: [k * 3 - 3, 0, 0] });
		const animator = copy.animator();
		// The clip's time stays where a play puts it, so the frame after reads its value.
		animator.setTimeScale(0);
		for (const seconds of model.times)
			jobs.push({
				id: model.id,
				animator,
				clip: model.clip,
				keys: model.keys,
				time: propertyTime(seconds),
			});
	}
	// A sketch's own animations, which write a light's color and a camera's field of view. Their
	// times stay where the sketch puts them, so the values they wrote are exact.
	const lamp = scene.createPointLight({ position: [0, 1, 0], intensity: 4, range: 10 });
	const color = scene.animateProperty(lamp, 'light.color', {
		times: [0, 1],
		values: [1, 0, 0, 0, 0, 1],
		paused: true,
	});
	const fov = scene.animateProperty(lens, 'camera.fov', {
		times: [0, 2],
		values: [30, 60],
		paused: true,
	});
	const failures = {
		badPath: codeOf(() => scene.animateProperty(lamp, 'light.width', { times: [0], values: [1] })),
		wrongKeys: codeOf(() =>
			scene.animateProperty(lamp, 'light.color', { times: [0, 1], values: [1] }),
		),
		onAObjectWithoutIt: codeOf(() =>
			scene.animateProperty(lamp, 'camera.height', { times: [0], values: [1] }),
		),
	};
	const readings: PropertyReading[] = [];
	let at = 0;
	let playing = false;
	/** 0 while the models are read, then 1 to place the sketch's animations, and 2 to read them. */
	let phase = 0;
	let values = { color: [] as number[], fov: 0 };
	return {
		onUpdate() {
			if (phase === 2) {
				phase = 3;
				page.post('report', { readings, values, failures });
				return;
			}
			if (phase === 1) {
				// One frame after the times were placed, so the step wrote the values.
				values = { color: Array.from(lamp.linear), fov: lens.fov };
				phase = 2;
				return;
			}
			if (phase === 3) return;
			if (playing) {
				const job = jobs[at] as Job;
				const written: Record<string, number[]> = {};
				for (const key of job.keys) {
					const value = job.animator.propertySample(key);
					if (value) written[key] = Array.from(value);
				}
				readings.push({ id: job.id, time: job.time, values: written });
				playing = false;
				at++;
				return;
			}
			const job = jobs[at];
			if (job !== undefined) {
				job.animator.play(job.clip, { time: job.time });
				playing = true;
				return;
			}
			// The models are read: place the sketch's own animations, which the next frame writes.
			color.setTime(0.5);
			fov.setTime(1);
			phase = 1;
		},
	};
});
