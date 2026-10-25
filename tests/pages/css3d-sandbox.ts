// three.js's CSS3D sandbox example (examples/css3d_sandbox.html, r186) drawn twice on one page: by
// null3D, with each square a world label beside the wireframe plane that draws its outline, and by
// three.js's CSS3DRenderer from the same data. A picture test compares the two stages' elements, and
// the page reports the pixels that the engine drew, so the wireframe half shows too.
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { css3dTwin, runPort, twinCamera } from './lib/css3d-example';
import { CAMERA, SQUARES_LAYOUT, squareElement } from './lib/css3d-sandbox';

runPort({
	name: 'css3d-sandbox',
	sketch: new URL('./sketches/css3d-sandbox-sketch.ts', import.meta.url),
	// The scene holds still, so any time shows it.
	hold: 0,
	maxLabels3d: SQUARES_LAYOUT.length,
	webgl: true,
	markup(layer, bind) {
		return SQUARES_LAYOUT.map((square, index) => {
			const element = squareElement(square);
			layer.append(element);
			bind(`square-${index}`, element);
			return element;
		});
	},
	twin(layer) {
		const camera = twinCamera(CAMERA.position, [0, 0, 0], CAMERA);
		const { renderer, scene } = css3dTwin(layer, camera);
		const elements = SQUARES_LAYOUT.map((square) => {
			const element = squareElement(square);
			const object = new CSS3DObject(element);
			object.position.set(...square.position);
			object.quaternion.fromArray([...square.rotation]);
			object.scale.set(...square.scale);
			scene.add(object);
			return element;
		});
		renderer.render(scene, camera);
		return { elements };
	},
});
