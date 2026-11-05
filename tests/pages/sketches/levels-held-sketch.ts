// A held frame of a mesh made in code whose level plan waits behind busy job workers. The page
// starts the engine with `JOB_WORKERS` job workers, and the sketch first starts a task on each that
// keeps it busy past the time that hold mode waits for other tasks, then draws a bumpy grid that
// plans its levels by default, whose plan waits for a worker. Each held frame posts the levels that
// the grid holds, and the plan posts them again when its levels are in. The frame that hold mode
// keeps runs none of the sketch's code, so the page checks that the plan's post came before the
// hold ended: hold mode records that frame only once every plan is in.
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

export default defineSketch(async ({ scene, geometry, materials, page, time }) => {
	// The busy tasks count themselves started. The grid waits until both run, so its plan queues
	// behind them even when their module loads slower than the planner on a busy machine.
	const started = new Int32Array(new SharedArrayBuffer(4));
	for (let k = 0; k < JOB_WORKERS; k++) void runTask(BUSY, { ms: BUSY_MS, started }, []);
	while (Atomics.load(started, 0) < JOB_WORKERS)
		await new Promise((resolve) => setTimeout(resolve, 10));
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
	// Drawing the mesh started its default plan, and this call returns that plan's promise.
	void grid.buildLevels().then((levels) => page.post('planned-levels', levels.length));
	return {
		onUpdate() {
			if (time.held) page.post('held-levels', grid.levels.length);
		},
	};
});
