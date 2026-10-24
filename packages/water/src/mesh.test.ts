// The surface's mesh: a strip that follows a river's middle line, and a grid over a lake's bounds
// with the cells outside its shore left out. The current rides in the second texture coordinate, so
// the surface shader drifts its ripples and its foam the way the water runs there.
import { describe, expect, it } from 'bun:test';
import { bodyMesh } from './mesh';
import { type RiverShape, type WaterShape, waterBody } from './shape';

/** One mesh's arrays, as the builder writes them. */
type Arrays = {
	positions: Float32Array;
	uvs: Float32Array;
	uvs1: Float32Array;
	indices: Uint32Array;
};

/** The normal of one triangle of a mesh, from its three corners. */
function normalOf(mesh: Arrays, triangle: number): [number, number, number] {
	const at = (corner: number) => (mesh.indices[triangle * 3 + corner] as number) * 3;
	const [a, b, c] = [at(0), at(1), at(2)] as [number, number, number];
	const ux = (mesh.positions[b] as number) - (mesh.positions[a] as number);
	const uy = (mesh.positions[b + 1] as number) - (mesh.positions[a + 1] as number);
	const uz = (mesh.positions[b + 2] as number) - (mesh.positions[a + 2] as number);
	const vx = (mesh.positions[c] as number) - (mesh.positions[a] as number);
	const vy = (mesh.positions[c + 1] as number) - (mesh.positions[a + 1] as number);
	const vz = (mesh.positions[c + 2] as number) - (mesh.positions[a + 2] as number);
	return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** A shape's surface mesh, as the add-on builds it. */
function meshOf(shape: WaterShape, level = 0, detail = {}): Arrays {
	const body = waterBody(shape);
	const mesh = bodyMesh(shape, level, detail, (x, z) => body.contains(x, z));
	return {
		positions: mesh.positions as Float32Array,
		uvs: mesh.uvs as Float32Array,
		uvs1: mesh.uvs1 as Float32Array,
		indices: mesh.indices as Uint32Array,
	};
}

describe('a river’s mesh', () => {
	/** A straight river 20 m long, 4 m wide. */
	const shape: RiverShape = {
		kind: 'river',
		middle: [
			[-10, 0],
			[10, 0],
		],
		halfWidth: 2,
		speed: 0.6,
	};

	it('follows the middle line at the water’s height', () => {
		const { positions } = meshOf(shape, 1, { step: 2 });
		for (let i = 0; i < positions.length; i += 3) {
			expect(positions[i + 1]).toBe(1);
			expect(positions[i] as number).toBeGreaterThanOrEqual(-10.1);
			expect(positions[i] as number).toBeLessThanOrEqual(10.1);
			expect(Math.abs(positions[i + 2] as number)).toBeLessThanOrEqual(2 * 1.36 + 1e-4);
		}
	});

	it('carries the current in its texture coordinates', () => {
		const { uvs, uvs1 } = meshOf(shape);
		for (let i = 0; i < uvs.length; i += 2) expect(uvs[i]).toBeCloseTo(0.6, 6);
		for (let i = 0; i < uvs1.length; i += 2) {
			// The current runs toward +x, which the shader reads back as a direction.
			expect(uvs1[i]).toBeCloseTo(1, 6);
			expect(uvs1[i + 1]).toBeCloseTo(0.5, 6);
		}
	});

	it('faces up along its whole length', () => {
		const mesh = meshOf(shape);
		const triangles = mesh.indices.length / 3;
		for (let t = 0; t < triangles; t++) {
			const [x, y, z] = normalOf(mesh, t);
			expect(y).toBeGreaterThan(0);
			expect(Math.abs(x) + Math.abs(z)).toBeCloseTo(0, 6);
		}
	});
});

describe('a lake’s mesh', () => {
	/** A square lake 20 m across. */
	const shape: WaterShape = {
		kind: 'lake',
		shore: [
			[-10, -10],
			[10, -10],
			[10, 10],
			[-10, 10],
		],
		depth: 3,
	};

	it('covers the cells inside the shore and leaves the others out', () => {
		const { indices } = meshOf(shape, 0, { cell: 2 });
		// 10 cells each way, two triangles each.
		expect(indices.length / 3).toBe(10 * 10 * 2);
	});

	it('holds still water', () => {
		const { uvs } = meshOf(shape, 0, { cell: 5 });
		for (let i = 0; i < uvs.length; i += 2) expect(uvs[i]).toBe(0);
	});

	it('faces up', () => {
		const mesh = meshOf(shape, 0, { cell: 5 });
		const triangles = mesh.indices.length / 3;
		for (let t = 0; t < triangles; t++) expect(normalOf(mesh, t)[1]).toBeGreaterThan(0);
	});
});
