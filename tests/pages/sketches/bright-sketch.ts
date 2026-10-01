// The bright scene of the tone mapping tests (tests/pages/lib/bright-scene.ts), under the tone
// mapping and the exposure in stops that the module's address names, such as ?tone=agx&stops=-1.
// With ?background=none it sets no background, for the transparent canvas test.
import { defineSketch, type ToneMapping } from '@null3d/engine';
import { BACKGROUND, CAMERA, exposureOf, SUN, tiles } from '../lib/bright-scene';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(({ scene, materials, geometry, post }) => {
	post.set({
		toneMapping: (params.get('tone') ?? 'aces') as ToneMapping,
		exposure: exposureOf(Number(params.get('stops') ?? '0')),
	});
	if (params.get('background') !== 'none') scene.setBackground(BACKGROUND);
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: [...CAMERA.position],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [...SUN.direction], intensity: SUN.intensity });
	const [first] = tiles();
	if (!first) throw new Error('the bright scene has no tiles');
	const [width, height, depth] = first.size;
	const box = geometry.box({ width, height, depth });
	for (const tile of tiles())
		scene.createMesh({
			mesh: box,
			material: materials.standard({ color: tile.color }),
			position: tile.position,
		});
	return {};
});
