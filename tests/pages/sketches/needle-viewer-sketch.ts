// The reduced Needle light map scene drawn the way Needle's viewer draws it, for the comparison in
// .dev/tested-devices/macbook-pro-chrome/20261101-160830-needle-viewer-comparison.md. The viewer
// takes its view from the file's `Capture Camera` node; this sketch copies that node's pose, field
// of view and near and far planes as the constants below, so a change to the node alone needs the
// same change here. The scene has no lights of its own: the baked light map lights it, as Needle's
// viewer lights it. The viewer applies no tone curve and no exposure change, so the engine draws
// with none either, and the render scale stays at the canvas so the two pictures cover the same
// pixels.
import { defineSketch } from '@null3d/engine';

/** The pose that the scene's `Capture Camera` node carries, copied here for the engine's camera. */
const CAMERA = {
	position: [-1.0, 9.2, -4.5],
	target: [2.0, 7.9, -0.3],
	fov: 55,
	near: 0.03,
	far: 50,
} as const;

export default defineSketch(async ({ scene, assets, post, quality }) => {
	quality.set({ governor: false, minRenderScale: 1, maxRenderScale: 1 });
	post.set({ toneMapping: 'none', exposure: 1 });
	const prefab = await assets.loadGltf('assets/models/needle-lightmap/scene.gltf');
	scene.instantiate(prefab);
	scene.setActiveCamera(scene.createPerspectiveCamera(CAMERA));
	return {};
});
