// The texture background's scene (bench/scenes/texture-background.ts), which the parity test also
// draws with three.js. The picture loads as three.js's TextureLoader loads it, and fills the wide
// view behind a lit box and an unlit box. The color set first shows only until the picture is on
// the GPU. The three.js twin draws with no tone mapping, three.js's default, so the sketch turns
// off the engine's default of AgX.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND_BOXES,
	BACKGROUND_CAMERA,
	BACKGROUND_PICTURE,
	SUN,
} from '../../../bench/scenes/texture-background';
import { pictureUrl } from '../lib/picture';

export default defineSketch(async ({ scene, materials, geometry, assets, post }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground('#20242a');
	const { fov, near, far, position, target } = BACKGROUND_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });

	const url = await pictureUrl(BACKGROUND_PICTURE);
	scene.setBackground(await assets.loadTexture(url));
	URL.revokeObjectURL(url);
	for (const { size, position: at, color, lit } of BACKGROUND_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: lit ? materials.standard({ color }) : materials.unlit({ color }),
			position: at,
		});
	}
});
