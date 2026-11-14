// Cluster levels: a heightfield of 32,768 triangles that the asset tool cut into a tree of patches
// (packages/cli/src/assets/cluster-fixture.ts). The camera looks along the ground, so the near
// edge lies a few metres away and the far edge some tens of metres away. The engine draws the
// patches that its threshold picks, fine triangles near the camera and coarse ones far from it:
// one indirect draw on WebGPU, and multi-draw ranges on WebGL2. A browser without
// `WEBGL_multi_draw` draws the mesh's whole levels, which the tool also writes. Settings:
// `?d=<metres>` sets how far the camera stands from the middle of the ground. `?coarse` raises the
// level threshold to 16 pixels, so the patches that draw are much coarser than the mesh and the
// picture shows the tree at work. `?bounce=off` draws no screen-space bounce light, whose gather
// turns the small difference between a coarse patch and the finest level into a visible one.
// `?shadows` lowers the sun, which casts shadows in three cascades, and the ground casts its hills'
// shadows onto itself: each cascade draws the patches that its own texels pick. `?fine` draws the
// finest patches in the shadow maps, which must give the same picture: a cascade's patches never
// shadow the ground that the camera's patches draw.
import { defineSketch } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

const params = new URL(import.meta.url).searchParams;
/** The camera's distance from the middle of the ground, in metres. */
const DISTANCE = Number(params.get('d') ?? 26);

/** True when the sun casts shadows, and the ground casts and receives them. */
const SHADOWS = params.has('shadows');

export default defineSketch(async ({ scene, assets, post, quality }) => {
	post.set({ toneMapping: 'aces' });
	if (params.has('coarse')) quality.set({ lodThreshold: 16, governor: false });
	if (params.get('bounce') === 'off') quality.set({ bounceRays: 0 });
	if (params.has('fine')) quality.set({ lodShadowThreshold: 0 });
	scene.setBackground('#8fa4b8');
	scene.createDirectionalLight(
		SHADOWS
			? {
					...SUN,
					direction: [-1, -0.45, -0.6],
					castShadows: true,
					shadow: { cascades: 3, mapSize: 2048, distance: 80 },
				}
			: SUN,
	);
	scene.createAmbientLight(AMBIENT);
	scene.instantiate(await assets.loadGltf('assets/models/cluster-terrain.glb'), {
		castShadows: SHADOWS,
		receiveShadows: SHADOWS,
	});
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
