// A skinned box with one level of detail, built in code: the box bends about its middle by a
// joint, and the level keeps the two faces that meet at the corner the camera sees, of twelve
// triangles. The level names the base mesh's own accessors, so the engine stores it over the base's
// vertices and the joint bends it too. A skinned object picks a level only from such a set: a level
// with accessors of its own would hold vertices that the skin does not move, so the engine draws
// the base mesh instead, and this picture would show the whole box.
import { defineSketch } from '@null3d/engine';
import { boxArrays, GltfBuilder } from '../lib/gltf-files';

/** The level's error, which puts its switch at about 5 meters, nearer than the camera. */
const LEVEL_ERROR = 0.01;
/** The box's side, and the camera's place, which sees three of its faces. */
const SIDE = 2;
const CAMERA: [number, number, number] = [4, 3, 6];

/** The file's bytes: a skinned box whose level names the box's own accessors. */
function skinnedLod(): Uint8Array {
	const b = new GltfBuilder().uses('MSFT_lod');
	const box = boxArrays(SIDE);
	const vertices = box.positions.length / 3;
	const joints = new Uint8Array(vertices * 4);
	const weights = new Float32Array(vertices * 4);
	for (let v = 0; v < vertices; v++) {
		const upper = (box.positions[v * 3 + 1] as number) > 0;
		joints.set([0, 1, 0, 0], v * 4);
		weights.set(upper ? [0.5, 0.5, 0, 0] : [1, 0, 0, 0], v * 4);
	}
	const attributes = () => ({
		POSITION: b.positions(box.positions),
		NORMAL: b.accessor(box.normals, 3),
		JOINTS_0: b.accessor(joints, 4),
		WEIGHTS_0: b.accessor(weights, 4),
	});
	const shared = attributes();
	const base = b.mesh([{ attributes: shared, indices: b.accessor(box.indices, 1) }], 'sleeve');
	// The +X and +Z faces, which the camera sees as the box's near corner.
	const levelIndices = Uint16Array.from([...box.indices.slice(0, 6), ...box.indices.slice(12, 18)]);
	const level = b.mesh(
		[{ attributes: shared, indices: b.accessor(levelIndices, 1) }],
		'sleeve_lod1',
	);
	// The upper joint turns 30 degrees about its middle, so the box's top half leans over.
	const half = Math.PI / 12;
	const upper = b.node({ name: 'Upper', rotation: [0, 0, Math.sin(half), Math.cos(half)] }, true);
	const lower = b.node({ name: 'Lower' }, true);
	const levelNode = b.node({ name: 'Sleeve_lod1', mesh: level, skin: 0 }, true);
	const sleeve = b.node(
		{
			name: 'Sleeve',
			mesh: base,
			skin: 0,
			extensions: { MSFT_lod: { ids: [levelNode] } },
			extras: { NULL3D_lod_error: [LEVEL_ERROR] },
		},
		true,
	);
	b.node({ name: 'Rig', children: [upper, lower, sleeve] });
	// A 4 x 4 identity by columns: a joint's inverse bind matrix that leaves its vertices in place.
	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	b.json.skins = [
		{
			joints: [upper, lower],
			inverseBindMatrices: b.accessor(new Float32Array([...identity, ...identity]), 16, {
				type: 'MAT4',
				count: 2,
			}),
		},
	];
	return b.glb();
}

export default defineSketch(async ({ scene, assets }) => {
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 30,
		position: CAMERA,
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.setBackground('#60666e');
	scene.createDirectionalLight({ direction: [-0.4, -0.6, -0.7], intensity: 3 });
	scene.createAmbientLight({ color: '#b8c8ff', intensity: 0.6 });
	const bytes = skinnedLod();
	const url = URL.createObjectURL(
		new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }),
	);
	scene.instantiate(await assets.loadGltf(url));
	return {};
});
