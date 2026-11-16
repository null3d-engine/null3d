// three.js's CSS3D orthographic example (examples/css3d_orthographic.html, r186) drawn twice on one
// page: by null3D, with each plane a world label beside the wireframe plane that draws its outline,
// and by three.js's CSS3DRenderer from the same data and orthographic camera. A picture test
// compares the two stages' elements, and the page reports the pixels that the engine drew.
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { css3dTwin, runPort, twinOrthographic } from './lib/css3d-example';
import { CAMERA, PLATES, plateElement } from './lib/css3d-orthographic';

runPort({
	name: 'css3d-orthographic',
	sketch: new URL('./sketches/css3d-orthographic-sketch.ts', import.meta.url),
	// The scene holds still, so any time shows it.
	hold: 0,
	maxLabels3d: PLATES.length,
	webgl: true,
	markup(layer, bind) {
		return PLATES.map((plate, index) => {
			const element = plateElement(plate);
			layer.append(element);
			bind(`plate-${index}`, element);
			return element;
		});
	},
	twin(layer) {
		const camera = twinOrthographic(CAMERA.frustum, CAMERA.position, [0, 0, 0], CAMERA);
		const { renderer, scene } = css3dTwin(layer, camera);
		const elements = PLATES.map((plate) => {
			const element = plateElement(plate);
			const object = new CSS3DObject(element);
			object.position.set(...plate.position);
			object.quaternion.fromArray([...plate.rotation]);
			scene.add(object);
			return element;
		});
		renderer.render(scene, camera);
		return { elements };
	},
});
