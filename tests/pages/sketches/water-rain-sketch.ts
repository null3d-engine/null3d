// A lake drawn by @null3d/water under a clear sky, with a bright post and a dark stone beside it,
// seen low across the water so its mirror fills the view. The `rain` switch rains on the lake at full
// strength: each drop rings the surface where it lands, and the rings bend the mirror. Without the
// switch the lake is calm, and the surface skips the rings' work.
import { defineSketch } from '@null3d/engine';
import { createWater } from '@null3d/water';

/** True when the page asks for rain on the lake. */
const RAIN = new URL(import.meta.url).searchParams.has('rain');

/** The lake's shore, a circle of 48 points in meters. */
const SHORE: [number, number][] = Array.from({ length: 48 }, (_, index) => {
	const angle = (index / 48) * Math.PI * 2;
	return [Math.cos(angle) * 14, Math.sin(angle) * 14];
});

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials } = ctx;
	scene.setBackground({ sky: { sunPosition: [-0.3, 0.35, -0.9], cloudCoverage: 0 } });
	scene.setEnvironment(await assets.skyEnvironment());
	scene.createDirectionalLight({ direction: [0.3, -0.5, 0.8], intensity: 3 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 3.5, 7], target: [0, 0, -3] }),
	);
	// A bed below the surface, a pale post and a dark stone that the water mirrors.
	scene.createMesh({
		mesh: geometry.box({ width: 60, height: 0.2, depth: 60 }),
		material: materials.standard({ color: '#4d5a3a', roughness: 1 }),
		position: [0, -1.6, 0],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.8, height: 5, depth: 0.8 }),
		material: materials.standard({ color: '#e8e2d4', roughness: 0.6 }),
		position: [-2.5, 1, -6],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1.4 }),
		material: materials.standard({ color: '#3a3733', roughness: 0.9 }),
		position: [3, 0.1, -5],
	});
	const water = createWater(ctx, {
		shapes: { kind: 'lake', shore: SHORE, depth: 1.5, shoreWidth: 2 },
		rain: RAIN ? 1 : 0,
	});
	return {
		onUpdate() {
			water.update();
		},
	};
});
