// The relief scene (bench/scenes/relief.ts), which the parity test also draws with three.js: bump
// maps, displacement maps and wireframes of the standard and unlit materials, each map made in code.
// ?tone=none turns off the engine's default of ACES, as the parity test asks: the three.js twin
// draws with no tone mapping, three.js's default.
import { defineSketch, type Material, type MeshGeometry, type Texture } from '@null3d/engine';
import {
	AMBIENT,
	RELIEF_BACKGROUND,
	RELIEF_CAMERA,
	RELIEF_MAP_SIZE,
	RELIEF_MAPS,
	RELIEF_OBJECTS,
	RELIEF_QUAD,
	RELIEF_SPHERE,
	RELIEF_TORUS,
	type ReliefMapName,
	type ReliefMesh,
	type ReliefObject,
	reliefTexels,
	SUN,
} from '../../../bench/scenes/relief';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(({ scene, materials, geometry, textures, post }) => {
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
	scene.setBackground(RELIEF_BACKGROUND);
	scene.setActiveCamera(scene.createPerspectiveCamera(RELIEF_CAMERA));
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);

	const maps = new Map<ReliefMapName, Texture>();
	for (const name of Object.keys(RELIEF_MAPS) as ReliefMapName[])
		maps.set(
			name,
			textures.fromData({
				width: RELIEF_MAP_SIZE,
				height: RELIEF_MAP_SIZE,
				data: reliefTexels(RELIEF_MAPS[name]),
				colorSpace: 'linear',
				mipmaps: true,
				wrap: 'repeat',
			}),
		);
	const meshes: Record<ReliefMesh, MeshGeometry> = {
		quad: geometry.plane(RELIEF_QUAD),
		sphere: geometry.sphere(RELIEF_SPHERE),
		torus: geometry.torus(RELIEF_TORUS),
	};
	const map = (name: ReliefMapName | undefined) => (name ? maps.get(name) : undefined);

	const material = (o: ReliefObject): Material => {
		if (o.unlit) return materials.unlit({ color: o.color, wireframe: o.wireframe });
		return materials.standard({
			color: o.color,
			roughness: o.roughness,
			metalness: o.metalness,
			bumpMap: map(o.bumpMap),
			bumpScale: o.bumpScale,
			normalMap: map(o.normalMap),
			displacementMap: map(o.displacementMap),
			displacementScale: o.displacementScale,
			displacementBias: o.displacementBias,
			wireframe: o.wireframe,
		});
	};
	for (const o of RELIEF_OBJECTS)
		scene
			.createMesh({ mesh: meshes[o.mesh], material: material(o), position: [...o.position, 0] })
			.setRotationEuler(o.turn ?? 0, 0, 0);
});
