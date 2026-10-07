// The decoders that load on first use, together, for the on-demand loader's tests: a glTF file with
// meshopt compression and eight KTX2 files, all at once, so the KTX2 transcoder runs in several job
// workers at the same time. The sketch posts the model's bounds and the textures' formats as
// `result`. The files' addresses come from the sketch module's own, so a production build ships
// them, and a page that loads the engine from another origin takes them from there.
import { defineSketch } from '@null3d/engine';

const MODEL = new URL('../assets/models/simple-instancing-meshopt.glb', import.meta.url);
const TEXTURES = [
	new URL('../assets/textures/quarters-etc1s.ktx2', import.meta.url),
	new URL('../assets/textures/quarters-uastc.ktx2', import.meta.url),
	new URL('../assets/textures/ramp-uastc.ktx2', import.meta.url),
];

export default defineSketch(async ({ scene, assets, page }) => {
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 2, 8], target: [0, 0, 0] }));
	const [model, ...textures] = await Promise.all([
		assets.loadGltf(MODEL),
		...Array.from({ length: 8 }, (_, k) =>
			assets.loadTexture(TEXTURES[k % TEXTURES.length] as URL, {
				wrap: k < 3 ? 'clamp' : 'repeat',
			}),
		),
	]);
	scene.instantiate(model);
	page.post('result', {
		bounds: [...model.bounds.min, ...model.bounds.max].map((v) => Math.round(v * 1000) / 1000),
		formats: textures.map((texture) => texture.format),
	});
	return {};
});
