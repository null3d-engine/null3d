// Staged levels of detail: a heightfield that the asset tool wrote with `--lod --stages`
// (packages/cli/src/assets/staged-fixture.ts). The file holds the full vertex stream and the
// coarsest level, and each finer level downloads from a file of its own. The camera stands inside
// the ground's bounds, where the engine draws the finest level, so the picture sharpens as the
// stages arrive. `?max=` passes the loader's level limit, as a page on a phone sets it to skip the
// finest level. `?far` stands the camera beyond every switch distance, where only the file's own
// level draws, so the loader gives up the stages that would never draw. `?near` starts at the far
// camera, waits until the loader gave those stages up, and then comes close: the stages that the
// camera now needs must arrive. The page keeps the quality settings still, so the picture changes
// only when a stage arrives. The sketch posts 'loaded' with the levels the file gave, 'levels' with
// the count whenever it changes, and 'near' when it moves the camera close.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The most levels that the load takes, or 0 for every level. */
const MAX = Number(params.get('max') ?? 0);
/** True when the camera stands beyond every switch distance of the model's levels. */
const FAR = params.has('far');
/** True when the camera starts far and comes close once the loader gave the finer stages up. */
const NEAR = params.has('near');

/**
 * The frames that the near page draws after the first stage before it moves the camera close: twice
 * the loader's warm-up, so the loader has given the finer stages up even if some of these frames
 * did not draw the model.
 */
const NEAR_AFTER_FRAMES = 240;

export default defineSketch(async ({ scene, assets, page, quality }) => {
	// The page compares two of its own frames, so the picture must not move between them. On a slow
	// renderer the frame-budget governor lowers the render scale once, finds the step does not pay,
	// and raises it again, which redraws the scene at another scale partway through the comparison.
	// A capture keeps the settings as set instead (D-237).
	await quality.set({ governor: false });
	scene.setBackground('#8fa4b8');
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3.2 });
	scene.createAmbientLight({ intensity: 0.5 });
	const prefab = await assets.loadGltf(
		'assets/models/staged-terrain.glb',
		MAX > 0 ? { maxLevels: MAX } : {},
	);
	const node = prefab.find('terrain');
	scene.instantiate(prefab);
	// The switches of this model, whose errors are in the mesh's stored units, lie beyond 6,000 m:
	// only the coarsest level draws at the far camera.
	const camera = scene.createPerspectiveCamera(
		FAR || NEAR
			? {
					fov: 50,
					near: 10,
					far: 30_000,
					position: [0, 1_000, 8_000],
					target: [0, 0, 0],
				}
			: {
					fov: 50,
					near: 0.1,
					far: 120,
					position: [0, 2.4, 8],
					target: [0, 0.2, -1],
				},
	);
	scene.setActiveCamera(camera);
	const levels = () => node?.mesh?.levels.length ?? -1;
	let posted = levels();
	let sinceStage = 0;
	let moved = false;
	page.post('loaded', { levels: posted });
	return {
		onUpdate() {
			const now = levels();
			if (now !== posted) {
				posted = now;
				page.post('levels', { levels: now });
			}
			if (!NEAR || moved || now < 1) return;
			// The first stage arrived, and the loader now holds the ones after it. Past the warm-up
			// it gives them up; the camera comes close well after that, and its pick must bring the
			// stages back.
			sinceStage += 1;
			if (sinceStage < NEAR_AFTER_FRAMES) return;
			moved = true;
			camera.setNearFar(0.1, 120);
			camera.setPosition(0, 2.4, 8);
			camera.lookAt(0, 0.2, -1);
			page.post('near', { levels: now });
		},
	};
});
