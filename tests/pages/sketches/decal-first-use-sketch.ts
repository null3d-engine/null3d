// One decal on a plain ground, for the first-use test: it uses the decals feature alone, so a page
// downloads the decals shader file once, for its device's fixed bits. Keep it free of every other
// feature that loads on first use: no instance row values, so no combined build, and no
// shadow-casting sun, whose contact shadows would load the ambient occlusion shader on a desktop.
import { defineSketch, type Quat } from '@null3d/engine';

/** A rotation that turns a box's +z axis to point up, so it projects down onto the ground. */
const DOWN: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export default defineSketch(({ scene, geometry, materials, textures }) => {
	scene.setBackground('#8fa3b8');
	scene.createHemisphereLight({ skyColor: '#a8c4ff', groundColor: '#5a4a3a', intensity: 1 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 3, 4], target: [0, 0, 0] }),
	);
	scene.createMesh({
		mesh: geometry.plane({ width: 6, height: 6 }),
		material: materials.standard({ color: '#9a948a', roughness: 0.85 }),
		rotation: DOWN,
	});
	const texels = new Uint8Array(8 * 8 * 4);
	for (let k = 0; k < 64; k++) texels.set([180, 90, 40, 255], k * 4);
	const map = textures.fromData({ width: 8, height: 8, data: texels, colorSpace: 'srgb' });
	scene.createMesh({
		mesh: geometry.box(),
		material: materials.decal({ map, roughness: 0.7 }),
		position: [0, 0, 0],
		scale: [2, 2, 1],
		rotation: DOWN,
	});
	return {};
});
