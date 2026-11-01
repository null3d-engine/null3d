// The null3D side of three.js's CSS3D periodic table example (examples/css3d_periodictable.html,
// r186). The sketch holds the table layout only: one object for each element, and a label that is a
// plane of the scene, which the page binds to the cell's HTML. The camera and the layout come from
// the data that the three.js twin uses too, so a picture of the two stages compares one scene.
import { defineSketch } from '@null3d/engine';
import { CAMERA, cellPosition, ELEMENTS } from '../lib/css3d-periodictable';

export default defineSketch(({ scene, ui }) => {
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: [0, 0, CAMERA.distance],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	// Each cell is an HTML element sized in CSS pixels, which are the scene's units, so a label at
	// its place in the table draws it at the example's size.
	ELEMENTS.forEach((_cell, index) => {
		const object = scene.createGroup({ position: cellPosition(index) });
		ui.trackLabel(object, `cell-${index}`, { transform: 'world' });
	});
	return {};
});
