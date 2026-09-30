import { describe, expect, test } from 'bun:test';
import { BoxGeometry, Quaternion, Vector3 } from 'three';
import {
	boxGeometry,
	createS1,
	createS2,
	createS3,
	HOLD_TIME,
	mulberry32,
	S1_BOB_HEIGHT,
	S1_BOX_SIZE,
	S1_CELLS_SQUARE,
	S1_EXTENT,
	S2_BRANCHING,
	S2_DEPTH,
	S2_MATERIAL_COUNT,
	S2_MESH_COUNT,
	S2_NODE_COUNT,
	S2_NODES_PER_TREE,
	S2_ROOTS,
	S3_BOX,
	S3_DEFAULT_COUNT,
	S3_EXTENT,
	S3_FLOOR,
	S3_LIGHT_COLORS,
	S3_LIGHT_COUNT,
	S3_LIGHT_SEED,
	S3_PATHS,
	s1Camera,
	s1CellsCamera,
	s1CellsInstanceAt,
	s1InstanceAt,
	s1StaticCamera,
	s2Camera,
	s2MeshSize,
	s2RootRotation,
	s2Trees,
	s3BoxAt,
	s3Camera,
	s3Grid,
	s3LightAt,
	s3LightColor,
} from './spec';

const TAU = 2 * Math.PI;

/** The published mulberry32 (github.com/bryc/code, jshash/PRNGs.md), kept as an outside reference. */
function referenceMulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function draws(random: () => number, count: number): number[] {
	return Array.from({ length: count }, () => random());
}

/** Camera position and target at time t, from one of the spec's camera functions. */
function cameraAt(
	camera: (t: number, position: number[], target: number[]) => void,
	t: number,
): { position: number[]; target: number[] } {
	const position = [Number.NaN, Number.NaN, Number.NaN];
	const target = [Number.NaN, Number.NaN, Number.NaN];
	camera(t, position, target);
	return { position, target };
}

function expectClose(actual: number[], expected: number[], digits = 9): void {
	expect(actual).toHaveLength(expected.length);
	for (const [i, value] of expected.entries()) expect(actual[i]).toBeCloseTo(value, digits);
}

function everyValue(values: ArrayLike<number>, check: (value: number) => boolean): boolean {
	for (let i = 0; i < values.length; i++) if (!check(values[i]!)) return false;
	return true;
}

describe('mulberry32', () => {
	test('gives the same sequence for the same seed and a different one for another seed', () => {
		expect(draws(mulberry32(7), 1000)).toEqual(draws(mulberry32(7), 1000));
		expect(draws(mulberry32(7), 10)).not.toEqual(draws(mulberry32(8), 10));
	});

	test('matches the published generator', () => {
		for (const seed of [0, 1, 2, 100, 119, 0x7fffffff]) {
			expect(draws(mulberry32(seed), 10_000)).toEqual(draws(referenceMulberry32(seed), 10_000));
		}
	});

	test('returns floats in [0, 1) that spread over the range', () => {
		const values = draws(mulberry32(1), 100_000);
		expect(everyValue(values, (v) => v >= 0 && v < 1)).toBe(true);
		const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
		expect(mean).toBeCloseTo(0.5, 2);
	});
});

describe('boxGeometry', () => {
	test('matches three.js BoxGeometry value for value', () => {
		for (const [width, height, depth] of [
			[S1_BOX_SIZE, S1_BOX_SIZE, S1_BOX_SIZE],
			[1, 2, 3],
			s2MeshSize(0),
			s2MeshSize(19),
		] as const) {
			const ours = boxGeometry(width, height, depth);
			const three = new BoxGeometry(width, height, depth);
			expect(ours.position).toEqual(three.getAttribute('position').array as Float32Array);
			expect(ours.normal).toEqual(three.getAttribute('normal').array as Float32Array);
			expect(ours.index).toEqual(three.getIndex()?.array as Uint16Array);
		}
	});

	test('has 24 vertices with unit face normals and 36 indices', () => {
		const box = boxGeometry(S1_BOX_SIZE, S1_BOX_SIZE, S1_BOX_SIZE);
		expect(box.position).toHaveLength(72);
		expect(box.normal).toHaveLength(72);
		expect(box.index).toHaveLength(36);
		for (let v = 0; v < 24; v++) {
			const [x, y, z] = box.normal.subarray(v * 3, v * 3 + 3);
			expect(Math.hypot(x!, y!, z!)).toBe(1);
			// A face normal points the same way as its vertices' offset from the center.
			const [px, py, pz] = box.position.subarray(v * 3, v * 3 + 3);
			expect(x! * px! + y! * py! + z! * pz!).toBeCloseTo(S1_BOX_SIZE / 2, 6);
		}
	});
});

describe('S1', () => {
	const n = 1000;
	const data = createS1(n);

	test('is the same for the same seed and different for another seed', () => {
		expect(createS1(n)).toEqual(data);
		expect(createS1(n, 2).base).not.toEqual(data.base);
	});

	test('has one entry per instance, three for base positions', () => {
		expect(data.count).toBe(n);
		expect(data.base).toHaveLength(n * 3);
		expect(data.phase).toHaveLength(n);
		expect(data.speed).toHaveLength(n);
		expect(data.spin).toHaveLength(n);
		expect(createS1(0).base).toHaveLength(0);
	});

	test('draws x, y, z, phase, speed and spin instance by instance', () => {
		const random = mulberry32(1);
		for (let i = 0; i < 3; i++) {
			const [x, y, z, phase, speed, spin] = draws(random, 6) as [
				number,
				number,
				number,
				number,
				number,
				number,
			];
			expect([...data.base.subarray(i * 3, i * 3 + 3)]).toEqual(
				[x, y, z].map((v) => Math.fround(v * 2 * S1_EXTENT - S1_EXTENT)),
			);
			expect(data.phase[i]).toBe(Math.fround(phase * TAU));
			expect(data.speed[i]).toBe(Math.fround(0.5 + speed * 1.5));
			expect(data.spin[i]).toBe(Math.fround(spin * 2 - 1));
		}
		// A smaller count gives the first instances of a larger one.
		expect(createS1(10).base).toEqual(data.base.subarray(0, 30));
	});

	test('keeps every value in its range', () => {
		const big = createS1(100_000);
		// 32-bit storage can round a value just under a range's top up to the top itself.
		expect(everyValue(big.base, (v) => v >= -S1_EXTENT && v <= S1_EXTENT)).toBe(true);
		expect(everyValue(big.phase, (v) => v >= 0 && v <= Math.fround(TAU))).toBe(true);
		expect(everyValue(big.speed, (v) => v >= 0.5 && v <= 2)).toBe(true);
		expect(everyValue(big.spin, (v) => v >= -1 && v <= 1)).toBe(true);
	});

	test('refuses a count that is not a whole number of 0 or more', () => {
		expect(() => createS1(-1)).toThrow(RangeError);
		expect(() => createS1(1.5)).toThrow(RangeError);
	});

	test('moves each instance up and down and turns it about +Y', () => {
		const position = [0, 0, 0];
		const quaternion = [9, 9, 9, 9];
		const [bx, by, bz] = data.base.subarray(0, 3) as unknown as [number, number, number];
		const phase = data.phase[0]!;
		const speed = data.speed[0]!;
		const spin = data.spin[0]!;

		s1InstanceAt(data, 0, 0, position, quaternion);
		expectClose(position, [bx, by + S1_BOB_HEIGHT * Math.sin(phase), bz]);
		expectClose(quaternion, [0, 0, 0, 1]);

		const outPosition = new Float32Array(3);
		const outQuaternion = new Float32Array(4);
		s1InstanceAt(data, 0, HOLD_TIME, outPosition, outQuaternion);
		expectClose(
			[...outPosition],
			[bx, by + S1_BOB_HEIGHT * Math.sin(speed * HOLD_TIME + phase), bz],
			5,
		);
		const half = (spin * HOLD_TIME) / 2;
		expectClose([...outQuaternion], [0, Math.sin(half), 0, Math.cos(half)], 6);
	});

	test('orbits the camera around the origin, counter-clockwise from above', () => {
		const start = cameraAt(s1Camera, 0);
		expectClose(start.position, [140, 40, 0]);
		expectClose(start.target, [0, 0, 0]);
		const quarter = cameraAt(s1Camera, 15);
		expectClose(quarter.position, [0, 40, -140]);
		expectClose(quarter.target, [0, 0, 0]);
		expectClose(cameraAt(s1Camera, 60).position, [140, 40, 0]);
		// Seen from above with +X to the right and -Z up the screen, the camera first heads to -Z.
		expect(cameraAt(s1Camera, 1).position[2]).toBeLessThan(0);
	});
});

describe('S1-static', () => {
	test('flies the camera along -Z from +100 to -100 every 30 s, looking ahead', () => {
		const start = cameraAt(s1StaticCamera, 0);
		expectClose(start.position, [0, 5, 100]);
		expectClose(start.target, [0, 5, 99]);
		const quarter = cameraAt(s1StaticCamera, 7.5);
		expectClose(quarter.position, [0, 5, 50]);
		expectClose(quarter.target, [0, 5, 49]);
		expectClose(cameraAt(s1StaticCamera, 15).position, [0, 5, 0]);
		expectClose(cameraAt(s1StaticCamera, 29.97).position, [0, 5, -99.8]);
		expectClose(cameraAt(s1StaticCamera, 30).position, [0, 5, 100]);
	});
});

describe('S1-cells', () => {
	test("spreads S1's boxes over 8 x 8 grid cells and keeps each box's height and turn", () => {
		const data = createS1(20_000);
		const cells = new Set<string>();
		const position = [0, 0, 0];
		const rotation = [0, 0, 0, 0];
		const still = [0, 0, 0];
		const turn = [0, 0, 0, 0];
		// The engine's cell of a coordinate: the whole number of cells nearest to it.
		const cellOf = (v: number) => Math.floor(v / S1_CELLS_SQUARE.cellSize + 0.5);
		for (let i = 0; i < data.count; i++) {
			s1CellsInstanceAt(data, i, 7, position, rotation);
			s1InstanceAt(data, i, 0, still, turn);
			expect(position[1]).toBe(still[1] as number);
			expect(rotation).toEqual(turn);
			const [x, , z] = position as [number, number, number];
			expect(cellOf(position[1] as number)).toBe(0);
			cells.add(`${cellOf(x)},${cellOf(z)}`);
		}
		expect(cells.size).toBe(64);
		for (const cell of cells)
			for (const c of cell.split(',').map(Number)) {
				expect(c).toBeGreaterThanOrEqual(-4);
				expect(c).toBeLessThanOrEqual(3);
			}
	});

	test('flies the camera low along -Z over 7 km every 35 s, looking ahead', () => {
		const start = cameraAt(s1CellsCamera, 0);
		expectClose(start.position, [300, 5, 3000]);
		expectClose(start.target, [300, 5, 2999]);
		expectClose(cameraAt(s1CellsCamera, 17.5).position, [300, 5, -500]);
		expectClose(cameraAt(s1CellsCamera, 35).position, [300, 5, 3000]);
		expectClose(cameraAt(s1CellsCamera, HOLD_TIME).position, [300, 5, 2600]);
	});
});

describe('S2', () => {
	const data = createS2();

	test('is the same for the same seed and different for another seed', () => {
		expect(createS2()).toEqual(data);
		expect(createS2(3).position).not.toEqual(data.position);
	});

	test('rounds a count up to whole trees, at least one', () => {
		expect([0, 1, 364, 365, 5096].map(s2Trees)).toEqual([1, 1, 1, 2, 14]);
		const three = createS2(2, 3);
		expect(three.parent).toHaveLength(3 * S2_NODES_PER_TREE);
		// The first trees of a smaller forest match the default forest's, on a grid with one row.
		expect(three.mesh).toEqual(data.mesh.subarray(0, 3 * S2_NODES_PER_TREE));
		expect(three.position[2]).toBe(0);
	});

	test('has 5,096 nodes: 14 trees of 364 nodes', () => {
		expect(S2_NODES_PER_TREE).toBe(364);
		expect(S2_NODE_COUNT).toBe(5096);
		for (const array of [data.parent, data.depth, data.mesh, data.material, data.rotationY])
			expect(array).toHaveLength(S2_NODE_COUNT);
		expect(data.position).toHaveLength(S2_NODE_COUNT * 3);
		expect(data.scale).toHaveLength(S2_NODE_COUNT);
	});

	test('puts parents before children, with 3 children per node on 6 levels', () => {
		const children = new Int32Array(S2_NODE_COUNT);
		const perLevel = new Array<number>(S2_DEPTH).fill(0);
		for (let i = 0; i < S2_NODE_COUNT; i++) {
			const parent = data.parent[i]!;
			const depth = data.depth[i]!;
			perLevel[depth] = (perLevel[depth] ?? 0) + 1;
			if (parent === -1) {
				expect(depth).toBe(0);
				continue;
			}
			expect(parent).toBeGreaterThanOrEqual(0);
			expect(parent).toBeLessThan(i);
			expect(depth).toBe(data.depth[parent]! + 1);
			children[parent] = children[parent]! + 1;
		}
		expect(perLevel).toEqual([1, 3, 9, 27, 81, 243].map((count) => count * S2_ROOTS));
		for (let i = 0; i < S2_NODE_COUNT; i++) {
			expect(children[i]).toBe(data.depth[i]! < S2_DEPTH - 1 ? S2_BRANCHING : 0);
		}
	});

	test('sets the roots on a 7 by 2 grid, 30 apart, unturned and unscaled', () => {
		for (let r = 0; r < S2_ROOTS; r++) {
			const i = r * S2_NODES_PER_TREE;
			expect(data.parent[i]).toBe(-1);
			expect([...data.position.subarray(i * 3, i * 3 + 3)]).toEqual([
				((r % 7) - 3) * 30,
				0,
				(Math.floor(r / 7) - 0.5) * 30,
			]);
			expect(data.rotationY[i]).toBe(0);
			expect(data.scale[i]).toBe(1);
		}
	});

	test('places each child at its level radius, in range, at scale 0.7', () => {
		for (let i = 0; i < S2_NODE_COUNT; i++) {
			const depth = data.depth[i]!;
			if (depth === 0) continue;
			const [x, y, z] = data.position.subarray(i * 3, i * 3 + 3) as unknown as number[];
			expect(Math.hypot(x!, z!)).toBeCloseTo(4 * 0.6 ** (depth - 1), 5);
			expect(y).toBeGreaterThanOrEqual(-1);
			expect(y).toBeLessThanOrEqual(1);
			expect(data.rotationY[i]).toBeGreaterThanOrEqual(0);
			expect(data.rotationY[i]).toBeLessThanOrEqual(Math.fround(TAU));
			expect(data.scale[i]).toBe(Math.fround(0.7));
		}
	});

	test('uses every mesh and every material, and no index out of range', () => {
		expect(new Set(data.mesh)).toEqual(new Set(Array.from({ length: S2_MESH_COUNT }, (_, k) => k)));
		expect(new Set(data.material)).toEqual(
			new Set(Array.from({ length: S2_MATERIAL_COUNT }, (_, m) => m)),
		);
	});

	test('sizes mesh k from a generator seeded with 100 + k, each side in [0.5, 1.5)', () => {
		for (let k = 0; k < S2_MESH_COUNT; k++) {
			const size = s2MeshSize(k);
			expect(size).toEqual(draws(mulberry32(100 + k), 3).map((v) => 0.5 + v) as typeof size);
			expect(everyValue(size, (v) => v >= 0.5 && v < 1.5)).toBe(true);
		}
	});

	test('turns each root at its own rate', () => {
		expect(s2RootRotation(0, 3)).toBe(0);
		expect(s2RootRotation(10, 0)).toBeCloseTo(2, 12);
		expect(s2RootRotation(10, 4)).toBeCloseTo(6, 12);
		expect(s2RootRotation(10, 5)).toBeCloseTo(2, 12);
	});

	test('orbits the camera at radius 110 and height 60', () => {
		const start = cameraAt(s2Camera, 0);
		expectClose(start.position, [110, 60, 0]);
		expectClose(start.target, [0, 0, 0]);
		const quarter = cameraAt(s2Camera, 15);
		expectClose(quarter.position, [0, 60, -110]);
		expectClose(quarter.target, [0, 0, 0]);
	});
});

describe('S3', () => {
	const n = 1000;
	const data = createS3(n);

	test('is the same for the same seed, and has the same lights for every box count', () => {
		expect(createS3(n)).toEqual(data);
		const other = createS3(10, 4);
		expect(other.base).not.toEqual(data.base.subarray(0, 20));
		expect(other.lightCenter).toEqual(data.lightCenter);
		expect(other.lightSpeed).toEqual(data.lightSpeed);
		expect(createS3(0).lightPhase).toEqual(data.lightPhase);
	});

	test('has one entry per box, two for positions, and one per light, two for centers', () => {
		expect(data.count).toBe(n);
		expect(data.base).toHaveLength(n * 2);
		expect(data.height).toHaveLength(n);
		expect(data.yaw).toHaveLength(n);
		expect(data.lightCenter).toHaveLength(S3_LIGHT_COUNT * 2);
		for (const values of [data.lightRadius, data.lightHeight, data.lightSpeed, data.lightPhase])
			expect(values).toHaveLength(256);
		expect(() => createS3(-1)).toThrow('S3 needs a whole number of instances');
	});

	test('draws offsets, height and turn box by box, and each light from a generator of its own', () => {
		const random = mulberry32(3);
		const { side, spacing, jitter } = s3Grid(n);
		expect([side, spacing]).toEqual([32, 6.25]);
		for (const i of [0, 1, 33]) {
			const [x, z, height, yaw] = draws(random, i === 33 ? 4 * 31 + 4 : 4).slice(-4) as [
				number,
				number,
				number,
				number,
			];
			const [column, row] = [i % side, Math.floor(i / side)];
			expect([data.base[i * 2], data.base[i * 2 + 1]]).toEqual([
				Math.fround(-S3_EXTENT + (column + 0.5) * spacing - jitter + 2 * jitter * x),
				Math.fround(-S3_EXTENT + (row + 0.5) * spacing - jitter + 2 * jitter * z),
			]);
			const { minHeight, maxHeight } = S3_BOX;
			expect(data.height[i]).toBe(Math.fround(minHeight + (maxHeight - minHeight) * height));
			expect(data.yaw[i]).toBe(Math.fround(yaw * TAU));
		}
		const lights = mulberry32(S3_LIGHT_SEED);
		const [x, z, radius, height, speed, direction, phase] = draws(lights, 7) as number[];
		const { minRadius, maxRadius, minHeight, maxHeight, minSpeed, maxSpeed } = S3_PATHS;
		expect([...data.lightCenter.subarray(0, 2)]).toEqual(
			[x, z].map((v) => Math.fround(-S3_EXTENT + 2 * S3_EXTENT * (v as number))),
		);
		expect(data.lightRadius[0]).toBe(Math.fround(minRadius + (maxRadius - minRadius) * radius!));
		expect(data.lightHeight[0]).toBe(Math.fround(minHeight + (maxHeight - minHeight) * height!));
		const rate = Math.fround(minSpeed + (maxSpeed - minSpeed) * speed!);
		expect(data.lightSpeed[0]).toBe(direction! < 0.5 ? -rate : rate);
		expect(data.lightPhase[0]).toBe(Math.fround(phase! * TAU));
	});

	test('keeps the boxes of the default count apart, each inside its own grid cell', () => {
		const boxes = createS3(S3_DEFAULT_COUNT);
		const { side, spacing, jitter } = s3Grid(S3_DEFAULT_COUNT);
		expect(side).toBe(142);
		expect(jitter).toBeGreaterThan(0.05);
		const reach = S3_BOX.width * Math.SQRT1_2;
		for (let i = 0; i < boxes.count; i++) {
			const [column, row] = [i % side, Math.floor(i / side)];
			const x = boxes.base[i * 2]! + S3_EXTENT - column * spacing;
			const z = boxes.base[i * 2 + 1]! + S3_EXTENT - row * spacing;
			if (x - reach <= 0 || x + reach >= spacing || z - reach <= 0 || z + reach >= spacing)
				throw new Error(`box ${i} reaches out of its cell`);
		}
	});

	test('keeps every value in its range, and turns about half the lights each way', () => {
		const big = createS3(100_000);
		const { minHeight, maxHeight } = S3_BOX;
		expect(everyValue(big.base, (v) => v >= -S3_EXTENT && v <= S3_EXTENT)).toBe(true);
		expect(everyValue(big.height, (v) => v >= minHeight && v <= maxHeight)).toBe(true);
		expect(everyValue(big.yaw, (v) => v >= 0 && v <= Math.fround(TAU))).toBe(true);
		const { minRadius, maxRadius, minSpeed, maxSpeed } = S3_PATHS;
		expect(everyValue(big.lightRadius, (v) => v >= minRadius && v <= maxRadius)).toBe(true);
		expect(
			everyValue(big.lightSpeed, (v) => Math.abs(v) >= minSpeed && Math.abs(v) <= maxSpeed),
		).toBe(true);
		const clockwise = [...big.lightSpeed].filter((v) => v < 0).length;
		expect(clockwise).toBeGreaterThan(96);
		expect(clockwise).toBeLessThan(160);
	});

	test('stands each box on the floor, turned about +Y and scaled to its width and height', () => {
		const position = [0, 0, 0];
		const quaternion = [0, 0, 0, 0];
		const scale = [0, 0, 0];
		for (let i = 0; i < 20; i++) {
			s3BoxAt(data, i, position, quaternion, scale);
			const height = data.height[i]!;
			expectClose(position, [data.base[i * 2]!, height / 2, data.base[i * 2 + 1]!]);
			const half = data.yaw[i]! / 2;
			expectClose(quaternion, [0, Math.sin(half), 0, Math.cos(half)]);
			expectClose(scale, [S3_BOX.width, height, S3_BOX.width]);
		}
	});

	test('turns the floor to face +Y, wide enough for every light path', () => {
		const normal = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...S3_FLOOR.rotation));
		expectClose(normal.toArray(), [0, 1, 0]);
		expect(S3_FLOOR.size / 2).toBeGreaterThanOrEqual(S3_EXTENT + S3_PATHS.maxRadius);
	});

	test('moves each light around its circle at its own rate and height', () => {
		const position = [0, 0, 0];
		for (let i = 0; i < S3_LIGHT_COUNT; i += 37) {
			const [cx, cz] = [data.lightCenter[i * 2]!, data.lightCenter[i * 2 + 1]!];
			for (const t of [0, 1, HOLD_TIME, 60]) {
				s3LightAt(data, i, t, position);
				const angle = data.lightSpeed[i]! * t + data.lightPhase[i]!;
				const r = data.lightRadius[i]!;
				expectClose(position, [
					cx + r * Math.cos(angle),
					data.lightHeight[i]!,
					cz + r * Math.sin(angle),
				]);
			}
		}
	});

	test('colors the lights from the palette in turn', () => {
		expect(s3LightColor(0)).toBe(S3_LIGHT_COLORS[0]);
		expect(s3LightColor(9)).toBe(S3_LIGHT_COLORS[1]);
		expect(new Set(Array.from({ length: S3_LIGHT_COUNT }, (_, i) => s3LightColor(i))).size).toBe(
			S3_LIGHT_COLORS.length,
		);
	});

	test('orbits the camera at radius 120 and height 50', () => {
		const start = cameraAt(s3Camera, 0);
		expectClose(start.position, [120, 50, 0]);
		expectClose(start.target, [0, 0, 0]);
		expectClose(cameraAt(s3Camera, 15).position, [0, 50, -120]);
	});
});
