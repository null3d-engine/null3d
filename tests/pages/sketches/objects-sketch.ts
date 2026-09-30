// The object calls in one scene: turns about an object's own axes, a move along them, a hand that
// moves under a turned and scaled arm and keeps its place, then swings with the arm, and bounds
// that culling tests. The sketch also checks what the world getters and scene.find return, and
// throws when one is wrong, which stops hold mode and fails the image test.
import { defineSketch, mat4, quat, vec3 } from '@null3d/engine';

/** The frame whose update moves the hand under the arm. */
const REPARENT_FRAME = 3;
/** When the arm starts to turn, in seconds: after the check that the hand kept its place. */
const TURN_START = 0.5;
/** How fast the arm turns, in radians per second. */
const TURN_SPEED = 1.2;

export default defineSketch(({ scene, materials, geometry, time }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		position: [0, 3, 9],
		target: [0, 0.5, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	const box = geometry.box();
	const red = materials.standard({ color: '#e8554e' });
	const blue = materials.standard({ color: '#4a8cff' });
	const green = materials.standard({ color: '#5bc27a' });
	const yellow = materials.standard({ color: '#f2c14e' });

	// Turned about its own X axis, then about its new Y axis.
	const turned = scene.createMesh({ mesh: box, material: red, position: [-4, 0.5, 0] });
	turned.rotateX(0.6);
	turned.rotateY(0.5);
	// A quarter turn about Z points the box's X axis up, so a move along X lifts it by 1.5 m.
	const lifted = scene.createMesh({ mesh: box, material: green, position: [-2, -1, 0] });
	lifted.rotateZ(Math.PI / 2);
	lifted.translate(1.5, 0, 0);

	// A turned and scaled arm with a small box at its origin, and a hand beside it, as a root.
	const arm = scene.createGroup({ name: 'arm', position: [1, 0, 0], scale: [1.5, 1.5, 1.5] });
	arm.setRotationEuler(0, 0.4, 0);
	scene.createMesh({ mesh: box, material: yellow, parent: arm, scale: [0.4, 0.4, 0.4] });
	const hand = scene.createMesh({
		name: 'hand',
		mesh: box,
		material: blue,
		position: [1, 1.8, 0],
		scale: [0.5, 0.5, 0.5],
	});

	// Bounds 40 m above a box are out of view, so culling drops the box. The box above it has the
	// same bounds but is never culled, so it draws.
	const dropped = scene.createMesh({ mesh: box, material: red, position: [4, 0, 0] });
	dropped.setBounds([0, 40, 0], 0.5);
	const kept = scene.createMesh({ mesh: box, material: yellow, position: [4, 1.5, 0] });
	kept.setBounds([0, 40, 0], 0.5);
	kept.setFrustumCulled(false);

	if (scene.find('arm') !== arm || scene.find('hand') !== hand || scene.find('foot'))
		throw new Error('scene.find returned the wrong object');

	const before = mat4.create();
	const after = mat4.create();
	const rotation = quat.create();
	const split = quat.create();
	const position = vec3.create();
	const scale = vec3.create();
	const where = vec3.create();

	/** Throws when the hand moved, or when its world getters disagree with its world matrix. */
	function checkHand(): void {
		hand.getWorldMatrix(after);
		for (let k = 0; k < 16; k++) {
			const moved = Math.abs((after[k] as number) - (before[k] as number));
			if (moved > 1e-5) throw new Error(`keepWorld moved the hand: matrix element ${k}`);
		}
		mat4.decompose(position, split, scale, after);
		hand.getWorldQuaternion(rotation);
		hand.getWorldPosition(where);
		if (Math.abs(quat.dot(rotation, split)) < 1 - 1e-6 || vec3.distance(where, position) > 1e-9)
			throw new Error('the world getters disagree with the world matrix');
	}

	return {
		onUpdate() {
			if (time.frame === REPARENT_FRAME) {
				hand.getWorldMatrix(before);
				hand.setParent(arm, { keepWorld: true });
			}
			// The frame after the change shows it, and the arm has not turned yet.
			if (time.frame === REPARENT_FRAME + 2) checkHand();
			if (time.now > TURN_START) arm.setRotationEuler(0, 0.4, (time.now - TURN_START) * TURN_SPEED);
		},
	};
});
