// The draw adapter of the feature description: the checks that it refuses a feature it cannot
// place, the sort place that it maps from the band and order, the objects that it makes and frees,
// and the instance batch of a draw that repeats its shape. The test uses stand-ins for the geometry,
// material, object and batch makers, so it reads no GPU and ships nothing.
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
	const batches: unknown[] = [];
	const batch = {
		count: 4,
		destroy: () => calls.push('batch.destroy'),
		setActiveCount: (count: number) => calls.push(`setActiveCount:${count}`),
	};
	const shaders: unknown[] = [];
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
			expect(options.material).toBe(material as never);
			batches.push({ count, ...options });
			return batch as never;
		},
		fail: (detail) => {
			calls.push('fail');
			return new Error(`E1223: ${detail}`);
		},
	};
	return { host, calls, orders, shaders, material, mesh, object, batches, batch };
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
	it('makes the material, the shape and the batch with the rows that the options ask for', () => {
		const { host, calls, shaders, batches } = standIns();
		const made = createFeatureInstances(
			draw({ frame: 'transparent' }),
			{
				shader: WGSL,
				vertices: VERTICES,
				instances: 40,
				rows: { colors: true, values: true, dynamic: true },
				origin: [10, 0, 0],
				uniforms: { size: 1 },
			},
			host,
		);
		expect(calls).toEqual(['shader', 'fromArrays', 'createInstances']);
		expect(made.name).toBe('cloud');
		expect(made.count).toBe(4);
		expect(shaders[0]).toMatchObject({ wgsl: 'wgsl', alphaMode: 'blend', uniforms: { size: 1 } });
		expect(batches[0]).toMatchObject({
			count: 40,
			colors: true,
			values: true,
			dynamic: true,
			origin: [10, 0, 0],
		});
	});

	it('draws only the first rows when the add-on asks for fewer copies', () => {
		const { host, calls } = standIns();
		const made = createFeatureInstances(
			draw(),
			{ shader: WGSL, vertices: VERTICES, instances: 4 },
			host,
		);
		calls.length = 0;
		made.setCount(2);
		expect(calls).toEqual(['setActiveCount:2']);
	});

	it('refuses a place that belongs to one object', () => {
		const { host } = standIns();
		expect(() =>
			createFeatureInstances(
				draw(),
				{ shader: WGSL, vertices: VERTICES, instances: 4, position: [1, 0, 0] },
				host,
			),
		).toThrow('E1223');
	});

	it('refuses a count that is not a whole number from 1 up', () => {
		const { host } = standIns();
		for (const instances of [0, -1, 2.5, Number.NaN])
			expect(() =>
				createFeatureInstances(draw(), { shader: WGSL, vertices: VERTICES, instances }, host),
			).toThrow('E1223');
	});

	it('frees the batch, the material and the shape', () => {
		const { host, calls } = standIns();
		const made = createFeatureInstances(
			draw(),
			{ shader: WGSL, vertices: VERTICES, instances: 4 },
			host,
		);
		calls.length = 0;
		made.destroy();
		expect(calls).toEqual(['batch.destroy', 'material.destroy', 'mesh.destroy']);
	});
});
