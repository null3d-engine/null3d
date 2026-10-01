// The three.js twin of the texture background's scene (bench/scenes/texture-background.ts), which
// null3D's image tests draw. It loads the picture with TextureLoader, makes it the scene's
// background, draws the scene once into an offscreen target of the image's size, and publishes the
// pixels as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and `?renderer=webgpu`
// with WebGPURenderer.
import { pictureUrl } from '../../../tests/pages/lib/picture';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	BACKGROUND_BOXES,
	BACKGROUND_CAMERA,
	BACKGROUND_IMAGE,
	BACKGROUND_PICTURE,
} from '../../scenes/texture-background';
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

	const url = await pictureUrl(BACKGROUND_PICTURE);
	const picture = await new three.TextureLoader().loadAsync(url);
	URL.revokeObjectURL(url);
	picture.colorSpace = three.SRGBColorSpace;
	scene.background = picture;

	for (const { size, position, color, lit } of BACKGROUND_BOXES) {
		const material = lit
			? new three.MeshStandardMaterial({ color })
			: new three.MeshBasicMaterial({ color });
		const box = new three.Mesh(new three.BoxGeometry(...size), material);
		box.position.set(...position);
		scene.add(box);
	}

	const { width, height } = BACKGROUND_IMAGE;
	const { fov, near, far, position, target } = BACKGROUND_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'texture-background',
		renderer: rendererName,
		n: BACKGROUND_BOXES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
