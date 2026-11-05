// A bumpy grid of about a million triangles, made in code two seconds into the run, for the page
// that measures the frames while its levels plan on the job workers (tests/pages/levels-frames.ts).
// The sketch's address takes ?levels=off to make the same grid without levels, which the page
// compares with, and ?cells= for the grid's cells along a side.
import { defineSketch } from '@null3d/engine';
import { bumpyGrid } from '../../lib/level-meshes';

const query = new URL(import.meta.url).searchParams;
/** The grid's cells along a side: 724 makes 1,048,352 triangles. */
const CELLS = Number(query.get('cells') ?? '724');
/** The sketch time at which the grid is made, in seconds. */
const MAKE_AT = 2;

export default defineSketch(({ scene, geometry, materials, time, page }) => {
	scene.setBackground('#202830');
	scene.createAmbientLight({ intensity: 1 });
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 2000,
		position: [10, 30, 70],
		target: [10, 0, 10],
	});
	scene.setActiveCamera(camera);
	const material = materials.standard({ color: '#8fa86a', roughness: 0.9 });
	// A spinning box, so every frame has work to draw.
	const box = scene.createMesh({
		mesh: geometry.box(),
		material,
		position: [10, 4, 10],
		dynamic: true,
	});
	const arrays = bumpyGrid(CELLS);
	let made = false;
	return {
		onUpdate() {
			box.setRotationEuler(0, time.now, 0);
			if (made || time.now < MAKE_AT) return;
			made = true;
			const started = performance.now();
			const off = query.get('levels') === 'off';
			const mesh = geometry.fromArrays({ ...arrays, ...(off ? { levels: false } : {}) });
			const madeMs = performance.now() - started;
			scene.createMesh({ mesh, material, scale: [20, 20, 20] });
			page.post('made', { madeMs, at: performance.now() });
			if (!off)
				mesh
					.buildLevels()
					.then((levels) => page.post('levels', { count: levels.length, at: performance.now() }));
		},
	};
});
