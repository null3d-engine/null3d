// A lake that mirrors a sky with a flat layer over it. The layer covers every direction with one
// colour, so the sky above the horizon and the lake that reflects it must show the same value, and
// both must follow the scene's exposure. A second setting, the background's own intensity, dims the
// sky and its layer but not the map that the lake reflects, so the two part inside it. A rough white
// sphere stands against the sky, so the light that the sky's map gives the scene is read in the same
// frame as the reflections.
import { defineFeature, defineSketch } from '@null3d/engine';
import layer from './sky-layer-exposure.wgsl';

const DESCRIPTION = defineFeature({
	name: 'flat-layer',
	frame: 'background',
	kind: 'draw',
	provides: ['sky'],
	views: ['main', 'scenePass', 'reflection'],
});

export default defineSketch(async ({ scene, assets, geometry, materials, post, quality, page }) => {
	// The page compares its own frames, so the frame-budget governor may not change the render scale
	// between two reads.
	quality.set({ minRenderScale: 1, governor: false });
	post.set({ toneMapping: 'none' });
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		near: 0.5,
		far: 4000,
		position: [0, 2.4, 20],
	});
	camera.lookAt(0, 4, -60);
	scene.setActiveCamera(camera);
	// No sun disc, no clouds, and no light of the scene's own: the sky and its map are all that draws.
	const sky = {
		sunPosition: [-0.4, 0.6, -0.7] as [number, number, number],
		cloudCoverage: 0,
		showSunDisc: false,
		mieCoefficient: 0.005,
	};
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: 1 });
	const mirror = materials.standard({ color: '#ffffff', roughness: 0, metalness: 1 });
	scene.createMesh({
		mesh: geometry.plane({ width: 4000, height: 4000 }),
		material: mirror,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	const rough = materials.standard({ color: '#ffffff', roughness: 1, metalness: 0 });
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1, widthSegments: 48, heightSegments: 24 }),
		material: rough,
		position: [3, 4, 6],
	});
	scene.setSkyLayer(DESCRIPTION, { wgsl: layer, refresh: 0 });
	let exposure = 0.1;
	let intensity = 1;
	const apply = () => {
		post.set({ exposure });
		scene.setBackground({ sky: { ...sky } }, { intensity });
	};
	page.onMessage((name, data) => {
		if (name !== 'set') return;
		const values = data as { exposure: number; intensity: number };
		exposure = values.exposure;
		intensity = values.intensity;
		apply();
	});
	apply();
	return {};
});
