// The asset tool's test scene (tests/lib/asset-scene.ts), as the source file or as the tool's
// output with its defaults, which `?file=optimized` picks: its meshes quantized and its textures in
// KTX2. Both draw from the same camera, so the image test compares the output with the source's
// references.
import { defineSketch } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

const FILES = {
	source: 'assets/models/asset-scene.glb',
	optimized: 'assets/models/optimized/asset-scene.glb',
} as const;

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async ({ scene, assets, post }) => {
	const name = (params.get('file') ?? 'source') as keyof typeof FILES;
	const url = FILES[name];
	if (!url) throw new Error(`no asset scene file is named ${name}`);
	post.set({ toneMapping: 'none' });
	scene.setBackground('#60666e');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	scene.instantiate(await assets.loadGltf(url));
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.5,
			far: 30,
			position: [4.5, 4.5, 7],
			target: [0, 0.9, 0],
		}),
	);
	return {};
});
