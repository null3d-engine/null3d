// The null3D side of three.js's CSS3D mixed example (examples/css3d_mixed.html, r186): a wireframe
// room, a blue frame drawn by WebGL, and the embedded page as a world label in the frame's opening,
// so the DOM and the drawn scene share one camera. The line batch draws the room's edges, as the
// example draws them with LineSegments, and the invisible plane at the page's plane holds back what
// lies behind the page, as the example's plane that writes depth alone does.
import { defineSketch, quat } from '@null3d/engine';
import { BARS, CAMERA, FRAME, LIGHT_DIRECTION, roomEdges } from '../lib/css3d-mixed';

export default defineSketch(async ({ scene, geometry, materials, post, ui }) => {
	// The example's NeutralToneMapping, which the engine's neutral curve matches.
	post.set({ toneMapping: 'neutral' });
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: CAMERA.position,
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	// The example lights the frame with a hemisphere light, which gives its bars their shading.
	// Its sky looks along the light's position, which is not straight up.
	scene.createHemisphereLight({
		skyColor: '#ffffff',
		groundColor: '#444444',
		intensity: 4,
		rotation: quat.rotationTo(quat.create(), [0, 1, 0], LIGHT_DIRECTION),
	});
	await scene.createLines({
		positions: roomEdges(),
		mode: 'segments',
		width: 1,
		color: '#000000',
		opacity: 0.2,
		alphaMode: 'blend',
	});
	// The example's cut-out: a plane at the page's own plane that writes depth and no color, so the
	// frame's faces and the room's edges behind the page stay hidden and the page shows clean.
	scene.createMesh({
		mesh: geometry.plane({ width: FRAME.width, height: FRAME.height }),
		material: materials.unlit({ colorWrite: false }),
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
