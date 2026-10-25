// A lightmap scene made for Needle's viewer, reduced from the real Needle export in
// madjin/lightmap-tests: three pillars, a plaster wall, a floor and a grass panel, with their
// textures from ambientCG, which publishes them under CC0. The file's `NEEDLE_lightmaps` extension
// registers an RGBM light map in linear color, and each node's Needle `MeshRenderer` places its
// own bake with a scale and an offset on the second texture coordinates. The picture holds the
// decode and the placement still: a wrong decode changes the brightness, and a wrong offset or
// coordinate set smears the baked light across each mesh.
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
	const prefab = await assets.loadGltf('assets/models/needle-lightmap/scene.gltf');
	scene.instantiate(prefab);
	// A view of the whole little building: the pillars, the wall under the roof, the roof's floor
	// and its grass, framed from its own bounds.
	const { center, radius } = prefab.bounds;
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: radius / 100,
			far: radius * 30,
			position: [center[0] + radius, center[1] + radius, center[2] + radius],
			target: center,
		}),
	);
	return {};
});
