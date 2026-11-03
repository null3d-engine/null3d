// Meshes made in code that plan their levels of detail on the job workers. The sketch makes a bumpy
// grid of 32,768 triangles that plans by default, a grid under the size that plans by default, one
// that opts out, a grid past 65,535 vertices that the engine splits into parts, and a generator's
// sphere. It reports the levels each one gets. It also runs the planner's task straight on the
// grid's words, and reports a hash of each level's triangles, so the test can compare the job
// worker's levels with the levels that Node's planner gives. Then it moves the camera when the page
// asks, so the page can count the triangles drawn near the grid and far from it.
import { defineSketch, type MeshLevel, runTask } from '@null3d/engine';
import { LOD_MAX_LEVELS } from '@null3d/engine/levels-planner';
import { bumpyGrid, indicesHash, planningWords } from '../../lib/level-meshes';

/** The grid's cells along a side, and the scale that makes it 20 meters across. */
const CELLS = 128;
const SCALE = 20;

/** The planner's task, run straight from the sketch with meshoptimizer's modules. */
const PLANNER = {
	name: 'levels',
	wasm: [
		{
			name: 'meshopt-simplifier',
			url: new URL(
				'../../../packages/engine/vendor/meshopt/meshopt_simplifier.wasm',
				import.meta.url,
			),
			what: "meshoptimizer's simplifier",
		},
		{
			name: 'meshopt-encoder',
			url: new URL('../../../packages/engine/vendor/meshopt/meshopt_encoder.wasm', import.meta.url),
			what: "meshoptimizer's vertex cache order",
		},
	],
};

/** A level's error, as the page reports it. */
const errors = (levels: readonly MeshLevel[]) => levels.map((level) => level.error ?? 0);

export default defineSketch(({ scene, geometry, materials, page }) => {
	scene.setBackground('#202830');
	scene.createAmbientLight({ intensity: 1 });
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 2000,
		position: [10, 4, 30],
		target: [10, 0, 10],
	});
	scene.setActiveCamera(camera);
	const grid = bumpyGrid(CELLS);
	const planned = geometry.fromArrays({ ...grid });
	const small = geometry.fromArrays({ ...bumpyGrid(40) });
	const off = geometry.fromArrays({ ...grid, levels: false });
	const split = geometry.fromArrays({ ...bumpyGrid(300) });
	const sphere = geometry.sphere({ radius: 1, widthSegments: 128, heightSegments: 64 });
	scene.createMesh({
		mesh: planned,
		material: materials.standard({ color: '#8fa86a', roughness: 0.9 }),
		scale: [SCALE, SCALE, SCALE],
	});

	const words = planningWords(grid);
	const direct = runTask<{ levels: { indices: Uint32Array; error: number }[] }>(
		PLANNER,
		{ words, cards: false, maxLevels: LOD_MAX_LEVELS, skipFlat: false },
		[words],
	);
	Promise.all([planned.buildLevels(), split.buildLevels(), sphere.buildLevels(), direct])
		.then(([plannedLevels, splitLevels, sphereLevels, task]) => {
			page.post('levels', {
				planned: errors(plannedLevels),
				small: small.levels.length,
				off: off.levels.length,
				split: errors(splitLevels),
				sphere: errors(sphereLevels),
				direct: task.levels.map((level) => ({
					triangles: level.indices.length / 3,
					hash: indicesHash(level.indices),
					error: level.error,
				})),
			});
		})
		.catch((error: unknown) => page.post('failed', { message: String(error) }));

	page.onMessage((type, data) => {
		if (type !== 'distance') return;
		const distance = data as number;
		camera.setPosition(10, distance * 0.4, 10 + distance);
		camera.lookAt(10, 0, 10);
		page.post('moved', distance);
	});
	return {};
});
