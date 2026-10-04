// A glTF sample model (bench/scenes/gltf-models.ts), which the parity test also draws with
// three.js's GLTFLoader. `?model=` names the scene. The sketch loads the model with
// assets.loadGltf, creates one copy of it, plays the scene's clip, and frames the copy from the
// prefab's bounds or the scene's frame. Each engine draws without tone mapping, so the parity test
// compares the colors themselves.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	DIM_AMBIENT,
	MODEL_SCENES,
	MODELS_BACKGROUND,
	MODELS_FOV,
	type ModelName,
	type ModelScene,
	modelCamera,
	modelUrl,
	SUN,
} from '../../../bench/scenes/gltf-models';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async ({ scene, assets, post }) => {
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
	const prefab = await assets.loadGltf(modelUrl(model));
	const copy = scene.instantiate(prefab);
	if (model.clip) copy.animator().play(model.clip.name);
	const { center, radius } = model.frame ?? prefab.bounds;
	const { position, target, near, far } = modelCamera(center, radius, model.view);
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: MODELS_FOV, near, far, position, target }),
	);
	return {};
});
