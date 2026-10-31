// The grass's placement and tuft shape: one seed places the same tufts on every device, steep
// ground is left bare, a tuft's blades have the shape the mesh takes, and a preset draws its share.
import { describe, expect, test } from 'bun:test';
import type { QualityPreset, SketchContext } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import { createGrass, placeTufts, tuftMesh } from './grass';

/** A place that accepts every tuft: a flat ground. */
const flat = () => 1;
/** A place that refuses every tuft: a slope of two, steeper than the option allows. */
const steep = (x: number) => x * 2;
/** The options of a small field. */
const field = { height: flat, area: { x: 0, z: 0, size: 10 }, count: 100, seed: 3 };

describe('the grass placement', () => {
	test('one seed places the same tufts, and another seed places others', () => {
		const a = placeTufts(field, 0, 100);
		const b = placeTufts(field, 0, 100);
		const c = placeTufts({ ...field, seed: 4 }, 0, 100);
		expect(a).toEqual(b);
		expect(a).not.toEqual(c);
		expect(a.length).toBe(100);
	});

	test('a tuft stands on the ground, inside the area, with its traits in range', () => {
		const tufts = placeTufts(field, 0, 100);
		for (const tuft of tufts) {
			expect(tuft.y).toBeCloseTo(1 - 0.02, 5);
			expect(Math.abs(tuft.x)).toBeLessThanOrEqual(5);
			expect(Math.abs(tuft.z)).toBeLessThanOrEqual(5);
			expect(tuft.turn).toBeGreaterThanOrEqual(0);
			expect(tuft.turn).toBeLessThan(Math.PI * 2 + 1e-9);
			expect(tuft.size).toBeGreaterThanOrEqual(0.75);
			expect(tuft.size).toBeLessThanOrEqual(1.35);
			expect(tuft.tint).toBeGreaterThanOrEqual(0);
			expect(tuft.tint).toBeLessThanOrEqual(1);
		}
	});

	test('steep ground grows no tufts', () => {
		expect(placeTufts({ ...field, height: steep }, 0, 100).length).toBe(0);
	});
});

describe('the tuft mesh', () => {
	test('a tuft holds the blades and segments that it was asked for', () => {
		const blades = 2;
		const segments = 3;
		const perBlade = segments * 2 + 1;
		const mesh = tuftMesh(7, blades, segments);
		expect(mesh.positions.length).toBe(blades * perBlade * 3);
		expect(mesh.normals.length).toBe(blades * perBlade * 3);
		expect(mesh.colors?.length).toBe(blades * perBlade * 3);
		// Two quads and a tip triangle for each blade.
		expect(mesh.indices.length).toBe(blades * (2 * 6 + 3));
		for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
	});

	test('one seed grows the same tuft', () => {
		expect(tuftMesh(7, 3, 3)).toEqual(tuftMesh(7, 3, 3));
		expect(tuftMesh(7, 3, 3)).not.toEqual(tuftMesh(8, 3, 3));
	});
});

describe('the grass batches', () => {
	/** A batch that keeps its arrays and its active count, as the engine's batch does. */
	function batch(capacity: number) {
		return {
			count: capacity,
			positions: new Float32Array(capacity * 3),
			rotations: new Float32Array(capacity * 4),
			scales: new Float32Array(capacity * 3),
			values: new Float32Array(capacity * 4),
			active: capacity,
			setActiveCount(count: number) {
				this.active = count;
			},
			markDirty() {},
		};
	}

	/** A sketch context that makes batches and a material, with no engine behind it. */
	function context(preset: QualityPreset) {
		const made: ReturnType<typeof batch>[] = [];
		const materials: Record<string, unknown>[] = [];
		const uploads: Record<string, unknown>[] = [];
		const layers: number[] = [];
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
			geometry: { fromArrays: (arrays: unknown) => arrays },
			scene: {
				createInstances: (_mesh: unknown, count: number) => {
					const b = batch(count);
					made.push(b);
					return b;
				},
			},
			textures: {
				fromData: (options: Record<string, unknown>) => {
					uploads.push(options);
					return {};
				},
			},
			quality: { preset, onChange: () => () => {} },
		} as unknown as SketchContext;
		return { ctx, made, materials, uploads, layers };
	}

	test('the High count fills the hill and each preset draws its share', () => {
		const { ctx, made } = context('high');
		const grass = createGrass(ctx, field);
		expect(grass.batches.length).toBe(1);
		const b = made[0] as ReturnType<typeof batch>;
		// The capacity also holds Ultra's extra quarter.
		expect(b.count).toBe(125);
		expect(b.active).toBe(100);
		expect(b.positions[1]).toBeCloseTo(1 - 0.02, 5);
		for (let row = 0; row < b.count; row++)
			expect(Number.isFinite(b.positions[row * 3 + 1] as number)).toBe(true);
		grass.fit('low');
		expect(b.active).toBe(35);
		grass.fit('medium');
		expect(b.active).toBe(60);
		grass.fit('ultra');
		expect(b.active).toBe(125);
	});
	test('the grass reads the field it is given, and takes its newest layer', () => {
		const { ctx, materials, uploads, layers } = context('high');
		const air = {
			base: [2, 0.5, 0.3, 7],
			gust: [1, 10, 0.4, 8],
			swirl: [0.5, 20, 0.1, 0],
		};
		const wind = {
			texture: { layer: 3 },
			origin: [0, 0],
			size: 128,
			air,
		} as unknown as WindField;
		const grass = createGrass(ctx, { ...field, wind });
		const options = materials[0] as {
			uniforms: { windStrength: number; windBox: number };
			textures: { wind: unknown };
		};
		expect(options.uniforms.windStrength).toBe(1);
		expect(options.uniforms.windBox).toBe(128);
		expect(options.textures.wind).toBe(wind.texture);
		// The air's three vectors travel as the reading texture the shader samples. The texture
		// holds them as 16-bit floats, so the test rounds the expected values the same way.
		const reading = uploads.find((upload) => upload.width === 3);
		const data = (reading?.data ?? new Float32Array()) as Float32Array;
		expect([...data]).toEqual([...new Float32Array([...air.base, ...air.gust, ...air.swirl])]);
		grass.setWindLayer(wind);
		expect(layers).toEqual([3]);
	});
	test('the grass that names no field binds the slots and stands still', () => {
		const { ctx, materials, uploads } = context('high');
		createGrass(ctx, field);
		const options = materials[0] as {
			uniforms: { windStrength: number; windBox: number };
			textures: Record<string, unknown>;
		};
		expect(options.uniforms.windStrength).toBe(0);
		expect(options.uniforms.windBox).toBe(0);
		// A tiny still texture for the field and its settings, so both GPU paths bind the same
		// shapes whether or not a page gives a field.
		expect(uploads.map((upload) => upload.width)).toEqual([1, 1]);
		expect(Object.keys(options.textures).sort()).toEqual(['airSettings', 'wind']);
	});
});
