// The transparent planes' scene (bench/scenes/transparency.ts), which the parity test also draws
// with three.js: see-through planes and a sphere, created nearest first, which the engine must
// draw farthest first with normal blending.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	GLASS_BOXES,
	GLASS_CAMERA,
	GLASS_PLANES,
	GLASS_SPHERE,
	GLASS_SPHERE_SEGMENTS,
	SUN,
} from '../../../bench/scenes/transparency';

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	const { fov, near, far, position, target } = GLASS_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));

	for (const { size, position: center, color } of GLASS_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color }),
			position: center,
		});
	}
	for (const { size, lit, color, opacity, position: center, turn } of GLASS_PLANES) {
		const options = { color, opacity, alphaMode: 'blend', doubleSided: true } as const;
		const plane = scene.createMesh({
			mesh: geometry.plane({ width: size[0], height: size[1] }),
			material: lit ? materials.standard(options) : materials.unlit(options),
			position: center,
		});
		plane.setRotationEuler(0, turn, 0);
	}
	const [widthSegments, heightSegments] = GLASS_SPHERE_SEGMENTS;
	scene.createMesh({
		mesh: geometry.sphere({ radius: GLASS_SPHERE.radius, widthSegments, heightSegments }),
		material: materials.standard({
			color: GLASS_SPHERE.color,
			opacity: GLASS_SPHERE.opacity,
			alphaMode: 'blend',
		}),
		position: GLASS_SPHERE.position,
	});
	return {};
});
