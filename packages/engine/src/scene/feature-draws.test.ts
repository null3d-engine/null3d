// The draw adapter of the feature description: the checks that it refuses a feature it cannot
// place, the sort place that it maps from the band and order, and the objects that it makes and
// frees. The test uses stand-ins for the geometry, material and object makers, so it reads no GPU
// and ships nothing.
import { describe, expect, it } from 'bun:test';
import { createFeatureDraw, createFeatureInstances, type FeatureDrawHost } from './feature-draws';
import { defineFeature, type FeatureDescription } from './features';

/** The vertex data of one square, which a stand-in geometry accepts. */
const VERTICES = { positions: new Float32Array([0, 0, 0]) };

/** The WGSL of the stand-in, as plain text so that a uniform of any name fits its type. */
const WGSL: string = 'wgsl';

/** A host of stand-in makers that records each call, with the objects that it hands out. */
function standIns() {
	const calls: string[] = [];
	const material = {
		destroy: () => calls.push('material.destroy'),
		set: () => {},
		setUniform: () => {},
	};
	const mesh = {
		destroy: () => calls.push('mesh.destroy'),
		updateVertices: () => {},
	};
	const orders: number[] = [];
	const object = {
		destroy: () => calls.push('object.destroy'),
		setVisible: () => {},
		setRenderOrder: (order: number) => orders.push(order),
	};
	const shaders: unknown[] = [];
	/** The instance batches that the host made, with the options that made each one. */
	const instances: { mesh: unknown; count: number; options: Record<string, unknown> }[] = [];
	const batch = {
		count: 0,
		positions: new Float32Array(12),
		rotations: new Float32Array(16),
		scales: new Float32Array(12),
		colors: undefined as Float32Array | undefined,
		values: undefined as Float32Array | undefined,
		setActiveCount: (count: number) => calls.push(`active ${count}`),
		markDirty: (start: number, count: number) => calls.push(`dirty ${start} ${count}`),
		setRenderOrder: (order: number) => orders.push(order),
		setLayers: () => {},
		setCastShadows: () => {},
		setReceiveShadows: () => {},
		setBoundingRadius: () => {},
		destroy: () => calls.push('batch.destroy'),
	};
	const host: FeatureDrawHost = {
		geometry: {
			fromArrays: () => {
				calls.push('fromArrays');
				return mesh;
			},
		} as unknown as FeatureDrawHost['geometry'],
		materials: {
			shader: (options: unknown) => {
				calls.push('shader');
				shaders.push(options);
				return material;
			},
		} as unknown as FeatureDrawHost['materials'],
		createMesh: (drawn, look, place) => {
			calls.push('createMesh');
			expect(drawn).toBe(mesh as never);
			expect(look).toBe(material as never);
			expect(place.name).toBe('cloud');
			return object as never;
		},
		createInstances: (drawn, count, options) => {
			calls.push('createInstances');
			expect(drawn).toBe(mesh as never);
			instances.push({
				mesh: drawn,
				count,
				options: options as unknown as Record<string, unknown>,
			});
			batch.count = count;
			return batch as never;
		},
		fail: (detail) => {
			calls.push('fail');
			return new Error(`E1223: ${detail}`);
		},
	};
	return { host, calls, orders, shaders, instances, material, mesh, object, batch };
}

/** A minimal draw description. */
function draw(overrides: Partial<FeatureDescription> = {}): FeatureDescription {
	return defineFeature({
		name: 'cloud',
		frame: 'opaque',
		kind: 'draw',
		...overrides,
	});
}

describe('createFeatureDraw', () => {
	it('makes the mesh, the material and the object from the options', () => {
		const { host, calls, shaders } = standIns();
		const made = createFeatureDraw(
			draw(),
			{ shader: WGSL, vertices: VERTICES, uniforms: { size: 1 } },
			host,
		);
		expect(calls).toEqual(['shader', 'fromArrays', 'createMesh']);
		expect(made.name).toBe('cloud');
		expect(shaders[0]).toMatchObject({
			wgsl: 'wgsl',
			uniforms: { size: 1 },
			alphaMode: 'opaque',
		});
	});

	it('draws a transparent description with a blended material', () => {
		const { host, shaders } = standIns();
		createFeatureDraw(draw({ frame: 'transparent' }), { shader: WGSL, vertices: VERTICES }, host);
		expect(shaders[0]).toMatchObject({ alphaMode: 'blend' });
	});

	it('turns the vertex colours on when the vertices have colours', () => {
		const { host, shaders } = standIns();
		createFeatureDraw(
			draw(),
			{ shader: WGSL, vertices: { ...VERTICES, colors: new Float32Array([1, 1, 1, 1]) } },
			host,
		);
		expect(shaders[0]).toMatchObject({ vertexColors: true });
	});

	it('keeps the vertex colours off when the vertices have none', () => {
		const { host, shaders } = standIns();
		createFeatureDraw(draw(), { shader: WGSL, vertices: VERTICES }, host);
		expect(shaders[0]).toMatchObject({ vertexColors: false });
	});

	it('places each band and order in the blended pass', () => {
		const cases: readonly [Partial<FeatureDescription>, number][] = [
			[{ band: 'before', order: -2 }, -2_097_154],
			[{ band: 'normal', order: 7 }, 7],
			[{ band: 'after', order: 1_048_576 }, 3_145_728],
		];
		for (const [overrides, expected] of cases) {
			const { host, orders } = standIns();
			createFeatureDraw(
				draw({ frame: 'transparent', ...overrides }),
				{ shader: WGSL, vertices: VERTICES },
				host,
			);
			expect(orders).toEqual([expected]);
		}
	});

	it('refuses a feature that is not a draw', () => {
		const { host } = standIns();
		const compute = defineFeature({ name: 'cloud', frame: 'resolve', kind: 'fullscreen' });
		expect(() => createFeatureDraw(compute, { shader: WGSL, vertices: VERTICES }, host)).toThrow(
			/kind "fullscreen"|kind 'fullscreen'|kind/,
		);
	});

	it('refuses a frame point that it does not place', () => {
		const { host } = standIns();
		const background = draw({ frame: 'background' });
		expect(() => createFeatureDraw(background, { shader: WGSL, vertices: VERTICES }, host)).toThrow(
			'E1223',
		);
	});

	it('refuses a view that it does not place', () => {
		const { host } = standIns();
		const reflected = draw({ views: ['reflection'] });
		expect(() => createFeatureDraw(reflected, { shader: WGSL, vertices: VERTICES }, host)).toThrow(
			'E1223',
		);
	});

	it('refuses an alpha mode that draws in the other pass', () => {
		const { host } = standIns();
		expect(() =>
			createFeatureDraw(
				draw({ frame: 'transparent' }),
				{ shader: WGSL, vertices: VERTICES, alphaMode: 'opaque' },
				host,
			),
		).toThrow('E1223');
		expect(() =>
			createFeatureDraw(
				draw({ frame: 'opaque' }),
				{ shader: WGSL, vertices: VERTICES, alphaMode: 'blend' },
				host,
			),
		).toThrow('E1223');
	});

	it('frees the object, the material and the vertices', () => {
		const { host, calls } = standIns();
		const made = createFeatureDraw(draw(), { shader: WGSL, vertices: VERTICES }, host);
		calls.length = 0;
		made.destroy();
		expect(calls).toEqual(['object.destroy', 'material.destroy', 'mesh.destroy']);
	});
});

describe('createFeatureInstances', () => {
	it('makes the mesh, the material and the batch from the options', () => {
		const { host, calls, shaders, instances } = standIns();
		const made = createFeatureInstances(
			draw(),
			{
				shader: WGSL,
				vertices: VERTICES,
				capacity: 12,
				dynamic: true,
				colors: true,
				values: true,
				uniforms: { size: 1 },
			},
			host,
		);
		expect(calls).toEqual(['shader', 'fromArrays', 'createInstances']);
		expect(made.name).toBe('cloud');
		expect(made.count).toBe(12);
		expect(shaders[0]).toMatchObject({
			wgsl: 'wgsl',
			uniforms: { size: 1 },
			alphaMode: 'opaque',
		});
		expect(instances[0]).toMatchObject({
			count: 12,
			options: { dynamic: true, colors: true, values: true },
		});
	});

	it('draws a transparent description with a blended material', () => {
		const { host, shaders } = standIns();
		createFeatureInstances(
			draw({ frame: 'transparent' }),
			{ shader: WGSL, vertices: VERTICES, capacity: 4 },
			host,
		);
		expect(shaders[0]).toMatchObject({ alphaMode: 'blend' });
	});

	it('places each band and order on the batch', () => {
		const cases: readonly [Partial<FeatureDescription>, number][] = [
			[{ band: 'before', order: -2 }, -2_097_154],
			[{ band: 'normal', order: 7 }, 7],
			[{ band: 'after', order: 1_048_576 }, 3_145_728],
		];
		for (const [overrides, expected] of cases) {
			const { host, orders } = standIns();
			createFeatureInstances(
				draw({ frame: 'transparent', ...overrides }),
				{ shader: WGSL, vertices: VERTICES, capacity: 4 },
				host,
			);
			expect(orders).toEqual([expected]);
		}
	});

	it('passes the draw calls to the batch', () => {
		const { host, calls, batch } = standIns();
		const made = createFeatureInstances(
			draw(),
			{ shader: WGSL, vertices: VERTICES, capacity: 8 },
			host,
		);
		expect(made.positions).toBe(batch.positions);
		expect(made.rotations).toBe(batch.rotations);
		expect(made.scales).toBe(batch.scales);
		calls.length = 0;
		made.setActiveCount(3);
		made.markDirty();
		expect(calls).toEqual(['active 3', 'dirty 0 8']);
	});

	it('refuses a description that it cannot place', () => {
		const { host } = standIns();
		const compute = defineFeature({ name: 'cloud', frame: 'resolve', kind: 'fullscreen' });
		expect(() =>
			createFeatureInstances(compute, { shader: WGSL, vertices: VERTICES, capacity: 4 }, host),
		).toThrow('E1223');
		expect(() =>
			createFeatureInstances(
				draw({ views: ['reflection'] }),
				{ shader: WGSL, vertices: VERTICES, capacity: 4 },
				host,
			),
		).toThrow('E1223');
		expect(() =>
			createFeatureInstances(
				draw({ frame: 'transparent' }),
				{ shader: WGSL, vertices: VERTICES, capacity: 4, alphaMode: 'opaque' },
				host,
			),
		).toThrow('E1223');
	});

	it('frees the batch, the material and the shape', () => {
		const { host, calls } = standIns();
		const made = createFeatureInstances(
			draw(),
			{ shader: WGSL, vertices: VERTICES, capacity: 4 },
			host,
		);
		calls.length = 0;
		made.destroy();
		expect(calls).toEqual(['batch.destroy', 'material.destroy', 'mesh.destroy']);
	});
});
