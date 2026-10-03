// A small scene of boxes on a ground block, a sphere and an instance batch, and a loop of every query over it, for
// the test that checks that queries allocate nothing. The engine runs this sketch on the page's
// own thread, so the loop is a function on the page's global object that the test calls. The
// sketch posts 'ready' once two frames have placed the objects and the batch's rows, so every
// query in the loop hits something. The loop's rays and volumes move through one range of
// fractions, so a long run takes no branch that the warm-up missed.
import {
	defineSketch,
	type OverlapHit,
	type RaycastBatchHits,
	type RaycastHit,
	type RaycastOptions,
	vec3,
} from '@null3d/engine';

/** The page's global object, which holds the loop that the test calls. */
const scope = globalThis as { __null3dQueryLoop?: (iterations: number) => number };

/** Rays in each batch of the loop. */
const BATCH = 16;

export default defineSketch(({ scene, geometry, materials, page }) => {
	const camera = scene.createPerspectiveCamera({ position: [0, 6, 12], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	const stone = materials.standard({ color: '#8a8f99' });
	const box = geometry.box();
	for (let i = 0; i < 20; i++)
		scene.createMesh({ mesh: box, material: stone, position: [i - 10, 0, (i % 5) - 2] });
	scene.createMesh({
		mesh: geometry.sphere(),
		material: stone,
		position: [0, 2, 0],
		dynamic: true,
	});
	// Ground under everything, so every ray and volume of the loop finds something.
	scene.createMesh({ mesh: box, material: stone, position: [0, -1, 0], scale: [40, 1, 10] });
	const rows = scene.createInstances(box, 10, { material: stone });
	for (let r = 0; r < 10; r++) rows.positions.set([r - 5, 0, -4], r * 3);

	// Every array and object that the queries use, made once.
	const origin = vec3.create();
	const down = vec3.set(vec3.create(), 0, -1, 0);
	const low = vec3.create();
	const high = vec3.create();
	const options: RaycastOptions = { maxDistance: 100, layers: 1 };
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: vec3.create(),
		normal: vec3.create(),
		distance: 0,
		triangle: -1,
	};
	const hits: RaycastHit[] = [];
	const found: OverlapHit[] = [];
	const rays = new Float64Array(BATCH * 6);
	const out: RaycastBatchHits = {
		distances: new Float32Array(BATCH),
		objects: new Array(BATCH).fill(null),
		instances: new Int32Array(BATCH),
		points: new Float32Array(BATCH * 3),
		normals: new Float32Array(BATCH * 3),
	};
	for (let i = 0; i < BATCH; i++) rays.set([i - 8 + 0.5, 10, 0.25, 0, -1, 0], i * 6);

	// Returns how many of the iterations' calls found nothing, which should be none.
	scope.__null3dQueryLoop = (iterations) => {
		let misses = 0;
		for (let i = 0; i < iterations; i++) {
			const x = (i % 200) * 0.1 - 10 + 0.05;
			vec3.set(origin, x, 10, (i % 7) * 0.5 - 1.5);
			if (!scene.raycast(origin, down, options, hit)) misses++;
			if (!scene.raycastAny(origin, down, options)) misses++;
			if (scene.raycastAll(origin, down, options, hits) === 0) misses++;
			vec3.set(low, x - 1.5, -1, -3);
			vec3.set(high, x + 1.5, 1, 3);
			if (scene.overlapSphere(origin, 10.6, options, found) === 0) misses++;
			if (scene.overlapBox(low, high, options, found) === 0) misses++;
			if (i % 10 === 0 && scene.raycastBatch(rays, options, out) === 0) misses++;
		}
		return misses;
	};

	let frame = 0;
	return {
		onLateUpdate() {
			if (++frame === 3) page.post('ready');
		},
	};
});
