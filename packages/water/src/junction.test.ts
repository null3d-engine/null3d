// Where a river runs into a lake, the junction map gives each point of the surface to one body, so
// the two meshes never draw the same water twice and leave no hole. The river's waves give way to
// the lake's over a band, the surface lies flat where the meshes meet, and both meshes carry one
// current there, so their waves agree on every pixel.
import { describe, expect, it } from 'bun:test';
import type { MeshArrays } from '@null3d/engine';
import { type Junctions, junctions } from './junction';
import { bodyMesh } from './mesh';
import { type WaterBody, type WaterShape, waterBody } from './shape';

/** The lake's middle and its radii, and the river that runs into it from the west. */
const LAKE = { x: 54, rx: 34, rz: 24 };
const RIVER_END = 22;

/** A river that runs east into a lake, as the Water demo lays them out. */
function mouth(): { bodies: WaterBody[]; meshes: MeshArrays[]; map: Junctions } {
	const middle: [number, number][] = [];
	for (let x = -38; x <= RIVER_END; x += 4) middle.push([x, 1.2 * Math.sin(x * 0.07)]);
	const shore = Array.from({ length: 72 }, (_, i) => {
		const angle = (i / 72) * Math.PI * 2;
		return [LAKE.x + Math.cos(angle) * LAKE.rx, Math.sin(angle) * LAKE.rz] as [number, number];
	});
	const shapes: WaterShape[] = [
		{ kind: 'river', middle, halfWidth: 2.6, speed: 0.6 },
		{ kind: 'lake', shore, depth: 3.8 },
	];
	const bodies = shapes.map((shape) => waterBody(shape));
	const meshes = shapes.map((shape, index) =>
		bodyMesh(shape, bodies[index] as WaterBody, 0, {}, index),
	);
	const map = junctions(bodies, meshes);
	if (!map) throw new Error('the river and the lake should meet');
	return { bodies, meshes, map };
}

/** True when a mesh's triangles cover a point on the water's plane. */
function covers(mesh: MeshArrays, x: number, z: number): boolean {
	const p = mesh.positions as Float32Array;
	const indices = mesh.indices as Uint32Array;
	const at = (vertex: number, axis: number) => p[vertex * 3 + axis] as number;
	/** Which side of the edge from a to b the point lies on. */
	const side = (a: number, b: number) =>
		(at(b, 0) - at(a, 0)) * (z - at(a, 2)) - (at(b, 2) - at(a, 2)) * (x - at(a, 0));
	for (let t = 0; t < indices.length; t += 3) {
		const a = indices[t] as number;
		const b = indices[t + 1] as number;
		const c = indices[t + 2] as number;
		const d0 = side(a, b);
		const d1 = side(b, c);
		const d2 = side(c, a);
		if ((d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0)) return true;
	}
	return false;
}

/** The body that the shader lets draw a point: none where the map names another body. */
function draws(map: Junctions, x: number, z: number, body: number): boolean {
	const owner = map.ownerAt(x, z);
	return owner < 0 || owner === body;
}

describe('where a river runs into a lake', () => {
	const { meshes, map } = mouth();

	it('draws each point of the surface once, with no hole', () => {
		let points = 0;
		let twice = 0;
		for (let x = 16; x <= 25; x += 0.07)
			for (let z = -6; z <= 6; z += 0.07) {
				const shown = meshes.filter((mesh, body) => covers(mesh, x, z) && draws(map, x, z, body));
				const covered = meshes.some((mesh) => covers(mesh, x, z));
				if (!covered) continue;
				points++;
				expect(shown.length).toBeGreaterThanOrEqual(1);
				if (shown.length > 1) twice++;
			}
		expect(points).toBeGreaterThan(10_000);
		// Each mesh draws its own part only where neither covers a texel whole, along their edges.
		expect(twice / points).toBeLessThan(0.01);
	});

	it('gives the lake the water inside its shore, and the river the water outside it', () => {
		// The river's middle, a meter inside the lake's shore and just outside it beside the mouth.
		expect(map.ownerAt(21.5, 0.5)).toBe(1);
		expect(map.ownerAt(20.1, 3)).toBe(0);
	});

	it('lets the river’s waves give way to still water’s smoothly', () => {
		const [ox, oz] = map.origin;
		const [sx, sz] = map.size;
		expect(map.shareAt(ox + 0.1, 0)).toBe(1);
		expect(map.shareAt(ox + sx - 0.1, 0)).toBe(0);
		expect(map.shareAt(0, oz + sz + 1)).toBe(1);
		let last = map.shareAt(ox, 0.5);
		let between = 0;
		for (let x = ox; x < ox + sx; x += 0.1) {
			const share = map.shareAt(x, 0.5);
			expect(Math.abs(share - last)).toBeLessThan(0.05);
			if (share > 0.05 && share < 0.95) between++;
			last = share;
		}
		// The band runs a few meters each way.
		expect(between * 0.1).toBeGreaterThan(3);
	});

	it('lays the surface flat where the meshes meet, and keeps whole waves past it', () => {
		expect(map.flatnessAt(21.5, 0.5)).toBe(1);
		expect(map.flatnessAt(20.1, 3)).toBe(1);
		const [ox, oz] = map.origin;
		expect(map.flatnessAt(ox + 0.1, oz + 0.1)).toBe(0);
		expect(map.flatnessAt(ox - 1, 0)).toBe(0);
	});

	it('gives both meshes the same current near the meeting', () => {
		const currents = new Set<string>();
		for (const mesh of meshes) {
			const p = mesh.positions as Float32Array;
			const uvs = mesh.uvs as Float32Array;
			const uvs1 = mesh.uvs1 as Float32Array;
			for (let v = 0; v < p.length / 3; v++) {
				const x = p[v * 3] as number;
				const z = p[v * 3 + 2] as number;
				if (Math.abs(x - 21) > 2 || Math.abs(z) > 3) continue;
				currents.add(`${uvs[v * 2]} ${uvs1[v * 2]} ${uvs1[v * 2 + 1]}`);
			}
		}
		expect(currents.size).toBe(1);
		const [speed] = [...currents][0]?.split(' ').map(Number) ?? [];
		expect(speed).toBeCloseTo(0.6, 5);
	});

	it('names each vertex’s body and how flat the surface lies there', () => {
		for (const [body, mesh] of meshes.entries()) {
			const p = mesh.positions as Float32Array;
			const uvs = mesh.uvs as Float32Array;
			for (let v = 0; v < p.length / 3; v++) {
				const named = uvs[v * 2 + 1] as number;
				// The whole part names the body, and the fraction, at half scale, how flat it lies.
				expect(Math.floor(named)).toBe(body + 1);
				expect(named - Math.floor(named)).toBeLessThanOrEqual(0.5);
				const x = p[v * 3] as number;
				const z = p[v * 3 + 2] as number;
				if (Math.abs(x - 21) < 1.5 && Math.abs(z) < 2) expect(named - Math.floor(named)).toBe(0.5);
			}
		}
	});
});

describe('bodies that do not meet', () => {
	it('make no junction map', () => {
		const river = waterBody({
			kind: 'river',
			middle: [
				[-40, 0],
				[-10, 0],
			],
			halfWidth: 2,
		});
		const lake = waterBody({
			kind: 'lake',
			shore: [
				[20, -5],
				[30, -5],
				[30, 5],
				[20, 5],
			],
		});
		const meshes = [river, lake].map((body, index) =>
			bodyMesh(
				index === 0
					? {
							kind: 'river',
							middle: [
								[-40, 0],
								[-10, 0],
							],
							halfWidth: 2,
						}
					: {
							kind: 'lake',
							shore: [
								[20, -5],
								[30, -5],
								[30, 5],
								[20, 5],
							],
						},
				body,
				0,
				{},
				index,
			),
		);
		expect(junctions([river, lake], meshes)).toBeUndefined();
	});
});
