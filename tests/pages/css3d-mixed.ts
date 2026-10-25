// three.js's CSS3D mixed example (examples/css3d_mixed.html, r186) drawn twice on one page: by
// null3D, with the embedded page as a world label under the see-through canvas that draws the room
// and the frame around it, and by three.js's CSS3DRenderer from the same data. The layers keep the
// example's order, so the frame's border covers the page where the two overlap. A picture test
// compares the two stages' elements, and the page reports the pixels that the engine drew.
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { css3dTwin, runPort, twinCamera } from './lib/css3d-example';
import { CAMERA, embeddedElement } from './lib/css3d-mixed';

runPort({
	name: 'css3d-mixed',
	sketch: new URL('./sketches/css3d-mixed-sketch.ts', import.meta.url),
	// The scene holds still, so any time shows it.
	hold: 0,
	maxLabels3d: 1,
	webgl: true,
	labelsBelow: true,
	markup(layer, bind) {
		const element = embeddedElement();
		layer.append(element);
		bind('screen', element);
		return [element];
	},
	twin(layer) {
		const camera = twinCamera(CAMERA.position, [0, 0, 0], CAMERA);
		const { renderer, scene } = css3dTwin(layer, camera);
		const element = embeddedElement();
		scene.add(new CSS3DObject(element));
		renderer.render(scene, camera);
		return [element];
	},
});
