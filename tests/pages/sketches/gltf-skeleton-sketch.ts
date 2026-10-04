// The skeletons of two animated glTF models, drawn with debug.skeleton while their clips play: the
// Fox sample model running, and the arm of tests/pages/lib/gltf-files.ts waving, as one color.
// Their meshes are hidden, so the image shows the joints alone, where the animation step puts
// them at the held time: a line from each joint of a skin to its parent joint, blue at the joint
// and green at its parent, as three.js's SkeletonHelper draws it.
import { defineSketch } from '@null3d/engine';
import { armBuilder } from '../lib/gltf-files';

/** The address of a sample file on the dev server, as `sampleUrl` in tools/lib/samples.ts gives it. */
const sampleUrl = (path: string) => `/samples/${path}`;

const addressOf = (bytes: Uint8Array) =>
	URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }));

export default defineSketch(async ({ scene, assets, debug }) => {
	scene.setBackground('#202428');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 40, position: [0, 1.6, 6], target: [0, 1.2, 0] }),
	);
	const [fox, arm] = await Promise.all([
		assets.loadGltf(sampleUrl('sources/khronos/Fox/glTF-Binary/Fox.glb')),
		assets.loadGltf(addressOf(armBuilder().glb())),
	]);
	const size = 3.2 / (2 * fox.bounds.radius);
	const runner = scene.instantiate(fox, {
		position: [-1.1, 0.1, 0],
		rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
		scale: [size, size, size],
	});
	const waver = scene.instantiate(arm, { position: [1.4, 0, -1] });
	for (const copy of [runner, waver]) for (const object of copy.objects) object.setVisible(false);
	runner.animator().play('Run');
	waver.animator().play('Wave');
	return {
		onUpdate() {
			debug.skeleton(runner);
			debug.skeleton(waver, '#ffcc00');
		},
	};
});
