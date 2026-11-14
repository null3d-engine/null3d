// three.js's CSS3D youtube example (examples/css3d_youtube.html, r186) drawn twice on one page: by
// null3D, with each embedded page as a world label turned out of the ring, and by three.js's
// CSS3DRenderer from the same data. A picture test compares the two stages' elements. The example
// blocks the pointer to its iframes while the camera drags; this port has no controls, so the
// iframes keep the pointer.
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { css3dTwin, runPort, twinCamera } from './lib/css3d-example';
import { CAMERA, SCREENS, screenElement } from './lib/css3d-youtube';

runPort({
	name: 'css3d-youtube',
	sketch: new URL('./sketches/css3d-youtube-sketch.ts', import.meta.url),
	// The scene holds still, so any time shows it.
	hold: 0,
	maxLabels3d: SCREENS.length,
	markup(layer, bind) {
		return SCREENS.map((_screen, index) => {
			const element = screenElement(index);
			layer.append(element);
			bind(`screen-${index}`, element);
			return element;
		});
	},
	twin(layer) {
		const camera = twinCamera(CAMERA.position, [0, 0, 0], CAMERA);
		const { renderer, scene } = css3dTwin(layer, camera);
		const elements = SCREENS.map((screen, index) => {
			const element = screenElement(index);
			const object = new CSS3DObject(element);
			object.position.set(...screen.position);
			object.rotation.y = screen.turn;
			scene.add(object);
			return element;
		});
		renderer.render(scene, camera);
		return { elements };
	},
});
