// The three.js twin of the morph target scene (bench/scenes/morph.ts), which null3D's image tests
// draw. Each sphere is a Mesh of one BufferGeometry whose morphAttributes hold the targets' deltas,
// with morphTargetsRelative set as glTF files have it, and whose morphTargetInfluences hold the
// sphere's weights. It draws the scene once into an offscreen target of the image's size, and
// publishes the pixels as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and
// `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import { MORPH_CAMERA, MORPH_IMAGE, morphMesh, SPHERES, TARGET_NAMES } from '../../scenes/morph';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene);

	const arrays = morphMesh();
	const geometry = new three.BufferGeometry();
	geometry.setAttribute('position', new three.BufferAttribute(arrays.positions, 3));
	geometry.setAttribute('normal', new three.BufferAttribute(arrays.normals, 3));
	geometry.setIndex(new three.BufferAttribute(arrays.indices, 1));
	geometry.morphAttributes.position = arrays.positionDeltas.map((d, k) => {
		const attribute = new three.BufferAttribute(d, 3);
		attribute.name = TARGET_NAMES[k] as string;
		return attribute;
	});
	geometry.morphAttributes.normal = arrays.normalDeltas.map((d) => new three.BufferAttribute(d, 3));
	geometry.morphTargetsRelative = true;

	for (const sphere of SPHERES) {
		const mesh = new three.Mesh(geometry, new three.MeshStandardMaterial({ color: sphere.color }));
		mesh.position.set(...sphere.position);
		mesh.morphTargetInfluences = [...sphere.weights];
		scene.add(mesh);
	}

	const { width, height } = MORPH_IMAGE;
	const { fov, position, target, near, far } = MORPH_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'morph',
		renderer: rendererName,
		n: SPHERES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
