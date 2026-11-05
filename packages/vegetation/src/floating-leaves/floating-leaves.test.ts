// The leaves that ride the wind: their places come from the scene's seed on every device, the two
// forms build the work that their names promise, and the state form's pass covers one texel for each
// leaf. The offset form costs no pass; the state form's pass steps the leaves and reads the field.
import { describe, expect, test } from 'bun:test';
import type { Camera, SketchContext } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import { createFloatingLeaves } from './floating-leaves';

/** A batch that keeps its arrays and its removal, as the engine's batch does. */
function batch(capacity: number) {
	return {
		count: capacity,
		positions: new Float32Array(capacity * 3),
		values: new Float32Array(capacity * 4),
		destroyed: false,
		markDirty() {},
		setFrustumCulled() {},
		destroy() {
			this.destroyed = true;
		},
	};
}

/** A field whose steady settings and newest layer the leaves read. */
const field = {
	texture: { layer: 2 },
	size: 96,
	origin: [0, 0],
	air: {
		base: [4, 0.6, 0.35, 7],
		gust: [7, 24, 0.2, 3],
		swirl: [1.4, 0.03, 0.05, 11],
		sent: [0, 0, 0, -1e9],
	},
} as unknown as WindField;

/** A sketch context that records the work that the leaves build, with no engine behind it. */
function context() {
	const made: ReturnType<typeof batch>[] = [];
	const materials: Record<string, unknown>[] = [];
	const passes: Record<string, unknown>[] = [];
	const uniforms: { pass: Record<string, unknown>; values: Float32Array }[] = [];
	const layers: number[] = [];
	const removed: Record<string, unknown>[] = [];
	const planes: Record<string, unknown>[] = [];
	const camera = {
		getPosition: (out: number[]) => {
			out[0] = 10;
			out[1] = 5;
			out[2] = -20;
		},
	} as unknown as Camera;
	const ctx = {
		materials: {
			shader: (options: Record<string, unknown>) => {
				materials.push(options);
				return {
					setUniform: (name: string, value: number) => {
						if (name === 'windLayer') layers.push(value);
					},
				};
			},
		},
		geometry: {
			plane: (options: Record<string, unknown>) => {
				planes.push(options);
				return {};
			},
		},
		scene: {
			createInstances: (_mesh: unknown, count: number) => {
				const b = batch(count);
				made.push(b);
				return b;
			},
		},
		textures: {
			fromData: (options: Record<string, unknown>) => ({
				kind: 'data',
				...options,
				update: () => undefined,
			}),
			fromPass: () => ({ kind: 'pass', layer: 0 }),
		},
		render: {
			addPass: (options: Record<string, unknown>) => {
				const pass = { kind: 'pass', ...options };
				passes.push(pass);
				return pass;
			},
			setPassUniforms: (pass: Record<string, unknown>, values: readonly number[]) => {
				uniforms.push({ pass, values: Float32Array.from(values) });
			},
			removePass: (pass: Record<string, unknown>) => {
				removed.push(pass);
			},
		},
	} as unknown as SketchContext;
	return { ctx, camera, made, materials, passes, uniforms, layers, removed, planes };
}

const area = { x: 0, z: 0, size: 32, high: 12, low: 0 };

describe('the leaves', () => {
	test('the offset form draws one batch and keeps no state', () => {
		const { ctx, camera, made, materials, passes, layers } = context();
		const leaves = createFloatingLeaves(ctx, {
			wind: field,
			camera,
			count: 500,
			area,
			ride: 'offset',
		});
		expect(leaves.ride).toBe('offset');
		expect(leaves.count).toBe(500);
		expect(leaves.state).toBeUndefined();
		expect(made.length).toBe(1);
		expect(made[0]?.count).toBe(500);
		expect(passes.length).toBe(0);
		expect(materials.length).toBe(1);
		const uniforms = materials[0]?.uniforms as Record<string, unknown>;
		expect(uniforms.windBox).toBe(96);
		expect(uniforms.fall).toBeGreaterThan(0);
		leaves.update();
		expect(layers).toEqual([2]);
		leaves.destroy();
		expect(made[0]?.destroyed).toBe(true);
	});

	test('the leaf quad takes no levels, because the shader places every leaf', () => {
		const { ctx, camera, planes } = context();
		createFloatingLeaves(ctx, { wind: field, camera, count: 8, area, ride: 'offset' });
		expect(planes.length).toBe(1);
		expect(planes[0]?.levels).toBe(false);
	});

	test('one seed puts every leaf in the same place on every device', () => {
		const a = context();
		const b = context();
		createFloatingLeaves(a.ctx, {
			wind: field,
			camera: a.camera,
			count: 64,
			area,
			seed: 5,
			ride: 'offset',
		});
		createFloatingLeaves(b.ctx, {
			wind: field,
			camera: b.camera,
			count: 64,
			area,
			seed: 5,
			ride: 'offset',
		});
		expect(a.made[0]?.positions).toEqual(b.made[0]?.positions);
	});

	test('the state form steps the leaves in a pass of one texel each', () => {
		for (const count of [500, 2000, 10000]) {
			const { ctx, camera, made, passes } = context();
			const leaves = createFloatingLeaves(ctx, {
				wind: field,
				camera,
				count,
				area,
				ride: 'state',
			});
			expect(leaves.ride).toBe('state');
			expect(leaves.state).toBeDefined();
			expect(made[0]?.count).toBe(count);
			const pass = passes[0] as Record<string, unknown>;
			expect(pass.history).toBe(true);
			expect(pass.format).toBe('rgba16float');
			const size = pass.size as [number, number];
			expect(size[0] * size[1]).toBeGreaterThanOrEqual(count);
			expect(size[0] * size[1] - count).toBeLessThan(size[0]);
			leaves.destroy();
		}
	});

	test('a frame gives the state pass the field layer, the camera and the step', () => {
		const { ctx, camera, uniforms } = context();
		const leaves = createFloatingLeaves(ctx, {
			wind: field,
			camera,
			count: 500,
			area,
			ride: 'state',
		});
		leaves.update(0.02);
		expect(uniforms.length).toBe(1);
		const values = uniforms[0]?.values as Float32Array;
		// The field's box follows the camera at the field's width, and the leaves' box at their own.
		expect(values[12]).toBe(10 - 48);
		expect(values[13]).toBe(-20 - 48);
		expect(values[14]).toBe(96);
		expect(values[15]).toBe(2);
		expect(values[16]).toBe(12);
		expect(values[17]).toBe(0);
		expect(values[21]).toBeCloseTo(0.02, 6);
		expect(values[24]).toBe(10 - 16);
		expect(values[25]).toBe(-20 - 16);
		expect(values[26]).toBe(32);
	});
});
