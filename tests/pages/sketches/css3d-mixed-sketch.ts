// The null3D side of three.js's CSS3D mixed example (examples/css3d_mixed.html, r186): a wireframe
// room, a blue frame drawn by WebGL, and the embedded page as a world label in the frame's opening,
// so the DOM and the drawn scene share one camera. The line batch draws the room's edges, as the
// example draws them with LineSegments.
import { defineSketch, quat } from '@null3d/engine';
import { BARS, CAMERA, FRAME, roomEdges } from '../lib/css3d-mixed';

export default defineSketch(async ({ scene, geometry, materials, ui }) => {
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: CAMERA.position,
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	// The example lights the frame with a hemisphere light, which gives its bars their shading.
	scene.createHemisphereLight({ skyColor: '#ffffff', groundColor: '#444444', intensity: 4 });
	await scene.createLines({
		positions: roomEdges(),
		mode: 'segments',
		width: 1,
		color: '#000000',
		opacity: 0.2,
		alphaMode: 'blend',
	});
	const blue = materials.standard({ color: '#2200ff' });
	const box = geometry.box();
	for (const bar of BARS) {
		scene.createMesh({ mesh: box, material: blue, position: bar.position, scale: bar.scale });
	}
	// The example's back plane, which faces away from the opening.
	scene.createMesh({
		mesh: geometry.plane({
			width: FRAME.width + FRAME.thickness * 2,
			height: FRAME.height + FRAME.thickness * 2,
		}),
		material: blue,
		position: [0, 0, -FRAME.thickness / 2],
		rotation: quat.fromEuler(quat.create(), 0, Math.PI, 0),
	});
	// The embedded page sits over the opening, in the room's own units.
	const screen = scene.createGroup();
	ui.trackLabel(screen, 'screen', { transform: 'world' });
	return {};
});
