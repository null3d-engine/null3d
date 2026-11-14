// The island's near trees alone, on a plain ground, with the camera close to one of the plan's oaks.
// ?oak= names the place of the oak among those the preset stands, from 0 to 1, and the test reads
// whether the tree draws where the plan puts it, with the culling and levels that the scene runs.
import { defineSketch } from '@null3d/engine';
import { OAK, standing, TREE_SPOTS } from '../../../examples/showcase/island/plan';
import { createTrees, TREE_SHARE } from '../../../examples/showcase/island/trees';

/** How far the camera stands from the oak, in meters. */
const DISTANCE = 25;
const place = Number(new URL(import.meta.url).searchParams.get('oak') ?? 0);

export default defineSketch(async (ctx) => {
	const { scene, quality } = ctx;
	scene.setBackground('#d8e0e8');
	scene.createAmbientLight({ intensity: 3 });
	const oaks = standing(TREE_SPOTS, TREE_SHARE[quality.preset]).filter(({ kind }) => kind === OAK);
	const oak = oaks[Math.floor(place * (oaks.length - 1))];
	if (!oak) throw new Error('the plan stands no oak at this preset');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.3,
		far: 400,
		position: [oak.x + DISTANCE, oak.y + 6, oak.z],
		target: [oak.x, oak.y + 5, oak.z],
	});
	scene.setActiveCamera(camera);
	await createTrees(ctx, camera);
});
