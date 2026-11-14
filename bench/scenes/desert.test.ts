import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
	buildGround,
	copiesOf,
	DESERT_COPIES,
	DESERT_COUNT,
	DESERT_FILES,
	DESERT_MESHES,
	desertCamera,
	desertModelPath,
	desertPlacements,
	fullDetailTriangles,
	GROUND,
	GROUND_SIZE,
	groundHeight,
	icosphere,
	LAP_SECONDS,
	meshesOf,
	ROW_FLOATS,
	readDesertView,
	vertexNormals,
	yawPitch,
} from './desert';

const placements = desertPlacements();

/** The copies of the meshes whose names start with `prefix`. */
const copiesStarting = (prefix: string) =>
	Object.entries(placements)
		.filter(([name]) => name.startsWith(prefix))
		.reduce((sum, [, rows]) => sum + copiesOf(rows), 0);

describe('the desert layout', () => {
	test('places the same copies of each prop in every run', () => {
		expect(desertPlacements()).toEqual(placements);
		expect(copiesStarting('column-')).toBe(DESERT_COPIES.columns);
		expect(copiesStarting('arch-')).toBe(DESERT_COPIES.arches);
		expect(copiesStarting('boulder-')).toBe(DESERT_COPIES.boulders);
		expect(copiesStarting('pebble-')).toBe(DESERT_COPIES.pebbles);
		expect(DESERT_COUNT).toBe(63_469);
	});

	test('keeps the layout that both engines and the earlier figures share', () => {
		// The checksum rounds each value to a thousandth, so a last-bit difference in a platform's
		// math leaves it alone, and a change to the seeds, the noise or the rules changes it.
		const hash = createHash('sha256');
		for (const name of Object.keys(placements).sort()) {
			hash.update(name);
			hash.update(Array.from(placements[name] as Float32Array, (v) => v.toFixed(3)).join(','));
		}
		expect(hash.digest('hex').slice(0, 16)).toBe('82e04e42d8efb212');
	});

	test('places every copy on the ground, with a unit rotation and a positive scale', () => {
		// Boulders lie up to 25 m around their group's center, which stands 20 m inside the ground's
		// edge, so a few lie just past it.
		const limit = GROUND_SIZE / 2 + 5;
		for (const [name, rows] of Object.entries(placements)) {
			expect(DESERT_MESHES.some((mesh) => mesh.name === name)).toBe(true);
			expect(rows.length % ROW_FLOATS).toBe(0);
			for (let o = 0; o < rows.length; o += ROW_FLOATS) {
				const [x, y, z, qx, qy, qz, qw, s] = rows.subarray(
					o,
					o + ROW_FLOATS,
				) as unknown as number[];
				expect(Math.abs(x as number)).toBeLessThan(limit);
				expect(Math.abs(z as number)).toBeLessThan(limit);
				expect(Math.abs((y as number) - groundHeight(x as number, z as number))).toBeLessThan(2);
				expect(Math.hypot(qx as number, qy as number, qz as number, qw as number)).toBeCloseTo(
					1,
					5,
				);
				expect(s).toBeGreaterThan(0);
			}
		}
	});

	test('turns about the vertical axis, then tips about the local x axis', () => {
		const close = (q: number[], expected: number[]) => {
			for (const [k, v] of q.entries()) expect(v).toBeCloseTo(expected[k] as number, 9);
		};
		close(yawPitch(1, 0), [0, Math.sin(0.5), 0, Math.cos(0.5)]);
		close(yawPitch(0, 1), [Math.sin(0.5), 0, 0, Math.cos(0.5)]);
		const [x, y, z, w] = yawPitch(0.7, 0.3);
		expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
	});
});

describe('the desert meshes', () => {
	test('split into the ground file and the props file', () => {
		expect(meshesOf('ground').map((mesh) => mesh.name)).toEqual([GROUND]);
		const props = meshesOf('props').map((mesh) => mesh.name);
		expect(props).toHaveLength(DESERT_MESHES.length - 1);
		expect(props).not.toContain(GROUND);
		expect(DESERT_FILES.flatMap((file) => meshesOf(file))).toHaveLength(DESERT_MESHES.length);
	});

	test('build a ground of two triangles a cell, with unit normals pointing up', () => {
		const { positions, normals, indices } = buildGround(4);
		expect(positions.length / 3).toBe(25);
		expect(indices.length / 3).toBe(32);
		expect(Math.max(...indices)).toBe(24);
		for (let v = 0; v < normals.length; v += 3) {
			const [x, y, z] = [normals[v], normals[v + 1], normals[v + 2]] as number[];
			expect(Math.hypot(x as number, y as number, z as number)).toBeCloseTo(1, 5);
			expect(y).toBeGreaterThan(0);
		}
		expect(positions[0]).toBe(-GROUND_SIZE / 2);
		expect(positions[1]).toBeCloseTo(groundHeight(-GROUND_SIZE / 2, -GROUND_SIZE / 2), 4);
	});

	test('build icospheres of four times the triangles at each subdivision', () => {
		for (const subdivisions of [0, 1, 2, 3]) {
			const { points, faces } = icosphere(subdivisions);
			expect(faces).toHaveLength(20 * 4 ** subdivisions);
			expect(points).toHaveLength(10 * 4 ** subdivisions + 2);
			for (const [x, y, z] of points) expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
		}
	});

	test('give a flat triangle the normal its winding faces', () => {
		const normals = vertexNormals(
			new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]),
			new Uint32Array([0, 1, 2]),
		);
		expect([...normals]).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
	});

	test('build a pebble whose indices stay within its vertices', () => {
		const pebble = DESERT_MESHES.find((mesh) => mesh.name === 'pebble-0')?.build();
		if (!pebble) throw new Error('the desert lost its first pebble');
		expect(pebble.indices.length / 3).toBe(20 * 4 ** 5);
		expect(Math.max(...pebble.indices)).toBe(pebble.positions.length / 3 - 1);
		expect(pebble.normals.length).toBe(pebble.positions.length);
	});

	test('hold about 1.7 billion triangles at full detail', () => {
		// Each mesh's triangles from its builder's grid: rings around, rows along, and fans.
		const triangles: Record<string, number> = { [GROUND]: 2_000_000 };
		for (const v of [0, 1, 2]) {
			triangles[`column-${v}`] = 900 * 288 * 2 + 288;
			triangles[`arch-${v}`] = 1599 * 320 * 2;
		}
		for (const v of [0, 1, 2, 3]) triangles[`boulder-${v}`] = 20 * 4 ** 6;
		for (const v of [0, 1, 2, 3, 4, 5]) triangles[`pebble-${v}`] = 20 * 4 ** 5;
		const total = fullDetailTriangles(triangles, placements);
		expect(total).toBeGreaterThan(1.7e9);
		expect(total).toBeLessThan(1.8e9);
	});
});

describe('the desert camera', () => {
	test('walks at head height over the dunes, and loops each lap', () => {
		for (let t = 0; t < LAP_SECONDS; t += 0.5) {
			const { position, target } = desertCamera('walk', t);
			const [x, y, z] = position;
			expect(y - groundHeight(x, z)).toBeCloseTo(2.2, 6);
			expect(Math.hypot(x, z)).toBeLessThanOrEqual(70);
			expect(Math.hypot(target[0] - x, target[2] - z)).toBeGreaterThan(1);
		}
		const start = desertCamera('walk', 0).position;
		const lap = desertCamera('walk', LAP_SECONDS).position;
		for (let k = 0; k < 3; k++) expect(lap[k]).toBeCloseTo(start[k] as number, 6);
	});

	test('circles high above the middle in the aerial view', () => {
		const { position, target } = desertCamera('aerial', 7);
		expect(position[1]).toBe(140);
		expect(Math.hypot(position[0], position[2])).toBeCloseTo(260, 6);
		expect(target).toEqual([0, 0, 0]);
	});
});

describe('the desert switches and addresses', () => {
	test('read the view, walking by default', () => {
		expect(readDesertView(new URLSearchParams(''))).toBe('walk');
		expect(readDesertView(new URLSearchParams('view=aerial'))).toBe('aerial');
		expect(() => readDesertView(new URLSearchParams('view=orbit'))).toThrow(
			'"orbit" is not a desert view. Use ?view=walk or ?view=aerial.',
		);
	});

	test('name each form of each model file under one prefix', () => {
		expect(desertModelPath('raw', 'ground')).toBe('/bench-desert/raw/ground.glb');
		expect(desertModelPath('null3d', 'props')).toBe('/bench-desert/null3d/props.glb');
	});
});
