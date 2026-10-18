// A glTF sample model (bench/scenes/gltf-models.ts), which the parity test also draws with
// three.js's GLTFLoader. `?model=` names the scene. The sketch loads the model with
// assets.loadGltf, creates one copy of it, plays the scene's clip, and frames the copy from the
// prefab's bounds or the scene's frame. Each engine draws without tone mapping, so the parity test
// compares the colors themselves. ?mark posts 'instantiate' to the page right before the sketch
// creates the copy, and ?pause=<ms> waits that long after the file loads, as a model's texture
// decode would. A scene with the environment loads the HDR file's environment first.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	DIM_AMBIENT,
	MODEL_SCENES,
	MODELS_BACKGROUND,
	MODELS_FOV,
	MODELS_HDR,
	type ModelName,
	type ModelScene,
	modelCamera,
	modelUrl,
	SUN,
} from '../../../bench/scenes/gltf-models';
import { sampleEnvironment } from '../../../tools/lib/sample-url';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async ({ scene, assets, post, page }) => {
	const name = (params.get('model') ?? 'metal-rough') as ModelName;
	const model: ModelScene | undefined = MODEL_SCENES[name];
	if (!model) throw new Error(`no model scene is named ${name}`);
	post.set({ toneMapping: 'none' });
	scene.setBackground(MODELS_BACKGROUND);
	if (model.ownLights) scene.createAmbientLight(DIM_AMBIENT);
	else {
		scene.createDirectionalLight(SUN);
		scene.createAmbientLight(AMBIENT);
	}
	if (model.environment)
		scene.setEnvironment(await assets.loadEnvironment(sampleEnvironment(MODELS_HDR)));
	const prefab = await assets.loadGltf(modelUrl(model));
	const pause = Number(params.get('pause') ?? 0);
	if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
	if (params.has('mark')) page.post('instantiate', null);
	const copy = scene.instantiate(prefab);
	if (model.clip) copy.animator().play(model.clip.name);
	const { center, radius } = model.frame ?? prefab.bounds;
	const { position, target, near, far } = modelCamera(center, radius, model.view);
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: MODELS_FOV, near, far, position, target }),
	);
	return {};
});
