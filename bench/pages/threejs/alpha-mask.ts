// The three.js twin of the masked materials' scene (bench/scenes/alpha-mask.ts), which null3D's
// image tests draw. Each masked material is a three.js material with `alphaTest` and vertex colors
// with alpha. It draws the scene once into an offscreen target of the image's size, and publishes
// the pixels as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and
// `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	cardMesh,
	MASK_BOXES,
	MASK_CAMERA,
	MASK_CARDS,
	MASK_COUNT,
	MASK_IMAGE,
	MASK_TILE,
	turnAboutX,
} from '../../scenes/alpha-mask';
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

	for (const { size, position, color } of MASK_BOXES) {
		const box = new three.Mesh(
			new three.BoxGeometry(...size),
			new three.MeshStandardMaterial({ color }),
		);
		box.position.set(...position);
		scene.add(box);
	}

	const { positions, normals, colors, indices } = cardMesh();
	const card = new three.BufferGeometry();
	card.setAttribute('position', new three.BufferAttribute(positions, 3));
	card.setAttribute('normal', new three.BufferAttribute(normals, 3));
	card.setAttribute('color', new three.BufferAttribute(colors, 4));
	card.setIndex(new three.BufferAttribute(indices, 1));
	for (const { lit, cutoff, position, rotation } of MASK_CARDS) {
		const options = { vertexColors: true, alphaTest: cutoff };
		const material = lit
			? new three.MeshStandardMaterial(options)
			: new three.MeshBasicMaterial(options);
		const mesh = new three.Mesh(card, material);
		mesh.position.set(...position);
		mesh.rotation.set(...rotation);
		scene.add(mesh);
	}

	const tiles = new three.InstancedMesh(
		card,
		new three.MeshStandardMaterial({ vertexColors: true, alphaTest: MASK_TILE.cutoff }),
		MASK_TILE.positions.length,
	);
	const matrix = new three.Matrix4();
	const turn = new three.Quaternion(...turnAboutX(MASK_TILE.tilt));
	const scale = new three.Vector3(MASK_TILE.scale, MASK_TILE.scale, MASK_TILE.scale);
	const at = new three.Vector3();
	for (const [k, [x, y, z]] of MASK_TILE.positions.entries())
		tiles.setMatrixAt(k, matrix.compose(at.set(x, y, z), turn, scale));
	scene.add(tiles);

	const { width, height } = MASK_IMAGE;
	const { fov, near, far, position, target } = MASK_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'alpha-mask',
		renderer: rendererName,
		n: MASK_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
