// Copies of a glTF model made in code (tests/pages/lib/gltf-files.ts): a ship whose hull has two
// materials and whose turret is turned, small and raised. The top row shows a copy from
// scene.instantiate, a clone of it that is then turned, and a box whose positions are 16-bit
// integers, as KHR_mesh_quantization stores them, which its node's scale turns into meters.
// The bottom row shows four rows of one instance batch from scene.createInstances, which moves
// every part of the ship with each row, turned and scaled as each row says.
import { defineSketch } from '@null3d/engine';
import { boxArrays, GltfBuilder, shipBuilder } from '../lib/gltf-files';

const addressOf = (bytes: Uint8Array) =>
	URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }));

/**
 * A box of side 1.2 whose positions are 16-bit integers from 0 to 1,000 and whose normals are
 * 8-bit, as KHR_mesh_quantization stores them. Its node's scale and position turn the integers
 * back into meters, around the node's parent.
 */
function quantizedBox(): Uint8Array {
	const b = new GltfBuilder().uses('KHR_mesh_quantization', true);
	const box = boxArrays(1);
	const positions = Uint16Array.from(box.positions, (v) => Math.round((v + 0.5) * 1000));
	const normals = Int8Array.from(box.normals, (v) => v * 127);
	const material = b.material({
		pbrMetallicRoughness: { baseColorFactor: [0.9, 0.6, 0.1, 1], metallicFactor: 0 },
	});
	const mesh = b.mesh([
		{
			attributes: {
				POSITION: b.positions(positions),
				NORMAL: b.accessor(normals, 3, { normalized: true }),
			},
			indices: b.accessor(box.indices, 1),
			material,
		},
	]);
	const part = b.node(
		{ name: 'Box', mesh, scale: [0.0012, 0.0012, 0.0012], translation: [-0.6, -0.6, -0.6] },
		true,
	);
	b.node({ name: 'Crate', children: [part] });
	return b.glb();
}

export default defineSketch(async ({ scene, assets, post }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground('#60666e');
	scene.createDirectionalLight({ direction: [-1, -2, -1.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 40, position: [0, 3, 9], target: [0, 0, 0] }),
	);
	const [ship, quantized] = await Promise.all([
		assets.loadGltf(addressOf(shipBuilder().glb())),
		assets.loadGltf(addressOf(quantizedBox())),
	]);
	const copy = scene.instantiate(ship, { position: [-3, 1.2, 0] });
	const clone = scene.clone(copy);
	clone.setPosition(0, 1.2, 0);
	clone.setRotationEuler(0, Math.PI / 4, 0);
	scene.instantiate(quantized, { position: [3, 1.2, 0], rotation: [0, 0.38, 0, 0.92] });
	const batch = scene.createInstances(ship, 4);
	const { positions, rotations, scales } = batch;
	for (let row = 0; row < 4; row++) {
		positions.set([-3.6 + row * 2.4, -1.2, 0], row * 3);
		const turn = (row * Math.PI) / 8;
		rotations.set([0, Math.sin(turn), 0, Math.cos(turn)], row * 4);
		const size = 0.6 + row * 0.15;
		scales.set([size, size, size], row * 3);
	}
	batch.markDirty();
	return {};
});
