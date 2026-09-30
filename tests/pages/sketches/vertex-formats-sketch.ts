// Meshes from arrays in every vertex format, for the image test of vertex formats. A small quad of
// each of the 16 formats sits in a grid of four by four. The quads with texture coordinates show
// them as colors, and the others draw lit, so a wrong vertex layout shows as a wrong shape or a
// wrong color. On the right, a grid of 90,601 vertices, too many for 16-bit indices, splits into
// parts and shows its texture coordinates too. Along the bottom: a mesh whose normals the engine
// computes, a quad whose tangents it computes, and three instances of a triangle with 32-bit
// indices.
import { defineSketch, type MeshArrays } from '@null3d/engine';
import { texCoordsMaterial } from '@null3d/engine/internal';

/** A unit quad facing the camera, with its lower left corner at the origin. */
const QUAD_POSITIONS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
const QUAD_NORMALS = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
const QUAD_UVS = [0, 0, 1, 0, 1, 1, 0, 1];
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
/** Attribute bits of the formats, as the sketch builds them: uvs, uvs1, tangents and colors. */
const UV0 = 1;
const UV1 = 2;
const TANGENT = 4;
const COLOR = 8;
/** Quads of the grid of 300 by 300 that splits into parts. */
const GRID = 300;

/** The arrays of a quad in the format `bits`: every attribute the format has holds values. */
function quad(bits: number): MeshArrays {
	return {
		positions: QUAD_POSITIONS,
		normals: new Float32Array(QUAD_NORMALS),
		indices: QUAD_INDICES,
		...(bits & UV0 && { uvs: QUAD_UVS }),
		...(bits & UV1 && { uvs1: [0.9, 0.1, 0.8, 0.2, 0.7, 0.3, 0.6, 0.4] }),
		...(bits & TANGENT && { tangents: new Float32Array(16).fill(0.5) }),
		...(bits & COLOR && { colors: new Float32Array(16).fill(0.25) }),
	};
}

/** A grid of `size` by `size` quads over a unit square, with texture coordinates from 0 to 1. */
function grid(size: number): MeshArrays {
	const row = size + 1;
	const positions = new Float32Array(row * row * 3);
	const uvs = new Float32Array(row * row * 2);
	for (let y = 0; y <= size; y++) {
		for (let x = 0; x <= size; x++) {
			const v = y * row + x;
			positions.set([x / size, y / size, 0], v * 3);
			uvs.set([x / size, y / size], v * 2);
		}
	}
	const indices = new Uint32Array(size * size * 6);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const a = y * row + x;
			const b = a + row;
			indices.set([a, a + 1, b, b, a + 1, b + 1], (y * size + x) * 6);
		}
	}
	return { positions, uvs, indices, computeNormals: true };
}

/** A tent of four triangles without normals, which the engine computes from the triangles. */
const TENT: MeshArrays = {
	positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 0.5, 1.2],
	indices: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
	computeNormals: true,
};

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 50 });
	camera.setPosition(0, 0, 10);
	camera.lookAt(0, 0, 0);
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.3, -0.5, -1], color: '#ffffff', intensity: 2 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });
	const view = texCoordsMaterial(materials);
	const lit = materials.standard({ color: '#d0d4dc' });

	for (let bits = 0; bits < 16; bits++) {
		const mesh = geometry.fromArrays(quad(bits));
		scene.createMesh({
			mesh,
			material: bits & UV0 ? view : lit,
			position: [-5 + (bits % 4) * 1.25, 1.6 - Math.floor(bits / 4) * 1.25, 0],
		});
	}
	scene.createMesh({
		mesh: geometry.fromArrays(grid(GRID)),
		material: view,
		position: [0.4, -1.3, 0],
		scale: [4, 4, 1],
	});
	scene.createMesh({
		mesh: geometry.fromArrays(TENT),
		material: materials.standard({ color: '#e8a040' }),
		position: [-5, -3.4, 0],
	});
	scene.createMesh({
		mesh: geometry.fromArrays({
			positions: QUAD_POSITIONS,
			normals: QUAD_NORMALS,
			uvs: QUAD_UVS,
			indices: QUAD_INDICES,
			computeTangents: true,
		}),
		material: view,
		position: [-3.75, -3.4, 0],
	});
	const triangle = geometry.fromArrays({
		positions: [0, 0, 0, 1, 0, 0, 0.5, 1, 0],
		uvs: [0, 0, 1, 0, 0.5, 1],
		indices: new Uint32Array([0, 1, 2]),
		computeNormals: true,
	});
	const triangles = scene.createInstances(triangle, 3, { material: view });
	for (let i = 0; i < 3; i++) {
		triangles.positions.set([-2.5 + i * 0.9, -3.4, 0], i * 3);
		triangles.rotations.set([0, 0, 0, 1], i * 4);
		triangles.scales.set([0.8, 0.8, 0.8], i * 3);
	}
});
