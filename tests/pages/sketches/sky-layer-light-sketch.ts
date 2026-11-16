// A mirror sphere and a rough white sphere under a still sky, with no light but the sky's. The page
// installs a sky layer that covers the sky in green, and later removes it. Both spheres show the
// layer only once the sky's environment map holds it: the mirror from the map's texels, and the
// rough sphere from the diffuse light that the map gives the scene. The page reports both spheres'
// colors for every capture, so a test can tell whether the layer reached both places together.
import { defineFeature, defineSketch } from '@null3d/engine';
import layer from './sky-layer-light.wgsl';

const DESCRIPTION = defineFeature({
	name: 'test-layer',
	frame: 'background',
	kind: 'draw',
	provides: ['sky'],
	views: ['main', 'scenePass', 'reflection'],
});

export default defineSketch(async ({ scene, assets, geometry, materials, post, page, quality }) => {
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
	let installed = false;
	page.onMessage((name) => {
		if (name === 'layer' && !installed) {
			// A layer that stands still: its map fills once, when the layer arrives.
			scene.setSkyLayer(DESCRIPTION, { wgsl: layer, refresh: 0 });
			installed = true;
		} else if (name === 'clear' && installed) {
			scene.clearSkyLayer();
			installed = false;
		}
	});
	return {};
});
