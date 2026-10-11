// A KTX2 texture as the scene background, behind a lit box and an unlit box. The file holds the
// KTX2 test's picture of four quarters in ETC1S (ktx2-sketch.ts): red at the top left, green at
// the top right, blue at the bottom left and white at the bottom right. It must fill the view
// upright, as a PNG background does, in whichever format the transcoder gives the device. The
// color set first shows only until the texture is on the GPU. The background shows its texels as
// the file holds them, so the sketch turns off the tone mapping.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND_BOXES,
	BACKGROUND_CAMERA,
	SUN,
} from '../../../bench/scenes/texture-background';

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

	scene.setBackground(await assets.loadTexture('assets/textures/quarters-etc1s.ktx2'));
	for (const { size, position: at, color, lit } of BACKGROUND_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: lit ? materials.standard({ color }) : materials.unlit({ color }),
			position: at,
		});
	}
});
