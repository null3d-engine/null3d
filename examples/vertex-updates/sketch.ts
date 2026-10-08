// Vertex updates: a sheet of water whose waves move every frame. The sketch keeps one array of
// positions and one of normals, rewrites them in each update, and hands them to
// mesh.updateVertices, which allocates nothing. The engine uploads only the vertices that changed.
// The mesh keeps the bounding sphere of the shape it was made with, so the sheet gets bounds of
// its own that hold the highest waves.
import { defineSketch } from '@null3d/engine';

/** Quads along each side of the sheet. */
const SIDE = 64;
/** The sheet's width and depth. */
const SIZE = 6;
/** The highest a wave rises above the sheet's middle. */
const HEIGHT = 0.25;

/** The water's height at (x, z) and time t, and its slopes along x and z. */
function wave(x: number, z: number, t: number, out: Float32Array): void {
	const a = x * 1.5 + t * 2;
	const b = z * 1.2 + t * 1.3;
	out[0] = HEIGHT * Math.sin(a) * Math.cos(b);
	out[1] = HEIGHT * 1.5 * Math.cos(a) * Math.cos(b);
	out[2] = -HEIGHT * 1.2 * Math.sin(a) * Math.sin(b);
}

export default defineSketch(({ scene, geometry, materials, time }) => {
	scene.setBackground('#0d1620');
	const camera = scene.createPerspectiveCamera({ fov: 45, position: [0, 4, 7], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	const row = SIDE + 1;
	const positions = new Float32Array(row * row * 3);
	const normals = new Float32Array(row * row * 3);
	const indices = new Uint16Array(SIDE * SIDE * 6);
	for (let j = 0; j < SIDE; j++)
		for (let i = 0; i < SIDE; i++) {
			const a = j * row + i;
			indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], (j * SIDE + i) * 6);
		}
	const sample = new Float32Array(3);
	/** Writes the sheet's positions and normals at time t. */
	const shape = (t: number) => {
		for (let j = 0; j < row; j++)
			for (let i = 0; i < row; i++) {
				const k = (j * row + i) * 3;
				const x = (i / SIDE - 0.5) * SIZE;
				const z = (j / SIDE - 0.5) * SIZE;
				wave(x, z, t, sample);
				const [y = 0, dx = 0, dz = 0] = sample;
				const length = Math.hypot(dx, 1, dz);
				positions[k] = x;
				positions[k + 1] = y;
				positions[k + 2] = z;
				normals[k] = -dx / length;
				normals[k + 1] = 1 / length;
				normals[k + 2] = -dz / length;
			}
	};
	shape(0);
	const sheet = geometry.fromArrays({ positions, normals, indices });
	const water = scene.createMesh({
		mesh: sheet,
		material: materials.standard({ color: '#2f7fb8', roughness: 0.25, metalness: 0.1 }),
	});
	// The corners reach past the flat sheet's sphere as the waves rise.
	water.setBounds([0, 0, 0], Math.hypot(SIZE / 2, HEIGHT, SIZE / 2));

	return {
		onUpdate() {
			shape(time.now);
			sheet.updateVertices('positions', positions);
			sheet.updateVertices('normals', normals);
		},
	};
});
