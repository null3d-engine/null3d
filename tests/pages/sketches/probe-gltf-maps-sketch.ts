// A probe of one model's map handoff, for the image test that watches it: the interpolation model
// is the one whose two maps a Safari hands over empty. It frames the model as gltf-sketch does, so
// its picture is the test's picture, and posts the upload queue and the textures' layers in every
// frame, so the run's result carries the facts the picture alone cannot show: whether the maps were
// on the GPU when the frame was captured, or whether their pixels arrived late or not at all.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	DIM_AMBIENT,
	MODEL_SCENES,
	MODELS_BACKGROUND,
	MODELS_FOV,
	MODELS_HDR,
	type ModelScene,
	modelCamera,
	modelUrl,
	SUN,
} from '../../../bench/scenes/gltf-models';
import { sampleEnvironment } from '../../../tools/lib/sample-url';

/** The scene that the probe draws, from the models that the image test frames. */
const NAME = 'texture-linear-interpolation';

export default defineSketch(async ({ assets, textures, scene, post, page }) => {
	const model: ModelScene | undefined = MODEL_SCENES[NAME];
	if (!model) throw new Error(`no model scene is named ${NAME}`);
	post.set({ toneMapping: 'none' });
	scene.setBackground(MODELS_BACKGROUND);
	if (model.ownLights || model.ambientOnly) scene.createAmbientLight(DIM_AMBIENT);
	else {
		scene.createDirectionalLight(SUN);
		scene.createAmbientLight(AMBIENT);
	}
	if (model.environment) {
		scene.setEnvironment(
			await assets.loadEnvironment(sampleEnvironment(model.environmentHdr ?? MODELS_HDR)),
			{ intensity: model.environmentIntensity ?? 1 },
		);
	}
	const prefab = await assets.loadGltf(modelUrl(model));
	scene.instantiate(prefab);
	const { center, radius } = model.frame ?? prefab.bounds;
	const { position, target, near, far } = modelCamera(center, radius, model.view);
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: MODELS_FOV, near, far, position, target }),
	);
	/** What the frame shows of the maps' way to the GPU. */
	const facts = (frame: number) => {
		const { waiting, lastFrameBytes, largestFrameBytes } = textures.uploads();
		return {
			frame,
			waiting,
			lastFrameBytes,
			largestFrameBytes,
			memory: textures.memoryBytes,
			layers: prefab.textures.map((texture) => texture.layer),
		};
	};
	page.post('probe', facts(0));
	let frame = 0;
	return {
		onUpdate() {
			frame++;
			page.post('probe', facts(frame));
		},
	};
});
