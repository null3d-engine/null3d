// A mirror sphere and a rough white sphere under a still sky, with a green sky layer installed
// during the setup, as an example add-on installs one. Hold mode draws its frame once, so both
// spheres show the layer only if its light reaches the sky's environment map, which the mirror
// reflects, and the diffuse light that the map gives the scene, which lights the rough sphere,
// before or within the held frame's own drawing. ?layer=off leaves the layer out, so a test can
// tell the layer's green from the core sky's own color.
import { defineFeature, defineSketch } from '@null3d/engine';
import layer from './sky-layer-held.wgsl';

const WITH_LAYER = new URL(import.meta.url).searchParams.get('layer') !== 'off';

const DESCRIPTION = defineFeature({
	name: 'held-layer',
	frame: 'background',
	kind: 'draw',
	provides: ['sky'],
	views: ['main', 'scenePass', 'reflection'],
});

export default defineSketch(async ({ scene, assets, geometry, materials, post, quality }) => {
	quality.set({ minRenderScale: 1 });
	post.set({ toneMapping: 'none' });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 40, position: [0, 0, 6], target: [0, 0, 0] }),
	);
	// No sun disc and no clouds, and no light of the scene's own: everything that the spheres show
	// comes from the sky and its environment map.
	scene.setBackground({
		sky: {
			sunPosition: [-0.4, 0.6, -0.7],
			cloudCoverage: 0,
			showSunDisc: false,
			mieCoefficient: 0.005,
		},
	});
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: 1 });
	const sphere = geometry.sphere({ radius: 1, widthSegments: 64, heightSegments: 32 });
	const mirror = materials.standard({ color: '#ffffff', metalness: 1, roughness: 0 });
	const rough = materials.standard({ color: '#ffffff', metalness: 0, roughness: 1 });
	scene.createMesh({ mesh: sphere, material: mirror, position: [-1.2, 0, 0] });
	scene.createMesh({ mesh: sphere, material: rough, position: [1.2, 0, 0] });
	// A layer that stands still: its map fills once, when the layer arrives.
	if (WITH_LAYER) scene.setSkyLayer(DESCRIPTION, { wgsl: layer, refresh: 0 });
	return {};
});
