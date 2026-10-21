// The draw adapter of the feature description: the checks that it refuses a feature it cannot
// place, the sort place that it maps from the band and order, and the objects that it makes and
// frees. The test uses stand-ins for the geometry, material and object makers, so it reads no GPU
// and ships nothing.
import { describe, expect, it } from 'bun:test';
import { createFeatureDraw, type FeatureDrawHost } from './feature-draws';
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
		fail: (detail) => {
			calls.push('fail');
			return new Error(`E1223: ${detail}`);
		},
	};
	return { host, calls, orders, shaders, material, mesh, object };
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
