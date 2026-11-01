// Fills the engine's memory, then makes small requests: each frame adds a few small meshes and objects
// until the engine stops. A plain push among those requests cannot report a refusal, so this is the
// case that the heap's reserve holds up.
import { defineSketch } from '@null3d/engine';

/** The meshes that each frame adds. */
const MESHES_PER_FRAME = 10;
/** The triangles across a mesh's grid, which keep each request small. */
const QUADS = 12;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	const positions: number[] = [];
	const indices: number[] = [];
	for (let j = 0; j <= QUADS; j++) for (let i = 0; i <= QUADS; i++) positions.push(i, 0, j);
	for (let j = 0; j < QUADS; j++)
		for (let i = 0; i < QUADS; i++) {
			const at = j * (QUADS + 1) + i;
			indices.push(at, at + 1, at + QUADS + 1, at + 1, at + QUADS + 2, at + QUADS + 1);
		}
	const material = materials.standard({ color: '#808080' });
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.1, far: 1000 });
	camera.setPosition(0, 40, 80);
	camera.lookAt(0, 0, 0);
	scene.setActiveCamera(camera);
	let filled = false;
	return {
		onUpdate() {
			// The scene's first frame has made its room, so the fill leaves only small requests to come.
			if (!filled && time.frame > 2) {
				filled = true;
				(
					scene as unknown as { core: { glue: { fillHeapForTest(): void } } }
				).core.glue.fillHeapForTest();
			}
			for (let k = 0; k < MESHES_PER_FRAME; k++) {
				const mesh = geometry.fromArrays({ positions, indices, computeNormals: true });
				scene.createMesh({ mesh, material, position: [k % 50, 0, k / 50] });
			}
		},
	};
});
