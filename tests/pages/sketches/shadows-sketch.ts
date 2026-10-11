// The directional light's shadows (bench/scenes/shadows.ts), which the parity test also draws with
// three.js: a ground, and boxes, a ball and posts that cast and receive shadows, from next to the
// camera out past 40 m, so each cascade holds some. ?cascades=<n> sets the cascade count, from 1
// to 4. ?custom draws the ground and the red boxes with custom materials whose surface function
// keeps the standard look, so the image must match the one without it. ?tone=none turns off the
// engine's default of ACES, as the parity test asks: the three.js twin draws with no tone mapping,
// three.js's default. ?filter=<n> sets the shadow filter, 3 or 5 texels; 3 by default, so every
// GPU tier draws the same image whatever preset it runs. ?batches draws the objects as rows of
// instance batches, one for each mesh, material and pair of shadow options, which must cast and
// receive as the objects do; ?batches=dynamic makes them dynamic batches.
import { defineSketch, type Material, type MeshGeometry } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	SHADOW_CAMERA,
	SHADOW_CUSTOM_COLORS,
	SHADOW_MESHES,
	SHADOW_OBJECTS,
	SHADOW_SUN,
	type ShadowMeshName,
} from '../../../bench/scenes/shadows';

const params = new URL(import.meta.url).searchParams;
/** The cascade count, from the sketch module's ?cascades switch. */
const CASCADES = Number(params.get('cascades') ?? 3);
/** True when the sketch module's ?custom switch draws some objects with custom materials. */
const CUSTOM = params.has('custom');
/** The shadow filter's texels on each side, from the sketch module's ?filter switch. */
const FILTER = params.get('filter') === '5' ? 5 : 3;
/** Whether the objects draw as instance rows, from the sketch module's ?batches switch. */
const BATCHES = params.get('batches');

/** A surface function that keeps the material's own look. */
const plain = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    return defaultSurface(input);
}
`;

export default defineSketch(({ scene, materials, geometry, post, quality }) => {
	quality.set({ shadowFilter: FILTER });
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
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
	const materialOf = (color: string, lit: boolean): Material => {
		if (!lit) return materials.unlit({ color });
		return CUSTOM && SHADOW_CUSTOM_COLORS.includes(color)
			? materials.shader({ color, wgsl: plain })
			: materials.standard({ color });
	};
	// Objects share their meshes and materials, as the three.js twin's do.
	const meshes = new Map<ShadowMeshName, MeshGeometry>();
	const colors = new Map<string, Material>();
	const rows = new Map<string, (typeof SHADOW_OBJECTS)[number][]>();
	for (const object of SHADOW_OBJECTS) {
		const mesh = meshes.get(object.mesh) ?? meshOf(object.mesh);
		meshes.set(object.mesh, mesh);
		const key = `${object.color} ${object.lit}`;
		const material = colors.get(key) ?? materialOf(object.color, object.lit);
		colors.set(key, material);
		if (BATCHES === null) {
			scene.createMesh({
				mesh,
				material,
				position: object.position,
				castShadows: object.cast,
				receiveShadows: object.receive,
			});
			continue;
		}
		const group = `${object.mesh} ${key} ${object.cast} ${object.receive}`;
		rows.set(group, [...(rows.get(group) ?? []), object]);
	}
	for (const group of rows.values()) {
		const [first] = group as [(typeof SHADOW_OBJECTS)[number]];
		const batch = scene.createInstances(meshes.get(first.mesh) as MeshGeometry, group.length, {
			material: colors.get(`${first.color} ${first.lit}`) as Material,
			dynamic: BATCHES === 'dynamic',
			castShadows: first.cast,
			receiveShadows: first.receive,
		});
		group.forEach((object, row) => {
			batch.positions.set(object.position, row * 3);
		});
		batch.markDirty();
	}
});
