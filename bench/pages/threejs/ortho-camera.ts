// The three.js twin of the orthographic camera's scene (bench/scenes/ortho-camera.ts), which
// null3D's image tests draw. It draws the scene once through three.js's OrthographicCamera into an
// offscreen target of the image's size, and publishes the pixels as the hold pages do.
// `?renderer=webgl` draws with WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	ORTHO_BOXES,
	ORTHO_CAMERA,
	ORTHO_COUNT,
	ORTHO_CUBE_COLOR,
	ORTHO_CUBE_SIZE,
	ORTHO_CUBES,
	ORTHO_IMAGE,
} from '../../scenes/ortho-camera';
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

	for (const { size, position, color, lit } of ORTHO_BOXES) {
		const material = lit
			? new three.MeshStandardMaterial({ color })
			: new three.MeshBasicMaterial({ color });
		const box = new three.Mesh(new three.BoxGeometry(...size), material);
		box.position.set(...position);
		scene.add(box);
	}
	const edge = ORTHO_CUBE_SIZE;
	const cubes = new three.InstancedMesh(
		new three.BoxGeometry(edge, edge, edge),
		new three.MeshStandardMaterial({ color: ORTHO_CUBE_COLOR }),
		ORTHO_CUBES.length,
	);
	const matrix = new three.Matrix4();
	for (const [k, [x, y, z]] of ORTHO_CUBES.entries())
		cubes.setMatrixAt(k, matrix.makeTranslation(x, y, z));
	scene.add(cubes);

	// A view of the camera's height, as wide as the image's aspect ratio makes it.
	const { width, height } = ORTHO_IMAGE;
	const { position, target, near, far } = ORTHO_CAMERA;
	const halfHeight = ORTHO_CAMERA.height / 2;
	const halfWidth = (halfHeight * width) / height;
	const camera = new three.OrthographicCamera(
		-halfWidth,
		halfWidth,
		halfHeight,
		-halfHeight,
		near,
		far,
	);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'ortho-camera',
		renderer: rendererName,
		n: ORTHO_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
