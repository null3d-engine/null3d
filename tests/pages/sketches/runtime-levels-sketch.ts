// Meshes made in code that plan their levels of detail on the job workers. The sketch makes a bumpy
// grid of 32,768 triangles that plans by default, a grid under the size that plans by default, one
// that opts out, a grid past 65,535 vertices that the engine splits into parts, and a generator's
// sphere. It reports the levels each one gets. It also runs the planner's task straight on the
// grid's words, and reports a hash of each level's triangles, so the test can compare the job
// worker's levels with the levels that Node's planner gives. Then it moves the camera when the page
// asks, so the page can count the triangles drawn near the grid and far from it. The grid in parts
// draws far to one side, with the pieces that its plan gives it, and the same grid without levels
// or pieces draws far to the other, so the page can count what each draws from the same place.
import { defineSketch, type MeshLevel, runTask } from '@null3d/engine';
import { LOD_MAX_LEVELS } from '@null3d/engine/levels-planner';
import { bumpyGrid, indicesHash, planningWords } from '../../lib/level-meshes';

/** The grid's cells along a side, and the scale that makes it 20 meters across. */
const CELLS = 128;
const SCALE = 20;

/** How far to the side the grid in parts draws, and the same grid without pieces to the other. */
const PIECED_X = 500;

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

export default defineSketch(({ scene, geometry, materials, page, debug }) => {
	// The sketch's frame figures count the triangles of the draws that the GPU culls on every
	// build. A production build's measurement reads only the GPU time, and counts no such draw.
	debug.frameStats();
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
	const large = bumpyGrid(300);
	const split = geometry.fromArrays({ ...large });
	const whole = geometry.fromArrays({ ...large, levels: false });
	const sphere = geometry.sphere({ radius: 1, widthSegments: 128, heightSegments: 64 });
	const ground = materials.standard({ color: '#8fa86a', roughness: 0.9 });
	scene.createMesh({ mesh: planned, material: ground, scale: [SCALE, SCALE, SCALE] });
	for (const [mesh, x] of [
		[split, PIECED_X],
		[whole, -PIECED_X],
	] as const)
		scene.createMesh({ mesh, material: ground, position: [x, 0, 0], scale: [SCALE, SCALE, SCALE] });

	const words = planningWords(grid);
	const direct = runTask<{ levels: { indices: Uint32Array; error: number }[] }>(
		PLANNER,
		{
			words,
			cards: false,
			maxLevels: LOD_MAX_LEVELS,
			skipFlat: false,
			parts: 1,
			basePieces: false,
		},
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
		if (type === 'corner') {
			// From a corner of the grid at `x`, looking out past it: only the pieces near the
			// corner reach into the view.
			const x = data as number;
			camera.setPosition(x + SCALE, 4, 0);
			camera.lookAt(x + SCALE * 2, 0, -SCALE);
			page.post('moved', data);
			return;
		}
		if (type !== 'distance') return;
		const distance = data as number;
		camera.setPosition(10, distance * 0.4, 10 + distance);
		camera.lookAt(10, 0, 10);
		page.post('moved', distance);
	});
	return {};
});
