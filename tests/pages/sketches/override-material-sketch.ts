// The material override: a small scene of a lit, an unlit and a blended object, and an instance
// batch, drawn with each object's own materials, or with one material that every mesh and batch
// row of the main pass draws with. ?override=1 sets the override in the setup, so the frame that
// the page holds draws with it. The blended box becomes opaque, the unlit sphere takes the
// override's lighting, and the batch keeps its rows.
import { defineSketch } from '@null3d/engine';

const override = new URL(import.meta.url).searchParams.get('override') === '1';

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#3a5f8a');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			near: 0.5,
			far: 40,
			position: [0, 3, 7],
			target: [0, 0.5, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.3 });

	scene.createMesh({
		mesh: geometry.plane({ width: 12, height: 40 }),
		material: materials.standard({ color: '#7a8b6f' }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		position: [0, 0, -15],
	});
	scene.createMesh({
		mesh: geometry.box(),
		material: materials.standard({ color: '#e8554e' }),
		position: [-2, 0.5, 0],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.7, widthSegments: 16, heightSegments: 10 }),
		material: materials.unlit({ color: '#4a8cff' }),
		position: [0, 0.7, -1],
	});
	scene.createMesh({
		mesh: geometry.torus({ radius: 0.6, tube: 0.2 }),
		material: materials.standard({ color: '#f2c14e' }),
		position: [2, 0.8, 0],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 3, height: 1.6, depth: 1 }),
		material: materials.standard({ color: '#ffffff', opacity: 0.4, alphaMode: 'blend' }),
		position: [-1, 0.8, 1.5],
	});
	const cubes = scene.createInstances(geometry.box({ width: 0.4, height: 0.4, depth: 0.4 }), 5, {
		material: materials.standard({ color: '#9b6bd6' }),
	});
	for (let k = 0; k < 5; k++) {
		cubes.positions.set([k - 2, 0.2, -4], k * 3);
		cubes.rotations.set([0, 0, 0, 1], k * 4);
		cubes.scales.set([1, 1, 1], k * 3);
	}
	cubes.markDirty();

	if (override)
		scene.overrideMaterial = materials.standard({
			color: '#f0b44c',
			roughness: 0.3,
			doubleSided: true,
		});
	return {};
});
