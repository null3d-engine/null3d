// A grid mesh whose vertices the sketch rewrites, for the test that checks that vertex updates
// allocate nothing and that queries follow them. The engine runs this sketch on the page's own
// thread, so the loop is a function on the page's global object that the test calls. Before it
// posts 'ready', the sketch casts a ray down onto the flat grid, lifts every vertex by one, and
// casts again: the second ray must hit the lifted grid. The loop updates every vertex's
// positions, a run of vertices' normals from a plain array, and the colors without alpha.
import { defineSketch, type RaycastHit, vec3 } from '@null3d/engine';

/** The page's global object, which holds the loop and the heights that the rays hit. */
const scope = globalThis as {
	__null3dVertexLoop?: (iterations: number) => void;
	__null3dVertexHits?: number[];
};

/** Quads along each side of the grid. */
const SIDE = 16;

export default defineSketch(({ scene, geometry, materials, page }) => {
	const camera = scene.createPerspectiveCamera({ position: [0, 6, 8], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	const row = SIDE + 1;
	const count = row * row;
	const positions = new Float32Array(count * 3);
	const normals: number[] = [];
	const colors = new Float32Array(count * 3).fill(0.5);
	const indices: number[] = [];
	for (let j = 0; j < row; j++)
		for (let i = 0; i < row; i++) {
			positions.set([i - SIDE / 2, 0, j - SIDE / 2], (j * row + i) * 3);
			normals.push(0, 1, 0);
			if (i < SIDE && j < SIDE) {
				const a = j * row + i;
				indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
			}
		}
	const grid = geometry.fromArrays({ positions, normals, colors, indices });
	scene.createMesh({ mesh: grid, material: materials.standard({ vertexColors: true }) });

	const origin = vec3.set(vec3.create(), 0.25, 10, 0.25);
	const down = vec3.set(vec3.create(), 0, -1, 0);
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: vec3.create(),
		normal: vec3.create(),
		distance: 0,
		triangle: -1,
	};
	const height = () => (scene.raycast(origin, down, {}, hit) ? (hit.point[1] as number) : -1);

	scope.__null3dVertexLoop = (iterations) => {
		for (let i = 0; i < iterations; i++) {
			const lift = 1 + (i % 8) * 0.125;
			for (let v = 1; v < positions.length; v += 3) positions[v] = lift;
			grid.updateVertices('positions', positions);
			const start = i % (count - 32);
			normals[start * 3 + 1] = 1;
			grid.updateVertices('normals', normals, start, 32);
			colors[(i % count) * 3] = lift * 0.25;
			grid.updateVertices('colors', colors);
		}
	};

	let frame = 0;
	return {
		onLateUpdate() {
			if (++frame !== 3) return;
			const flat = height();
			for (let v = 1; v < positions.length; v += 3) positions[v] = 1;
			grid.updateVertices('positions', positions);
			scope.__null3dVertexHits = [flat, height()];
			page.post('ready');
		},
	};
});
