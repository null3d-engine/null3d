// Meshes from arrays: a height field of 9,409 vertices and a crystal, each built with
// geometry.fromArrays from typed arrays. The engine computes the normals of both. The height
// field's triangles share their vertices, so it shades smoothly. Each face of the crystal has its
// own three vertices, so its edges stay hard.
import { defineSketch, type MeshArrays } from '@null3d/engine';

/** Quads along each side of the height field. */
const QUADS = 96;
/** The width of the height field, in meters. */
const WIDTH = 24;

/** The height of the ground at a point: rolling hills with ripples. */
const heightAt = (x: number, z: number) =>
	1.2 * Math.sin(x * 0.35) * Math.cos(z * 0.3) + 0.3 * Math.sin((x + z) * 0.9);

/** A grid of quads over the ground, with one vertex at each corner that its quads share. */
function heightField(): MeshArrays {
	const row = QUADS + 1;
	const positions = new Float32Array(row * row * 3);
	for (let v = 0; v < row * row; v++) {
		const x = ((v % row) / QUADS - 0.5) * WIDTH;
		const z = (Math.floor(v / row) / QUADS - 0.5) * WIDTH;
		positions.set([x, heightAt(x, z), z], v * 3);
	}
	// Two triangles per quad, counter-clockwise seen from above.
	const indices = new Uint16Array(QUADS * QUADS * 6);
	for (let q = 0; q < QUADS * QUADS; q++) {
		const a = Math.floor(q / QUADS) * row + (q % QUADS);
		indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], q * 6);
	}
	return { positions, indices, computeNormals: true };
}

/** An octahedron stretched along y. Without indices, each three vertices make one triangle. */
function crystal(): MeshArrays {
	const ring = [
		[1, 0, 0],
		[0, 0, -1],
		[-1, 0, 0],
		[0, 0, 1],
	];
	const positions: number[] = [];
	for (let side = 0; side < 4; side++) {
		const a = ring[side];
		const b = ring[(side + 1) % 4];
		positions.push(0, 2, 0, ...a, ...b); // an upper face
		positions.push(0, -2, 0, ...b, ...a); // the lower face below it
	}
	return { positions, computeNormals: true };
}

export default defineSketch(({ scene, geometry, materials, time }) => {
	scene.setBackground('#8fb4d8');
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.1, far: 100 });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -1.5, -0.6], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	scene.createMesh({
		mesh: geometry.fromArrays(heightField()),
		material: materials.standard({ color: '#6f9e58' }),
	});
	const gem = scene.createMesh({
		mesh: geometry.fromArrays(crystal()),
		material: materials.standard({ color: '#c77dff' }),
		position: [0, 4, 0],
		scale: [0.8, 0.8, 0.8],
		dynamic: true,
	});

	return {
		onUpdate() {
			const t = time.now;
			gem.setRotationEuler(0, t * 0.8, 0);
			gem.setPosition(0, 4 + 0.3 * Math.sin(t * 1.5), 0);
			camera.setPosition(Math.sin(t * 0.15) * 16, 8, Math.cos(t * 0.15) * 16);
			camera.lookAt(0, 1.5, 0);
		},
	};
});
