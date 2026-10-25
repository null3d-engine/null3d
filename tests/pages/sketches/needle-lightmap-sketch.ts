// A lightmap scene made for Needle's viewer, reduced from the real Needle export in
// madjin/lightmap-tests: three pillars, a plaster wall, a floor and a grass panel, with their
// textures from ambientCG, which publishes them under CC0. The file's `NEEDLE_lightmaps` extension
// registers an RGBM light map in linear color, and each node's Needle `MeshRenderer` places its
// own bake with a scale and an offset on the second texture coordinates. The picture frames the
// plaster wall and the grass panel. The wall has one set of texture coordinates, so it exercises
// the rule that reads the first set. The grass panel has two sets, and its own scale and offset
// place its bake. On WebGPU the wall covers 7,476 pixels at a mean of 30.6 of 255, with 63.8% of
// them above eight steps, and the grass 9,764 pixels at 34.6, with 91.7% above. The rest of the
// frame is dark, so a wrong decode changes those two regions and a wrong placement smears them.
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, assets }) => {
	const prefab = await assets.loadGltf('assets/models/needle-lightmap/scene.gltf');
	scene.instantiate(prefab);
	// A crop on the plaster wall and the grass panel. The wall is a plane at x 0.98, spanning
	// z -1 to 1 and y 6.1 to 7.8, and its lit face points into the building. The grass panel is a
	// plane at z -1, spanning x 3 to 5 and y 7.25 to 9.15. The camera stands inside the building,
	// past the wall's face and the grass's front, so the wall's edge clears the grass and the roof
	// slab stays behind the camera's sight lines.
	const { radius } = prefab.bounds;
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: radius / 100,
			far: radius * 30,
			position: [-1.5, 8.7, -5.5],
			target: [2.6, 7.65, -0.5],
		}),
	);
	return {};
});
