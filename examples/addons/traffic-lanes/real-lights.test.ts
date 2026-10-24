// The real-light switch: the option lights the cars nearest the camera, and the scene pays nothing
// for it when the option is off.
import { expect, test } from 'bun:test';
import type { MeshGeometry, QualityPreset, SketchContext } from '@null3d/engine';
import { createTrafficLanes, type LanePlan } from './index';

/** A batch that the add-on builds, with the arrays it writes and the count it draws. */
interface FakeBatch {
	positions: Float32Array;
	rotations: Float32Array;
	scales: Float32Array;
	values: Float32Array;
	active: number;
	destroyed: boolean;
	markDirty(): void;
	setBoundingRadius(): void;
	setActiveCount(count: number): void;
	destroy(): void;
}

/** A point light that the add-on builds. */
interface FakeLight {
	position: number[];
	intensity: number;
	destroyed: boolean;
	setPosition(x: number, y: number, z: number): void;
	setIntensity(value: number): void;
	destroy(): void;
}

/** A sketch context that records the batches, the heads and the point lights the add-on builds. */
function record(): {
	ctx: SketchContext;
	batches: FakeBatch[];
	headings: number[];
	lights: FakeLight[];
} {
	const batches: FakeBatch[] = [];
	const headings: number[] = [];
	const lights: FakeLight[] = [];
	const ctx = {
		materials: {
			shader: (options: { uniforms?: { heading?: number } }) => {
				headings.push(options.uniforms?.heading ?? 0);
				return { destroy() {} };
			},
		},
		scene: {
			createInstances: (_mesh: MeshGeometry, count: number) => {
				const batch: FakeBatch = {
					positions: new Float32Array(count * 3),
					rotations: new Float32Array(count * 4),
					scales: new Float32Array(count * 3),
					values: new Float32Array(count * 4),
					active: count,
					destroyed: false,
					markDirty() {},
					setBoundingRadius() {},
					setActiveCount(active) {
						batch.active = active;
					},
					destroy() {
						batch.destroyed = true;
					},
				};
				batches.push(batch);
				return batch;
			},
			createPointLight: (options: { position: readonly number[]; intensity: number }) => {
				const light: FakeLight = {
					position: [options.position[0] ?? 0, options.position[1] ?? 0, options.position[2] ?? 0],
					intensity: options.intensity,
					destroyed: false,
					setPosition(x, y, z) {
						light.position = [x, y, z];
					},
					setIntensity(value) {
						light.intensity = value;
					},
					destroy() {
						light.destroyed = true;
					},
				};
				lights.push(light);
				return light;
			},
		},
	} as unknown as SketchContext;
	return { ctx, batches, headings, lights };
}

/** The plan that the tests draw: short lanes, so every car sits near the eye. */
const PLAN: LanePlan = { lines: [0], from: 0, to: 40, low: 20, high: 20, levels: 1, offset: 0 };

/** Eight cars, two of each heading. */
const COUNTS = { low: 8, medium: 8, high: 8, ultra: 8 } as Record<QualityPreset, number>;

/** The mesh is the scene's to build; the recorded batches ignore it. */
const MESH = {} as MeshGeometry;

/** The place of every drawn car at `time`, as the vertex shader moves it. */
function carPlaces(
	batches: readonly FakeBatch[],
	headings: readonly number[],
	time: number,
): number[][] {
	const places: number[][] = [];
	for (let b = 0; b < batches.length; b++) {
		const batch = batches[b] as FakeBatch;
		const yaw = headings[b] as number;
		const alongX = Math.sin(yaw);
		const alongZ = Math.cos(yaw);
		for (let k = 0; k < batch.active; k++) {
			const lane = batch.values[k * 4 + 2] as number;
			const travelled =
				(batch.values[k * 4] as number) + time * (batch.values[k * 4 + 1] as number);
			const at = travelled - lane * Math.floor(travelled / lane);
			places.push([
				(batch.positions[k * 3] as number) + alongX * at,
				batch.positions[k * 3 + 1] as number,
				(batch.positions[k * 3 + 2] as number) + alongZ * at,
			]);
		}
	}
	return places;
}

/** The squared distance between two places. */
const gap = (a: readonly number[], b: readonly number[]): number =>
	((a[0] as number) - (b[0] as number)) ** 2 +
	((a[1] as number) - (b[1] as number)) ** 2 +
	((a[2] as number) - (b[2] as number)) ** 2;

test('the option lights the cars nearest the camera', () => {
	const { ctx, batches, headings, lights } = record();
	const traffic = createTrafficLanes(ctx, {
		mesh: MESH,
		plan: PLAN,
		counts: COUNTS,
		realLights: 2,
	});
	expect(lights.length).toBe(2);
	const eye = [20, 20, 20];
	const time = 0.7;
	traffic.update(eye, time);
	// The nearest drawn cars, from every batch, nearest first.
	const nearest = carPlaces(batches, headings, time)
		.sort((a, b) => gap(a, eye) - gap(b, eye))
		.slice(0, 2);
	// The pool's slots are unsorted: with one light per nearest car, both nearest cars are covered.
	const places = lights.map((light) => light.position);
	for (const near of nearest) {
		expect(places.some((place) => gap(place, near) < 1e-3)).toBe(true);
	}
	for (const light of lights) expect(light.intensity).toBeGreaterThan(0);
	traffic.dispose();
});

test('the real-light switch lights nobody when it is off', () => {
	const { ctx, lights } = record();
	const traffic = createTrafficLanes(ctx, { mesh: MESH, plan: PLAN, counts: COUNTS });
	expect(lights.length).toBe(0);
	for (const time of [0, 0.1, 1, 10]) traffic.update([20, 20, 20], time);
	expect(lights.length).toBe(0);
	traffic.dispose();
});
