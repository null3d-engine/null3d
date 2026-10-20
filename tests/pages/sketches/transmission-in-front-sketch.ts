// A magenta post on the near bank stands in front of thick clear water, as the Creek's flowers
// stand in front of its stream. Each pixel of the water just past the post's top follows its bent
// ray down through the water, and that ray's end lands on the post on the screen. The post stands in
// front of the water, so its color must not show in the water: the water there shows the bed under
// its own pixel. Before the copy of the opaque color kept the opaque depth, a dim magenta copy of
// the post's top showed in the water beyond it.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#9fb4c8');
	scene.createDirectionalLight({ direction: [0.3, -0.8, -0.5], color: '#fff4e0', intensity: 2.5 });
	scene.createAmbientLight({ color: '#c8d8ff', intensity: 0.6 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			position: [0, 1.3, 2.4],
			target: [0, 0, -1],
			near: 0.1,
			far: 100,
		}),
	);
	// The near bank, which the post stands on, and the bed under the water, in stripes across the
	// view so that the water's bending shows.
	scene.createMesh({
		mesh: geometry.box({ width: 6, height: 0.6, depth: 2 }),
		material: materials.standard({ color: '#8d7b5c', roughness: 0.9 }),
		position: [0, -0.3, 1],
	});
	const stripe = geometry.box({ width: 6, height: 0.1, depth: 0.25 });
	const dark = materials.standard({ color: '#55705f', roughness: 0.9 });
	const light = materials.standard({ color: '#c7c09a', roughness: 0.9 });
	for (let k = 0; k < 16; k++)
		scene.createMesh({
			mesh: stripe,
			material: k % 2 === 0 ? dark : light,
			position: [0, -0.65, -0.125 - 0.25 * k],
		});
	// The water: a slab whose surface lies level with the bank, with a thick volume under it.
	scene.createMesh({
		mesh: geometry.box({ width: 6, height: 0.05, depth: 4 }),
		material: materials.standard({
			color: '#ffffff',
			roughness: 0.03,
			metalness: 0,
			ior: 1.33,
			transmission: 1,
			thickness: 0.6,
		}),
		position: [0, -0.025, -2],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.16, height: 0.7, depth: 0.16 }),
		material: materials.standard({ color: '#ff00ff', roughness: 0.6 }),
		position: [0, 0.35, 0.15],
	});
	return {};
});
