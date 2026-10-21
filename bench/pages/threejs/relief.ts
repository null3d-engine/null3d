// The three.js twin of the relief scene (bench/scenes/relief.ts), which null3D's image tests draw.
// It draws the scene once into an offscreen target of the image's size, and publishes the pixels as
// the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and `?renderer=webgpu` with
// WebGPURenderer.
import type * as ThreeModule from 'three';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	RELIEF_BACKGROUND,
	RELIEF_CAMERA,
	RELIEF_IMAGE,
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
} from '../../scenes/relief';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree, type Three } from './harness';

/** A texture of a map, with mip levels and repeat wrapping as null3D's sketch makes it. */
function reliefTexture(three: Three, name: ReliefMapName): ThreeModule.DataTexture {
	const size = RELIEF_MAP_SIZE;
	const texture = new three.DataTexture(reliefTexels(RELIEF_MAPS[name]), size, size);
	texture.colorSpace = three.NoColorSpace;
	texture.wrapS = three.RepeatWrapping;
	texture.wrapT = three.RepeatWrapping;
	texture.magFilter = three.LinearFilter;
	texture.minFilter = three.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;
}

/** An object's material, with its maps. */
function material(three: Three, o: ReliefObject): ThreeModule.Material {
	const map = (name: ReliefMapName | undefined) => (name ? reliefTexture(three, name) : null);
	const wireframe = o.wireframe ?? false;
	if (o.unlit) return new three.MeshBasicMaterial({ color: o.color, wireframe });
	return new three.MeshStandardMaterial({
		color: o.color,
		roughness: o.roughness ?? 1,
		metalness: o.metalness ?? 0,
		bumpMap: map(o.bumpMap),
		bumpScale: o.bumpScale ?? 1,
		normalMap: map(o.normalMap),
		displacementMap: map(o.displacementMap),
		displacementScale: o.displacementScale ?? 1,
		displacementBias: o.displacementBias ?? 0,
		wireframe,
	});
}

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene);
	scene.background = new three.Color(RELIEF_BACKGROUND);

	const { radius, widthSegments, heightSegments } = RELIEF_SPHERE;
	const { width: w, height: h, widthSegments: ws, heightSegments: hs } = RELIEF_QUAD;
	const torus = RELIEF_TORUS;
	const meshes: Record<ReliefMesh, ThreeModule.BufferGeometry> = {
		quad: new three.PlaneGeometry(w, h, ws, hs),
		sphere: new three.SphereGeometry(radius, widthSegments, heightSegments),
		torus: new three.TorusGeometry(
			torus.radius,
			torus.tube,
			torus.radialSegments,
			torus.tubularSegments,
		),
	};
	for (const o of RELIEF_OBJECTS) {
		const mesh = new three.Mesh(meshes[o.mesh], material(three, o));
		mesh.position.set(...o.position, 0);
		mesh.rotation.x = o.turn ?? 0;
		scene.add(mesh);
	}

	const { width, height } = RELIEF_IMAGE;
	const { fov, near, far, position, target } = RELIEF_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'relief',
		renderer: rendererName,
		n: RELIEF_OBJECTS.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
