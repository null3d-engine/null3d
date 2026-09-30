// The directional light's shadows (bench/scenes/shadows.ts), which the parity test also draws with
// three.js: a ground, and boxes, a ball and posts that cast and receive shadows, from next to the
// camera out past 40 m, so each cascade holds some. ?cascades=<n> sets the cascade count, from 1
// to 4.
import { defineSketch, type Material, type MeshGeometry } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	SHADOW_CAMERA,
	SHADOW_MESHES,
	SHADOW_OBJECTS,
	SHADOW_SUN,
	type ShadowMeshName,
} from '../../../bench/scenes/shadows';

const params = new URL(import.meta.url).searchParams;
/** The cascade count, from the sketch module's ?cascades switch. */
const CASCADES = Number(params.get('cascades') ?? 3);

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground(BACKGROUND);
	const { fov, position, target, near, far } = SHADOW_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, position, target, near, far }));
	const { direction, color, intensity, mapSize, distance } = SHADOW_SUN;
	scene.createDirectionalLight({
		direction,
		color,
		intensity,
		castShadows: true,
		shadow: { cascades: CASCADES, mapSize, distance },
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });

	const meshOf = (name: ShadowMeshName): MeshGeometry => {
		const shape: { size?: readonly number[]; radius?: number } = SHADOW_MESHES[name];
		const [width, height, depth] = shape.size ?? [];
		return shape.radius !== undefined
			? geometry.sphere({ radius: shape.radius })
			: geometry.box({ width, height, depth });
	};
	// Objects share their meshes and materials, as the three.js twin's do.
	const meshes = new Map<ShadowMeshName, MeshGeometry>();
	const colors = new Map<string, Material>();
	for (const object of SHADOW_OBJECTS) {
		const mesh = meshes.get(object.mesh) ?? meshOf(object.mesh);
		meshes.set(object.mesh, mesh);
		const key = `${object.color} ${object.lit}`;
		const material =
			colors.get(key) ??
			(object.lit
				? materials.standard({ color: object.color })
				: materials.unlit({ color: object.color }));
		colors.set(key, material);
		scene.createMesh({
			mesh,
			material,
			position: object.position,
			castShadows: object.cast,
			receiveShadows: object.receive,
		});
	}
});
