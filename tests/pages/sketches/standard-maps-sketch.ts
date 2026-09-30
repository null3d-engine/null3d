// The texture maps scene (bench/scenes/material-maps.ts), which the parity test also draws with
// three.js: each map of the standard material, and an unlit map, each made in code.
import { defineSketch, type Material, type MeshGeometry, type Texture } from '@null3d/engine';
import {
	AMBIENT,
	MAP_OPTIONS,
	MAP_SIZE,
	MAPS,
	MAPS_BACKGROUND,
	MAPS_CAMERA,
	MAPS_OBJECTS,
	MAPS_QUAD,
	MAPS_SPHERE,
	MAPS_SQUARE,
	MAPS_SQUARE_UVS1,
	type MapName,
	type MapsMesh,
	type MapsObject,
	mapTexels,
	SUN,
} from '../../../bench/scenes/material-maps';

export default defineSketch(({ scene, materials, geometry, textures }) => {
	scene.setBackground(MAPS_BACKGROUND);
	scene.setActiveCamera(scene.createPerspectiveCamera(MAPS_CAMERA));
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);

	const maps = new Map<MapName, Texture>();
	for (const [name, spec] of Object.entries(MAPS) as [MapName, (typeof MAPS)[MapName]][])
		maps.set(
			name,
			textures.fromData({
				width: MAP_SIZE,
				height: MAP_SIZE,
				data: mapTexels(spec),
				colorSpace: spec.colorSpace,
				uvSet: spec.uvSet,
				mipmaps: true,
				wrap: 'repeat',
			}),
		);
	const meshes: Record<MapsMesh, MeshGeometry> = {
		sphere: geometry.sphere(MAPS_SPHERE),
		quad: geometry.plane(MAPS_QUAD),
		'tangent-square': geometry.fromArrays({ ...MAPS_SQUARE, computeTangents: true }),
		'second-uv-square': geometry.fromArrays({ ...MAPS_SQUARE, uvs1: MAPS_SQUARE_UVS1 }),
	};

	const material = (o: MapsObject): Material => {
		const textured = Object.fromEntries(
			MAP_OPTIONS.flatMap((option) => {
				const name = o[option];
				return name ? [[option, maps.get(name)]] : [];
			}),
		);
		if (o.unlit)
			return materials.unlit({ color: o.color, map: textured.map, uvTransform: o.uvTransform });
		const { color, metalness, roughness, emissive, lightMapIntensity, uvTransform } = o;
		const values = { color, metalness, roughness, emissive, lightMapIntensity, uvTransform };
		return materials.standard({ ...values, ...textured });
	};
	for (const o of MAPS_OBJECTS)
		scene
			.createMesh({ mesh: meshes[o.mesh], material: material(o), position: [...o.position, 0] })
			.setRotationEuler(o.turn ?? 0, 0, 0);
});
