// Cluster levels: a heightfield of 32,768 triangles that the asset tool cut into a tree of patches
// (tests/lib/cluster-fixtures.ts). The camera looks along the ground, so the near edge lies a few
// metres away and the far edge some tens of metres away. The engine draws the patches that its
// threshold picks, fine triangles near the camera and coarse ones far from it, in one draw for the
// whole mesh. Settings: `?d=<metres>` sets how far the camera stands from the middle of the
// ground. `?coarse` raises the level threshold to 16 pixels, so the patches that draw are much
// coarser than the mesh and the picture shows the tree at work.
import { defineSketch } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

const params = new URL(import.meta.url).searchParams;
/** The camera's distance from the middle of the ground, in metres. */
const DISTANCE = Number(params.get('d') ?? 26);

export default defineSketch(async ({ scene, assets, post, quality }) => {
	post.set({ toneMapping: 'aces' });
	if (params.has('coarse')) quality.set({ lodThreshold: 16, governor: false });
	scene.setBackground('#8fa4b8');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	scene.instantiate(await assets.loadGltf('assets/models/cluster-terrain.glb'));
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			near: 0.5,
			far: 300,
			position: [0, 7, DISTANCE],
			target: [0, 1, -DISTANCE * 0.8],
		}),
	);
	return {};
});
