// Staged levels of detail: a heightfield that the asset tool wrote with `--lod --stages`
// (packages/cli/src/assets/staged-fixture.ts). The file holds the full vertex stream and the
// coarsest level, and each finer level downloads from a file of its own. The camera stands inside
// the ground's bounds, where the engine draws the finest level, so the picture sharpens as the
// stages arrive. `?max=` passes the loader's level limit, as a page on a phone sets it to skip the
// finest level. The sketch posts 'loaded' with the levels the file gave, and 'levels' with the
// count whenever it changes.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The most levels that the load takes, or 0 for every level. */
const MAX = Number(params.get('max') ?? 0);

export default defineSketch(async ({ scene, assets, page }) => {
	scene.setBackground('#8fa4b8');
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3.2 });
	scene.createAmbientLight({ intensity: 0.5 });
	const prefab = await assets.loadGltf(
		'assets/models/staged-terrain.glb',
		MAX > 0 ? { maxLevels: MAX } : {},
	);
	const node = prefab.find('terrain');
	scene.instantiate(prefab);
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			near: 0.1,
			far: 120,
			position: [0, 2.4, 8],
			target: [0, 0.2, -1],
		}),
	);
	const levels = () => node?.mesh?.levels.length ?? -1;
	let posted = levels();
	page.post('loaded', { levels: posted });
	return {
		onUpdate() {
			const now = levels();
			if (now === posted) return;
			posted = now;
			page.post('levels', { levels: now });
		},
	};
});
