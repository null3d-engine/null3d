// The null3D side of three.js's CSS3D sprites example (examples/css3d_sprites.html, r186): every
// sprite is a billboard label on an object whose place and scale follow the example's own timeline.
// The places come from the shared data, so three.js's twin draws the same frame.
import { defineSketch } from '@null3d/engine';
import { CAMERA, SPRITES, spritePosition, spriteScale } from '../lib/css3d-sprites';

export default defineSketch(({ scene, ui, time }) => {
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: CAMERA.position,
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const sprites = Array.from({ length: SPRITES }, (_unused, index) => {
		const object = scene.createGroup({ dynamic: true });
		ui.trackLabel(object, `sprite-${index}`, { transform: 'billboard' });
		return object;
	});
	return {
		onUpdate() {
			for (let index = 0; index < SPRITES; index++) {
				const position = spritePosition(index, time.now);
				const scale = spriteScale(position, time.now);
				const object = sprites[index];
				if (object === undefined) continue;
				object.setPosition(position[0], position[1], position[2]);
				object.setScale(scale, scale, scale);
			}
		},
	};
});
