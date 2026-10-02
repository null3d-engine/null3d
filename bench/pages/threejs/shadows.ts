// The three.js twin of the directional light's shadows (bench/scenes/shadows.ts), which null3D's
// image tests draw. three.js draws one shadow map, in a box along the light that holds every shadow
// the view shows, where null3D fits its cascades to the view. Both maps have texels smaller than the
// image's pixels, so both draw the same shadows. It draws the scene once into an offscreen target
// of the image's size, and publishes the pixels as the hold pages do. `?renderer=webgl` draws with
// WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer, each with its default filter,
// PCFShadowMap.
import type * as ThreeModule from 'three';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	AMBIENT,
	BACKGROUND,
	SHADOW_CAMERA,
	SHADOW_IMAGE,
	SHADOW_MESHES,
	SHADOW_OBJECTS,
	SHADOW_SUN,
	type ShadowMeshName,
	THREE_SHADOW_CAMERA,
} from '../../scenes/shadows';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	renderer.shadowMap.enabled = true;
	const scene = new three.Scene();
	scene.background = new three.Color(BACKGROUND);
	scene.add(new three.AmbientLight(AMBIENT.color, AMBIENT.intensity));

	// The sun stands half the shadow box's depth back along its light from the box's middle.
	const sun = new three.DirectionalLight(SHADOW_SUN.color, SHADOW_SUN.intensity);
	const { target, halfSize, depth, mapSize } = THREE_SHADOW_CAMERA;
	const toward = new three.Vector3(...SHADOW_SUN.direction).normalize();
	sun.target.position.set(...target);
	sun.position.set(...target).addScaledVector(toward, -depth / 2);
	sun.castShadow = true;
	sun.shadow.mapSize.set(mapSize, mapSize);
	const box = sun.shadow.camera;
	[box.left, box.right, box.top, box.bottom] = [-halfSize, halfSize, halfSize, -halfSize];
	[box.near, box.far] = [0, depth];
	box.updateProjectionMatrix();
	scene.add(sun, sun.target);

	const meshOf = (name: ShadowMeshName): ThreeModule.BufferGeometry => {
		const shape: { size?: readonly number[]; radius?: number } = SHADOW_MESHES[name];
		const [width, height, length] = shape.size ?? [];
		return shape.radius !== undefined
			? new three.SphereGeometry(shape.radius)
			: new three.BoxGeometry(width, height, length);
	};
	const meshes = new Map<ShadowMeshName, ThreeModule.BufferGeometry>();
	const colors = new Map<string, ThreeModule.Material>();
	for (const object of SHADOW_OBJECTS) {
		const mesh = meshes.get(object.mesh) ?? meshOf(object.mesh);
		meshes.set(object.mesh, mesh);
		const key = `${object.color} ${object.lit}`;
		const material =
			colors.get(key) ??
			(object.lit
				? new three.MeshStandardMaterial({ color: object.color })
				: new three.MeshBasicMaterial({ color: object.color }));
		colors.set(key, material);
		const node = new three.Mesh(mesh, material);
		node.position.set(...object.position);
		node.castShadow = object.cast;
		node.receiveShadow = object.receive;
		scene.add(node);
	}

	const { width, height } = SHADOW_IMAGE;
	const { fov, position, target: lookAt, near, far } = SHADOW_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...lookAt);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'shadows',
		renderer: rendererName,
		n: SHADOW_OBJECTS.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
