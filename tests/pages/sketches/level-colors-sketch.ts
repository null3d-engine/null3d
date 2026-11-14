// An instance batch with a green color in each row, whose mesh has a coarser level. With ?level=coarse
// the rows draw that level, and without it their base level, and each must keep its row's color.
import { defineSketch, type MeshArrays, quat } from '@null3d/engine';

/** How far past the camera the coarser level switches in at each setting, in meters. */
const SWITCH = new URL(import.meta.url).searchParams.get('level') === 'coarse' ? 1 : 500;

/** A flat white square of `quads` quads a side, one meter wide. */
function square(quads: number): MeshArrays {
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	for (let j = 0; j <= quads; j++)
		for (let i = 0; i <= quads; i++) {
			positions.push(i / quads - 0.5, j / quads - 0.5, 0);
			colors.push(1, 1, 1, 1);
		}
	for (let j = 0; j < quads; j++)
		for (let i = 0; i < quads; i++) {
			const at = j * (quads + 1) + i;
			indices.push(at, at + 1, at + quads + 1, at + 1, at + quads + 2, at + quads + 1);
		}
	return { positions, colors, indices, computeNormals: true };
}

export default defineSketch(({ scene, geometry, materials }) => {
	scene.setBackground('#20242c');
	scene.createAmbientLight({ intensity: 2 });
	const mesh = geometry.fromArrays(square(8));
	mesh.setLevels([{ mesh: geometry.fromArrays(square(2)), distance: SWITCH }]);
	const rows = 4;
	const batch = scene.createInstances(mesh, rows, {
		material: materials.standard({ vertexColors: true, roughness: 1, doubleSided: true }),
		colors: true,
	});
	const turn = quat.create();
	for (let k = 0; k < rows; k++) {
		batch.positions.set([k * 1.4 - 2.1, 0, 0], k * 3);
		batch.rotations.set(turn, k * 4);
		batch.scales.set([1, 1, 1], k * 3);
		batch.colors?.set([0.05, 0.6, 0.05, 1], k * 4);
	}
	batch.markDirty();
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 100,
			position: [0, 0, 8],
			target: [0, 0, 0],
		}),
	);
});
