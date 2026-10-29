// three.js's CSS3D mixed example (examples/css3d_mixed.html, r186) drawn twice on one page: by
// null3D, with the embedded page as a world label under the see-through canvas that draws the room
// and the frame around it, and by three.js's CSS3DRenderer and WebGLRenderer from the same data.
// The layers keep the example's order, so the canvas covers the page where the frame reaches in
// front of it, and the invisible depth-only plane shows the page where the canvas draws nothing. A
// picture test compares the two layers of elements, and the two drawn frames as each engine reads
// them.
import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { css3dTwin, runPort, twinCamera, webglTwin } from './lib/css3d-example';
import { CAMERA, embeddedElement, FRAME, LIGHT_POSITION, roomEdges } from './lib/css3d-mixed';

/** The room's edges as three.js's `LineSegments`, from the port's twelve edges. */
function roomLines(): THREE.LineSegments {
	const positions = roomEdges();
	const points: THREE.Vector3[] = [];
	for (let k = 0; k < positions.length; k += 3)
		points.push(
			new THREE.Vector3(
				positions[k] as number,
				positions[k + 1] as number,
				positions[k + 2] as number,
			),
		);
	const geometry = new THREE.BufferGeometry().setFromPoints(points);
	const material = new THREE.LineBasicMaterial({
		color: 0x000000,
		opacity: 0.2,
		transparent: true,
	});
	return new THREE.LineSegments(geometry, material);
}

/** The example's cut-out: a plane at the page's plane that writes depth and no color. */
function cutout(): THREE.Mesh {
	return new THREE.Mesh(
		new THREE.PlaneGeometry(FRAME.width, FRAME.height),
		new THREE.MeshBasicMaterial({
			color: 0xff0000,
			blending: THREE.NoBlending,
			opacity: 0,
			premultipliedAlpha: true,
		}),
	);
}

/** The example's frame: an extruded border and its back plane, as its own `buildFrame` makes them. */
function frame(): THREE.Group {
	const { width, height, thickness } = FRAME;
	const group = new THREE.Group();
	const material = new THREE.MeshStandardMaterial({ color: 0x2200ff });
	const outer = new THREE.Shape();
	outer.moveTo(-(width / 2 + thickness), -(height / 2 + thickness));
	outer.lineTo(width / 2 + thickness, -(height / 2 + thickness));
	outer.lineTo(width / 2 + thickness, height / 2 + thickness);
	outer.lineTo(-(width / 2 + thickness), height / 2 + thickness);
	outer.lineTo(-(width / 2 + thickness), -(height / 2 + thickness));
	const hole = new THREE.Path();
	hole.moveTo(-width / 2, -height / 2);
	hole.lineTo(width / 2, -height / 2);
	hole.lineTo(width / 2, height / 2);
	hole.lineTo(-width / 2, height / 2);
	hole.lineTo(-width / 2, -height / 2);
	outer.holes.push(hole);
	const border = new THREE.Mesh(
		new THREE.ExtrudeGeometry(outer, { depth: thickness, bevelEnabled: false }),
		material,
	);
	border.position.z = -thickness / 2;
	group.add(border);
	const back = new THREE.Mesh(
		new THREE.PlaneGeometry(width + thickness * 2, height + thickness * 2),
		material,
	);
	back.position.set(0, 0, -thickness / 2);
	back.rotation.y = Math.PI;
	group.add(back);
	return group;
}

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
		// The example's scene, in the order that it adds its objects: its room, light, cut-out and
		// frame, then the page. The frame comes from the example's own extrude, so a wrong bar in
		// the port reaches the comparison. The stage's own background stands in for the example's
		// scene color, so both engines' frames stay transparent where they draw nothing.
		scene.add(roomLines());
		const light = new THREE.HemisphereLight(0xffffff, 0x444444, 4);
		light.position.set(...LIGHT_POSITION);
		scene.add(light);
		scene.add(cutout());
		scene.add(frame());
		const element = embeddedElement();
		scene.add(new CSS3DObject(element));
		renderer.render(scene, camera);
		const pixels = webglTwin(layer, camera, scene);
		return { elements: [element], frame: pixels };
	},
});
