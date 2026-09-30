// The three.js twin of the texture maps scene (bench/scenes/material-maps.ts), which null3D's image
// tests draw. It draws the scene once into an offscreen target of the image's size, and publishes
// the pixels as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and
// `?renderer=webgpu` with WebGPURenderer.
import type * as ThreeModule from 'three';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	MAP_OPTIONS,
	MAP_SIZE,
	MAPS,
	MAPS_BACKGROUND,
	MAPS_CAMERA,
	MAPS_IMAGE,
	MAPS_OBJECTS,
	MAPS_QUAD,
	MAPS_SPHERE,
	MAPS_SQUARE,
	MAPS_SQUARE_UVS1,
	type MapName,
	type MapsMesh,
	type MapsObject,
	type MapsUvTransform,
	mapTexels,
} from '../../scenes/material-maps';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree, type Three } from './harness';

/**
 * A texture of a map, with mip levels and repeat wrapping as null3D's sketch makes it. three.js
 * keeps a texture coordinate transform per texture, so each object's maps are textures of their own.
 */
function mapTexture(
	three: Three,
	name: MapName,
	transform: MapsUvTransform | undefined,
): ThreeModule.DataTexture {
	const spec = MAPS[name];
	const texture = new three.DataTexture(mapTexels(spec), MAP_SIZE, MAP_SIZE);
	texture.colorSpace = spec.colorSpace === 'srgb' ? three.SRGBColorSpace : three.NoColorSpace;
	texture.channel = spec.uvSet;
	texture.wrapS = three.RepeatWrapping;
	texture.wrapT = three.RepeatWrapping;
	texture.magFilter = three.LinearFilter;
	texture.minFilter = three.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	if (transform) {
		texture.offset.set(...transform.offset);
		texture.repeat.set(...transform.repeat);
		texture.rotation = transform.rotation;
	}
	texture.needsUpdate = true;
	return texture;
}

/** The square of two triangles, with the attributes that `extra` adds. */
function square(three: Three, extra: (g: ThreeModule.BufferGeometry) => void) {
	const g = new three.BufferGeometry();
	g.setAttribute('position', new three.Float32BufferAttribute(MAPS_SQUARE.positions, 3));
	g.setAttribute('normal', new three.Float32BufferAttribute(MAPS_SQUARE.normals, 3));
	g.setAttribute('uv', new three.Float32BufferAttribute(MAPS_SQUARE.uvs, 2));
	g.setIndex([...MAPS_SQUARE.indices]);
	extra(g);
	return g;
}

/** An object's material, with its maps. */
function material(three: Three, o: MapsObject): ThreeModule.Material {
	const maps: Partial<Record<(typeof MAP_OPTIONS)[number], ThreeModule.Texture>> = {};
	for (const option of MAP_OPTIONS) {
		const name = o[option];
		if (name) maps[option] = mapTexture(three, name, o.uvTransform);
	}
	const color = o.color ?? '#ffffff';
	if (o.unlit) return new three.MeshBasicMaterial({ color, map: maps.map });
	return new three.MeshStandardMaterial({
		color,
		metalness: o.metalness ?? 0,
		roughness: o.roughness ?? 1,
		emissive: o.emissive ?? '#000000',
		lightMapIntensity: o.lightMapIntensity ?? 1,
		map: maps.map,
		metalnessMap: maps.metalnessRoughnessMap,
		roughnessMap: maps.metalnessRoughnessMap,
		normalMap: maps.normalMap,
		aoMap: maps.aoMap,
		emissiveMap: maps.emissiveMap,
		lightMap: maps.lightMap,
	});
}

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene);
	scene.background = new three.Color(MAPS_BACKGROUND);

	const { radius, widthSegments, heightSegments } = MAPS_SPHERE;
	const meshes: Record<MapsMesh, ThreeModule.BufferGeometry> = {
		sphere: new three.SphereGeometry(radius, widthSegments, heightSegments),
		quad: new three.PlaneGeometry(
			MAPS_QUAD.width,
			MAPS_QUAD.height,
			MAPS_QUAD.widthSegments,
			MAPS_QUAD.heightSegments,
		),
		'tangent-square': square(three, (g) => g.computeTangents()),
		'second-uv-square': square(three, (g) =>
			g.setAttribute('uv1', new three.Float32BufferAttribute(MAPS_SQUARE_UVS1, 2)),
		),
	};
	for (const o of MAPS_OBJECTS) {
		const mesh = new three.Mesh(meshes[o.mesh], material(three, o));
		mesh.position.set(...o.position, 0);
		mesh.rotation.x = o.turn ?? 0;
		scene.add(mesh);
	}

	const { width, height } = MAPS_IMAGE;
	const { fov, near, far, position, target } = MAPS_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'material-maps',
		renderer: rendererName,
		n: MAPS_OBJECTS.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
