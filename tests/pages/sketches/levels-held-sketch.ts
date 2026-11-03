// A held frame of a mesh made in code whose level plan waits behind busy job workers. The page
// starts the engine with `JOB_WORKERS` job workers, and the sketch first queues a task on each that
// keeps it busy past the time that hold mode waits for other tasks, then draws a bumpy grid that
// plans its levels by default, whose plan waits for a worker. Each held frame posts the levels that
// the grid holds, so the page can check that the frame that hold mode keeps drew them.
import { defineSketch, runTask, type Task } from '@null3d/engine';
import { bumpyGrid } from '../../lib/level-meshes';

/** The task that keeps a job worker busy. */
const BUSY: Task = {
	name: 'levels-held-busy',
	script: new URL('./levels-held-busy-task.ts', import.meta.url),
};

/** How long each busy task runs: past the ten seconds that a held frame waits for other tasks. */
const BUSY_MS = 13_000;
/** The job workers that the page's `jobs` switch gives the engine. */
const JOB_WORKERS = 2;

export default defineSketch(({ scene, geometry, materials, page, time }) => {
	for (let k = 0; k < JOB_WORKERS; k++) void runTask(BUSY, { ms: BUSY_MS }, []);
	scene.setBackground('#202830');
	scene.createAmbientLight({ intensity: 1 });
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 200,
		position: [10, 8, 30],
		target: [10, 0, 10],
	});
	scene.setActiveCamera(camera);
	const grid = geometry.fromArrays({ ...bumpyGrid(128) });
	scene.createMesh({
		mesh: grid,
		material: materials.standard({ color: '#8fa86a', roughness: 0.9 }),
		scale: [20, 20, 20],
	});
	return {
		onUpdate() {
			if (time.held) page.post('held-levels', grid.levels.length);
		},
	};
});
