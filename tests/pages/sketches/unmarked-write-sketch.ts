// A sketch whose update writes the position of a static object named Crate straight into engine
// memory, skipping the setter, once the sketch time reaches half a second. Development builds report
// such a write, so hold mode's test sees the hold stop in that frame, with the object's name. Until
// then, every frame turns a static door with its setter, moves a dynamic ball through engine memory,
// and moves a static sign with its setter in the late update, which the check must all accept. The
// late update also gives a static post new bounds, and a static flag a mesh of another size in turn,
// whose queued changes mark each object in the next frame: the check must accept those too.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry, time }) => {
	const mesh = geometry.box();
	const larger = geometry.sphere({ radius: 3 });
	const material = materials.unlit({ color: '#ffffff' });
	const crate = scene.createMesh({ name: 'Crate', mesh, material });
	const door = scene.createMesh({ name: 'Door', mesh, material });
	const ball = scene.createMesh({ name: 'Ball', mesh, material, dynamic: true });
	const sign = scene.createMesh({ name: 'Sign', mesh, material });
	const post = scene.createMesh({ name: 'Post', mesh, material });
	const flag = scene.createMesh({ name: 'Flag', mesh, material });
	return {
		onUpdate() {
			// The scene's arrays are internal: no public call writes one object's values directly.
			const { positions } = scene.views;
			door.setRotationEuler(0, time.now, 0);
			positions[ball.slot * 3 + 1] = time.now;
			if (time.now >= 0.5) positions[crate.slot * 3] = time.now;
		},
		onLateUpdate() {
			sign.setPosition(0, time.now, 0);
			post.setBounds([0, time.now, 0], 1 + time.now);
			flag.setMesh(time.frame % 2 === 0 ? larger : mesh);
		},
	};
});
