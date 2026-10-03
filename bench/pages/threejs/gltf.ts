// The three.js twin of the glTF model scenes (bench/scenes/gltf-models.ts), which null3D's image
// tests draw. `?model=` names the scene. It loads the model with GLTFLoader, and its KTX2 textures
// with KTX2Loader, frames it from its bounds as the null3D sketch does, draws one frame into an
// offscreen target of the image's size, and publishes the pixels as the hold pages do.
// `?renderer=webgl` draws with WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	AMBIENT,
	DIM_AMBIENT,
	MODEL_SCENES,
	MODELS_BACKGROUND,
	MODELS_FOV,
	MODELS_IMAGE,
	type ModelName,
	type ModelScene,
	modelCamera,
	SUN,
} from '../../scenes/gltf-models';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const name = (params.get('model') ?? 'metal-rough') as ModelName;
	const model: ModelScene | undefined = MODEL_SCENES[name];
	if (!model) throw new Error(`no model scene is named ${name}`);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	if (model.ownLights) {
		scene.background = new three.Color(MODELS_BACKGROUND);
		scene.add(new three.AmbientLight(DIM_AMBIENT.color, DIM_AMBIENT.intensity));
	} else lightScene(three, scene, { sun: SUN, ambient: AMBIENT }, MODELS_BACKGROUND);

	// KTX2Loader finds the transcoder that three.js ships beside it, which the build copies.
	const ktx2 = new KTX2Loader();
	if (rendererName === 'webgpu') await ktx2.detectSupportAsync(renderer as never);
	else ktx2.detectSupport(renderer as never);
	const loader = new GLTFLoader().setKTX2Loader(ktx2);
	const gltf = await loader.loadAsync(model.url);
	scene.add(gltf.scene);
	gltf.scene.updateMatrixWorld(true);
	const box = new three.Box3().setFromObject(gltf.scene);
	const center = box.getCenter(new three.Vector3());
	const radius = box.getSize(new three.Vector3()).length() / 2;
	const view = modelCamera([center.x, center.y, center.z], radius, model.view);

	const { width, height } = MODELS_IMAGE;
	const camera = new three.PerspectiveCamera(MODELS_FOV, width / height, view.near, view.far);
	camera.position.set(...view.position);
	camera.lookAt(...view.target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	ktx2.dispose();
	return {
		scene: `gltf-${name}`,
		renderer: rendererName,
		n: 1,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
