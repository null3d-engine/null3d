// The outputs of `assets convert` on its test files (tests/lib/convert-files.ts), side by side:
// the column from FBX, skinned and morphed, halfway through its clip, which bends its upper half and
// widens its middle; the same column from OBJ, at rest; a pyramid from binary STL with a color on
// each face; and a cube from binary PLY with a color at each corner.
import { defineSketch } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

const FOLDER = 'assets/models/converted';

export default defineSketch(async ({ scene, assets, post }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground('#60666e');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	const [fbx, obj, stl, ply] = await Promise.all(
		['column-fbx', 'column-obj', 'pyramid-stl', 'cube-ply'].map((name) =>
			assets.loadGltf(`${FOLDER}/${name}.glb`),
		),
	);
	const column = scene.instantiate(fbx!, { position: [-2.4, 0, 0] });
	column.animator().play('Scene');
	scene.instantiate(obj!, { position: [-0.8, 0, 0] });
	scene.instantiate(stl!, { position: [0.8, 0, 0], rotation: [0, 0.3826834, 0, 0.9238795] });
	scene.instantiate(ply!, {
		position: [2.4, 0.6, 0],
		rotation: [0.1464466, 0.3535534, 0.3535534, 0.8535534],
	});
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.5,
			far: 30,
			position: [0, 2.2, 7],
			target: [0, 0.9, 0],
		}),
	);
	return {};
});
