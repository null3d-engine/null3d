// The three.js twin of the standard material's grid (bench/scenes/standard-grid.ts), which
// null3D's image tests draw: MeshStandardMaterial spheres over metalness and roughness, lit by a
// sun and an ambient light. It draws the scene once into an offscreen target of the image's size,
// and publishes the pixels as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and
// `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	GRID_AMBIENT,
	GRID_BACKGROUND,
	GRID_CAMERA,
	GRID_CELLS,
	GRID_COLOR,
	GRID_IMAGE,
	GRID_SPHERE,
	GRID_SUN,
} from '../../scenes/standard-grid';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene, { sun: GRID_SUN, ambient: GRID_AMBIENT }, GRID_BACKGROUND);

	const { radius, widthSegments, heightSegments } = GRID_SPHERE;
	const sphere = new three.SphereGeometry(radius, widthSegments, heightSegments);
	for (const { position, metalness, roughness } of GRID_CELLS) {
		const material = new three.MeshStandardMaterial({ color: GRID_COLOR, metalness, roughness });
		const mesh = new three.Mesh(sphere, material);
		mesh.position.set(...position);
		scene.add(mesh);
	}

	const { width, height } = GRID_IMAGE;
	const { fov, near, far, position, target } = GRID_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'standard-grid',
		renderer: rendererName,
		n: GRID_CELLS.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
