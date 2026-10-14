// Decals on a stone yard under a low sun: a scorch mark, a stripe of road paint through the ball's
// shadow, a puddle, cracks on the wall, moss over the ball's foot, which fades up its curved side,
// and a batch of mud splashes whose row colors tint and fade each one. Each decal is a box with a
// decal material, whose maps come from the code-made textures of the decals demo. A point light
// warms the puddle. ?none leaves the decals out, so the decals spec can compare each place with the
// bare yard.
import { defineSketch, type Quat, type Vec3 } from '@null3d/engine';
import {
	cracks,
	type DecalTexels,
	moss,
	mud,
	puddle,
	roadPaint,
	scorch,
} from '../../../examples/decals/decal-textures';

const params = new URL(import.meta.url).searchParams;

/** A rotation that turns a box's +z axis to point up, so it projects down onto the ground. */
const DOWN: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export default defineSketch(({ scene, geometry, materials, textures }) => {
	scene.setBackground('#8fa3b8');
	scene.createDirectionalLight({
		direction: [0.55, -0.6, -0.58],
		color: '#ffe2c4',
		intensity: 3,
		castShadows: true,
		shadow: { distance: 20 },
	});
	scene.createHemisphereLight({ skyColor: '#a8c4ff', groundColor: '#5a4a3a', intensity: 0.8 });
	scene.createPointLight({ position: [2.2, 0.6, 1.6], color: '#ffb066', intensity: 6, range: 4 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 4.2, 6.5], target: [0, 0, 0] }),
	);

	const solid = { castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: geometry.plane({ width: 14, height: 10 }),
		material: materials.standard({ color: '#9a948a', roughness: 0.85 }),
		rotation: DOWN,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.box({ width: 10, height: 3, depth: 0.4 }),
		material: materials.standard({ color: '#b8aa98', roughness: 0.9 }),
		position: [0, 1.5, -2.2],
		...solid,
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.7 }),
		material: materials.standard({ color: '#c9c3b8', roughness: 0.6 }),
		position: [-0.4, 0.7, 0.2],
		...solid,
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.8, height: 1.6, depth: 0.8 }),
		material: materials.standard({ color: '#7d8fa6', roughness: 0.5 }),
		position: [1.6, 0.8, -0.6],
		...solid,
	});
	if (params.has('none')) return {};

	const look = { mipmaps: true, anisotropy: 8 } as const;
	const decal = (texels: DecalTexels, options: Parameters<typeof materials.decal>[0] = {}) => {
		const { size, color, finish, normal } = texels;
		const at = { width: size, height: size };
		return materials.decal({
			map: textures.fromData({ ...at, data: color, colorSpace: 'srgb', ...look }),
			metalnessRoughnessMap: textures.fromData({ ...at, data: finish, ...look }),
			normalMap: textures.fromData({ ...at, data: normal, ...look }),
			...options,
		});
	};
	const box = geometry.box();
	const place = (
		material: ReturnType<typeof decal>,
		position: Vec3,
		scale: Vec3,
		rotation = DOWN,
	) => scene.createMesh({ mesh: box, material, position, scale, rotation });

	place(decal(scorch()), [-3.2, 0, 1.2], [2.2, 2.2, 1]);
	place(decal(roadPaint(), { roughness: 0.6 }), [0.6, 0, 0.6], [0.5, 4.4, 1.6]);
	place(decal(puddle(), { roughness: 1 }), [2.6, 0, 1.8], [2.4, 1.8, 0.6]);
	place(decal(cracks()), [-2.2, 1.6, -2], [2.6, 2.6, 0.6], [0, 0, 0, 1]);
	place(decal(moss(), { roughness: 1 }), [-0.4, 0.1, 0.3], [1.9, 1.9, 1.4]);

	// Mud splashes in one batch: each row's color tints the splash and its alpha fades it.
	const splashes = scene.createInstances(box, 6, { material: decal(mud()), colors: true });
	const tints = splashes.colors as Float32Array;
	for (let k = 0; k < 6; k++) {
		// Each splash projects down, turned about the vertical by its own angle.
		const [c, s] = [Math.cos(k * 0.55), Math.sin(k * 0.55)];
		splashes.positions.set([-1.6 + k * 0.75, 0, 2.6 - (k % 2) * 0.5], k * 3);
		splashes.rotations.set(
			[-Math.SQRT1_2 * c, Math.SQRT1_2 * s, Math.SQRT1_2 * s, Math.SQRT1_2 * c],
			k * 4,
		);
		splashes.scales.set([0.9, 0.9, 0.6], k * 3);
		tints.set([1 - k * 0.08, 1 - k * 0.1, 1 - k * 0.12, 1 - k * 0.12], k * 4);
	}
	return {};
});
