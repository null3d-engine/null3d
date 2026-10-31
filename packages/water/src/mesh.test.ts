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
	colors?: Float32Array;
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
function meshOf(shape: WaterShape, level = 0, detail = {}, bed = false): Arrays {
	const body = waterBody(shape);
	const mesh = bodyMesh(shape, body, level, detail, 0, bed);
	return {
		positions: mesh.positions as Float32Array,
		uvs: mesh.uvs as Float32Array,
		uvs1: mesh.uvs1 as Float32Array,
		...(mesh.colors && { colors: mesh.colors as Float32Array }),
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

	it('reads a current of its own at each vertex, where the middle line does not give it', () => {
		// A current that turns across the river, so each vertex's own point decides its direction.
		const turning: RiverShape = {
			...shape,
			current: (x) => [Math.cos(x * 0.1) * 0.5, Math.sin(x * 0.1) * 0.5],
		};
		const { uvs, uvs1 } = meshOf(turning);
		// The first vertex lies at x = -10: its direction and its speed.
		expect(uvs[0]).toBeCloseTo(0.5, 6);
		expect(uvs1[0]).toBeCloseTo(Math.cos(-1) * 0.5 + 0.5, 6);
		expect(uvs1[1]).toBeCloseTo(Math.sin(-1) * 0.5 + 0.5, 6);
		// The vertices across one section all share it, and the last section's differs.
		const last = uvs1.length - 1;
		expect(uvs1[last]).not.toBeCloseTo(uvs1[0] as number, 3);
	});

	it('gives the mesh exactly the half width when the shape asks, for a bed that ends the water', () => {
		const exact = meshOf(shape, 0, { reach: 1 });
		for (let i = 0; i < exact.positions.length; i += 3)
			expect(Math.abs(exact.positions[i + 2] as number)).toBeLessThanOrEqual(2 + 1e-6);
	});

	it('carries a bed of its own in the vertex colors when the water reads it', () => {
		const bedded: RiverShape = { ...shape, bed: (x, z) => 0.5 + x * 0.01 + Math.abs(z) * 0.2 };
		const { colors } = meshOf(bedded, 0, { reach: 1 }, true);
		expect(colors).toBeDefined();
		const positions = meshOf(bedded, 0, { reach: 1 }, true).positions;
		for (let v = 0; v < (colors as Float32Array).length / 4; v++) {
			expect((colors as Float32Array)[v * 4 + 3]).toBeCloseTo(
				0.5 + (positions[v * 3] as number) * 0.01 + Math.abs(positions[v * 3 + 2] as number) * 0.2,
				5,
			);
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

	it('covers the cells inside the shore and a band of two cells past it', () => {
		const { indices } = meshOf(shape, 0, { cell: 2 });
		// 10 cells each way inside, and 2 more on each side, two triangles each.
		expect(indices.length / 3).toBe(14 * 14 * 2);
	});

	it('leaves out the cells past the band', () => {
		// A triangle's bounds hold a corner 14 m from its long side, far past the band.
		const triangle: WaterShape = {
			kind: 'lake',
			shore: [
				[-10, -10],
				[10, -10],
				[-10, 10],
			],
		};
		const mesh = meshOf(triangle, 0, { cell: 2 });
		const at = (corner: number) => (mesh.indices[corner] as number) * 3;
		for (let corner = 0; corner < mesh.indices.length; corner++) {
			// No drawn vertex lies more than the band and one cell's diagonal past the long side.
			const x = mesh.positions[at(corner)] as number;
			const z = mesh.positions[at(corner) + 2] as number;
			expect((x + z) / Math.SQRT2).toBeLessThan(4 + 2 * Math.SQRT2 + 1e-6);
		}
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

	it('carries a bed of its own in the vertex colors when the water reads it', () => {
		const bedded: WaterShape = { ...shape, bed: (x) => 1 + x * 0.01 };
		const mesh = meshOf(bedded, 0, { cell: 5 }, true);
		const colors = mesh.colors as Float32Array;
		for (let v = 0; v < colors.length / 4; v++)
			expect(colors[v * 4 + 3]).toBeCloseTo(1 + (mesh.positions[v * 3] as number) * 0.01, 5);
	});

	it('takes no vertex colors when the water reads the scene’s depth', () => {
		expect(meshOf(shape).colors).toBeUndefined();
	});
});
