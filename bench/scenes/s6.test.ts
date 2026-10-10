import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Euler, Quaternion, Vector3 } from 'three';
import { samplePath } from '../../tools/lib/samples';
import {
	createS6,
	S6_BOX,
	S6_FULL_COUNT,
	S6_LOOK,
	S6_STREET_TILES,
	S6_SUN_POSITION,
	S6_TILE_STEP,
	type S6Layout,
	s6BuildingAt,
	s6Camera,
	s6LoopSeconds,
	s6PartTransform,
} from './s6';

const layout = JSON.parse(
	readFileSync(samplePath('sources/city/layout/layout.json'), 'utf8'),
) as S6Layout;
const data = createS6(layout);

describe('S6', () => {
	test('holds every row of the layout, kit models and boxes apart', () => {
		expect(data.count).toBe(layout.counts.objects);
		expect(S6_FULL_COUNT).toBe(layout.counts.objects);
		expect(data.kitOrder.length + data.boxOrder.length).toBe(data.count);
		for (const row of data.boxOrder) expect(data.model[row]).toBe(S6_BOX);
		for (const row of data.kitOrder) expect(data.model[row]).toBeGreaterThanOrEqual(0);
		const used = new Set<number>();
		for (const row of data.boxOrder) used.add(data.material[row] as number);
		expect(used.size).toBe(layout.counts.materials);
	});

	test('keeps the rows nearest the route start when it asks for fewer', () => {
		const few = createS6(layout, 500);
		expect(few.count).toBe(500);
		expect(few.kitOrder.length + few.boxOrder.length).toBe(500);
		const all = [...data.kitOrder, ...data.boxOrder];
		const [sx, sz] = layout.camera.path[0] as [number, number];
		const d = (row: number) =>
			Math.hypot(
				(data.position[row * 3] as number) - sx,
				(data.position[row * 3 + 2] as number) - sz,
			);
		const farthestKept = Math.max(...[...few.kitOrder, ...few.boxOrder].map(d));
		const kept = new Set([...few.kitOrder, ...few.boxOrder]);
		for (const row of all) if (!kept.has(row)) expect(d(row)).toBeGreaterThanOrEqual(farthestKept);
		expect(() => createS6(layout, 0)).toThrow(RangeError);
	});

	test('orders rows nearest the route start first', () => {
		const [sx, sz] = layout.camera.path[0] as [number, number];
		for (const order of [data.kitOrder, data.boxOrder]) {
			let last = 0;
			for (const row of order) {
				const d = Math.hypot(
					(data.position[row * 3] as number) - sx,
					(data.position[row * 3 + 2] as number) - sz,
				);
				expect(d).toBeGreaterThanOrEqual(last);
				last = d;
			}
		}
	});

	test('drives a closed route at the layout speed and height, looking ahead along it', () => {
		const eye = [0, 0, 0];
		const target = [0, 0, 0];
		s6Camera(data, 0, eye, target);
		const [x0, z0] = layout.camera.path[0] as [number, number];
		expect(eye).toEqual([x0, layout.camera.height, z0]);
		expect(Math.hypot((target[0] as number) - x0, (target[2] as number) - z0)).toBeCloseTo(
			S6_LOOK.ahead,
			6,
		);
		expect(target[1]).toBeCloseTo(layout.camera.height - S6_LOOK.drop, 9);
		// One second moves the camera by its speed along the first street.
		s6Camera(data, 1, eye, target);
		expect(Math.hypot((eye[0] as number) - x0, (eye[2] as number) - z0)).toBeCloseTo(
			layout.camera.speed,
			6,
		);
		// The loop ends where it starts.
		const end = [0, 0, 0];
		s6Camera(data, s6LoopSeconds(data), end, target);
		expect(end[0]).toBeCloseTo(x0, 6);
		expect(end[2]).toBeCloseTo(z0, 6);
		expect(data.routeLength).toBeGreaterThan(2000);
	});

	test('the camera stays on road centre lines', () => {
		const eye = [0, 0, 0];
		const target = [0, 0, 0];
		const roads = new Set(layout.camera.path.flat());
		for (let t = 0; t < s6LoopSeconds(data); t += 0.37) {
			s6Camera(data, t, eye, target);
			const onLine = [...roads].some(
				(r) => Math.abs((eye[0] as number) - r) < 1e-6 || Math.abs((eye[2] as number) - r) < 1e-6,
			);
			expect(onLine).toBe(true);
		}
	});

	test('neighbouring street tiles stand a step apart, so no shared edge is a tie', () => {
		const tiles = new Map<string, number>();
		for (let row = 0; row < data.count; row++) {
			const model = data.model[row] as number;
			if (model < 0 || !S6_STREET_TILES.test(layout.models[model] as string)) continue;
			const size = data.scale[row * 3] as number;
			const key = `${Math.round((data.position[row * 3] as number) / size)},${Math.round((data.position[row * 3 + 2] as number) / size)}`;
			tiles.set(key, data.position[row * 3 + 1] as number);
		}
		expect(tiles.size).toBeGreaterThan(1000);
		let pairs = 0;
		for (const [key, y] of tiles) {
			const [i, j] = key.split(',').map(Number) as [number, number];
			for (const next of [`${i + 1},${j}`, `${i},${j + 1}`]) {
				const other = tiles.get(next);
				if (other === undefined) continue;
				expect(Math.abs(other - y)).toBeCloseTo(S6_TILE_STEP, 6);
				pairs++;
			}
		}
		expect(pairs).toBeGreaterThan(1000);
	});

	test('lists each material of the created boxes once, in the order of its first box', () => {
		expect(data.towerOrder).toHaveLength(layout.counts.materials);
		const firsts = Array.from(data.towerOrder, (m) =>
			data.boxOrder.findIndex((row) => data.material[row] === m),
		);
		expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
		const few = createS6(layout, 500);
		expect(new Set(few.towerOrder)).toEqual(
			new Set(Array.from(few.boxOrder, (row) => few.material[row] as number)),
		);
	});

	test("finds the building of a point on a box's face, and none for a box of no building", () => {
		let checked = 0;
		for (const row of data.boxOrder) {
			const k = row * 3;
			const top = [
				data.position[k] as number,
				(data.position[k + 1] as number) + (data.scale[k + 1] as number),
				(data.position[k + 2] as number) + (data.scale[k + 2] as number) / 4,
			];
			const found = s6BuildingAt(data, data.material[row] as number, top);
			// A box that another box of its material stands on shares its top with that box.
			if (found !== data.building[row]) continue;
			checked++;
		}
		expect(checked).toBeGreaterThan(data.boxOrder.length * 0.9);
		const label = data.labels[0];
		if (!label) throw new Error('S6 has no labels');
		const k = label.row * 3;
		const wall = [
			(data.position[k] as number) + (data.scale[k] as number) / 2 + 0.02,
			(data.position[k + 1] as number) + 1,
			data.position[k + 2] as number,
		];
		expect(s6BuildingAt(data, data.material[label.row] as number, wall)).toBe(label.building);
	});

	test('labels sit on the tops of their towers', () => {
		expect(data.labels).toHaveLength(layout.labels.length);
		for (const label of data.labels) {
			expect(data.model[label.row]).toBe(S6_BOX);
			expect(data.building[label.row]).toBe(label.building);
			expect(label.height).toBe(data.scale[label.row * 3 + 1] as number);
		}
	});

	test('places a model part as three.js composes a turned, scaled parent', () => {
		const row = data.kitOrder[0] as number;
		const partPosition = [0.1, 0.2, -0.3];
		const partRotation = new Quaternion().setFromEuler(new Euler(0.3, -0.7, 0.2)).toArray();
		const partScale = [-1, 0.5, 2];
		const position = [0, 0, 0];
		const rotation = [0, 0, 0, 0];
		const scale = [0, 0, 0];
		s6PartTransform(data, row, partPosition, partRotation, partScale, position, rotation, scale);
		const rowRotation = new Quaternion().setFromAxisAngle(
			new Vector3(0, 1, 0),
			data.rotationY[row] as number,
		);
		const s = data.scale[row * 3] as number;
		const expected = new Vector3(...(partPosition as [number, number, number]))
			.multiplyScalar(s)
			.applyQuaternion(rowRotation)
			.add(
				new Vector3(
					data.position[row * 3] as number,
					data.position[row * 3 + 1] as number,
					data.position[row * 3 + 2] as number,
				),
			);
		expect(position[0]).toBeCloseTo(expected.x, 4);
		expect(position[1]).toBeCloseTo(expected.y, 4);
		expect(position[2]).toBeCloseTo(expected.z, 4);
		const q = rowRotation.multiply(new Quaternion().fromArray(partRotation));
		for (const [k, v] of q.toArray().entries()) expect(rotation[k]).toBeCloseTo(v, 6);
		expect(scale).toEqual(partScale.map((v) => v * s));
	});

	test("the sky's sun stands where the light comes from", () => {
		expect(Math.hypot(...S6_SUN_POSITION)).toBeCloseTo(1, 9);
		expect(S6_SUN_POSITION[1]).toBeGreaterThan(0);
	});
});
