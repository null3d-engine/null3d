// A first frame that copies many meshes at once. ?mib= sets how much mesh data the scene holds, so a
// run can bring the frame's peak to any distance from the memory limit.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The mesh data that the scene holds, in MiB. */
const MESH_MIB = Number(params.get('mib') ?? 64);
/** The quads across each mesh's grid. */
const QUADS = 160;

/** A vertex's bytes in the engine's mesh data. */
const VERTEX_BYTES = 32;

export default defineSketch(({ scene, geometry, materials }) => {
	const positions = new Float32Array((QUADS + 1) * (QUADS + 1) * 3);
	const indices = new Uint32Array(QUADS * QUADS * 6);
	for (let j = 0, at = 0; j <= QUADS; j++)
		for (let i = 0; i <= QUADS; i++, at += 3) {
			positions[at] = i / 8;
			positions[at + 2] = j / 8;
		}
	for (let j = 0, at = 0; j < QUADS; j++)
		for (let i = 0; i < QUADS; i++, at += 6) {
			const corner = j * (QUADS + 1) + i;
			indices.set(
				[
					corner,
					corner + 1,
					corner + QUADS + 1,
					corner + 1,
					corner + QUADS + 2,
					corner + QUADS + 1,
				],
				at,
			);
		}
	const material = materials.standard({ color: '#808080' });
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.1, far: 1000 });
	camera.setPosition(10, 40, 60);
	camera.lookAt(10, 0, 10);
	scene.setActiveCamera(camera);
	let total = 0;
	for (let k = 0; total < MESH_MIB * 2 ** 20; k++) {
		const mesh = geometry.fromArrays({ positions, indices, computeNormals: true });
		scene.createMesh({ mesh, material, position: [(k % 8) * 2, 0, 0] });
		total += (positions.length / 3) * VERTEX_BYTES + indices.byteLength;
	}
});
