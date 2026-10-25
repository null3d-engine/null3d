// The asset tool's two level scenes, which the picture tests draw: `?scene=tree` loads a tree whose
// crown is a list of separate leaf cards, and `?scene=grid` loads a flat grid whose texture repeats
// across it. The tool builds both into levels. The tree's first lower level keeps half its cards and
// grows them, and a large bias brings that switch near the camera, where the crown is big enough to
// judge. The grid's coarsest level reports the slide of its texture coordinates: with the weight,
// that error keeps the level out at a distance, and a finer one draws here, so the checker stays
// square. The level files come from `tests/lib/asset-levels-scenes.ts`.
import { defineSketch, type Mesh } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

const params = new URL(import.meta.url).searchParams;

/** The level file of each scene, from the test page's folder. */
const FILES = {
	tree: 'assets/models/optimized/levels/asset-card-tree.glb',
	grid: 'assets/models/optimized/levels/asset-bent-grid.glb',
} as const;

/**
 * The threshold in pixels: the most that the setting takes, so that a level switches as near as
 * the tool's errors allow. The card size is a level's error, so its own switch lies where the tree
 * stands a few pixels tall, and only a bias brings it closer.
 */
const THRESHOLD = 16;

/** The tree's bias: about four times nearer, where the crown spans about 100 of the 640 pixels. */
const TREE_BIAS = 4;

export default defineSketch(async ({ scene, assets, post, quality }) => {
	const name = (params.get('scene') ?? 'tree') as keyof typeof FILES;
	const file = FILES[name];
	if (!file) throw new Error(`no level scene is named ${name}`);
	quality.set({ lodThreshold: THRESHOLD });
	post.set({ toneMapping: 'none' });
	scene.setBackground('#60666e');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	const loaded = scene.instantiate(await assets.loadGltf(file));
	if (name === 'tree') {
		// The bias lands after the file's load, so the structure change that adds the tree applies
		// it, as the asset scene's own level picture does.
		(loaded.find('Crown') as Mesh | undefined)?.setLevelBias(TREE_BIAS);
		scene.setActiveCamera(
			scene.createPerspectiveCamera({
				fov: 40,
				near: 0.1,
				far: 40,
				position: [0, 1.1, 4.9],
				target: [0, 0.8, 0],
			}),
		);
		return {};
	}
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 60,
			near: 0.05,
			far: 20,
			position: [0.45, 1.45, 0.45],
			target: [0, 0, 0],
		}),
	);
	return {};
});
