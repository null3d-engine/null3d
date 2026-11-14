// three.js's CSS3D sprites example (examples/css3d_sprites.html, r186) drawn twice on one page: by
// null3D, with each sprite as a billboard label, and by three.js's CSS3DRenderer from the same data
// and timeline. A picture test compares the two stages' elements.
//
// three.js's CSS3DRenderer draws an element that sits behind the camera anyway, mirrored and
// enlarged, while the engine hides it, as D-208 rules. The twin hides the same sprites, so the
// comparison reads the sprites that a viewpoint can see.
import { CSS3DSprite } from 'three/addons/renderers/CSS3DRenderer.js';
import { css3dTwin, runPort, twinCamera } from './lib/css3d-example';
import { CAMERA, SPRITES, spriteImage, spritePosition, spriteScale } from './lib/css3d-sprites';

runPort({
	name: 'css3d-sprites',
	sketch: new URL('./sketches/css3d-sprites-sketch.ts', import.meta.url),
	// The sprites stand three seconds into their first move, some of them still on their way.
	hold: 3,
	maxLabels3d: SPRITES,
	markup(layer, bind) {
		const elements: HTMLElement[] = [];
		for (let index = 0; index < SPRITES; index++) {
			const element = spriteImage();
			layer.append(element);
			bind(`sprite-${index}`, element);
			elements.push(element);
		}
		return elements;
	},
	twin(layer, time) {
		const camera = twinCamera(CAMERA.position, [0, 0, 0], CAMERA);
		const { renderer, scene } = css3dTwin(layer, camera);
		const near = camera.near;
		const far = camera.far;
		const elements: HTMLElement[] = [];
		for (let index = 0; index < SPRITES; index++) {
			const element = spriteImage();
			const sprite = new CSS3DSprite(element);
			const position = spritePosition(index, time);
			sprite.position.set(position[0], position[1], position[2]);
			const scale = spriteScale(position, time);
			sprite.scale.set(scale, scale, scale);
			// The engine hides a label whose anchor is not between the camera's near and far planes.
			const inView = camera.matrixWorldInverse.elements;
			const depth = -(
				inView[2] * sprite.position.x +
				inView[6] * sprite.position.y +
				inView[10] * sprite.position.z +
				inView[14]
			);
			sprite.visible = depth >= near && depth <= far;
			scene.add(sprite);
			elements.push(element);
		}
		renderer.render(scene, camera);
		return { elements };
	},
});
