// The grass's placement and tuft shape: one seed places the same tufts on every device, steep
// ground is left bare, a tuft's blades have the shape the mesh takes, and a preset draws its share.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { QualityPreset, SketchContext } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import type { Species } from '../core/record';
import { curveAt } from '../core/types';
import { record as meadowRecord } from '../species/meadow-grass/record';
import { grassCover } from './cover';
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

	test('grows no tuft where the option refuses the ground', () => {
		const tufts = placeTufts({ ...field, where: (x) => x > 0 }, 0, 100);
		expect(tufts.length).toBeGreaterThan(0);
		expect(tufts.every((tuft) => tuft.x > 0)).toBe(true);
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

	test('the mask keeps grass off the ground that it refuses', () => {
		// The left half of the field is water, which grows no grass.
		const mask = (x: number) => x > 0;
		const tufts = placeTufts({ ...field, mask }, 0, 100);
		expect(tufts.length).toBe(100);
		for (const tuft of tufts) expect(tuft.x).toBeGreaterThan(0);
		expect(placeTufts({ ...field, mask: () => false }, 0, 100)).toEqual([]);
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

describe('the cover that meets a species', () => {
	if (meadowRecord.foliage.kind !== 'grass-blade') throw new Error('meadow grass lost its blade');
	const blade = meadowRecord.foliage.blade;

	test('the cover takes the meadow grass blade and the colour of its upper face', () => {
		const cover = grassCover(meadowRecord);
		expect(cover.blade).toBe(blade);
		expect(cover.color).toMatch(/^#[0-9a-f]{6}$/);
		expect(cover.color).toBe('#648e29');
	});

	test('a species blade gives the cover its width, its keel and its tip', () => {
		const blades = 2;
		const segments = 3;
		const shaped = tuftMesh(7, blades, segments, blade);
		// Three vertices across each row, one at the midrib, and one at the tip.
		expect(shaped.positions.length).toBe(blades * (segments * 3 + 1) * 3);
		expect(shaped.indices.length).toBe(blades * (2 * 2 * 6 + 2 * 3));
		const at = (index: number) => shaped.positions[index] ?? Number.NaN;
		// The collar's two sides span the record's profile of its own width.
		const span = Math.hypot(at(0) - at(6), at(1) - at(7), at(2) - at(8));
		expect(span).toBeCloseTo(blade.width * curveAt(blade.profile, 0), 5);
		// The midrib sits between them and below, as the record's fold makes it.
		expect(at(3)).toBeCloseTo((at(0) + at(6)) / 2, 5);
		expect(at(4)).toBeLessThan(at(1));
		expect(at(4)).toBeLessThan(at(7));
		// The two halves light apart, since the fold turns each one's normal its own way.
		const normal = (index: number) => shaped.normals[index] ?? Number.NaN;
		expect(Math.abs(normal(0) - normal(6))).toBeGreaterThan(0.01);
	});

	test('a blade with no fold keeps the flat two-sided strip', () => {
		const flat = { ...blade, fold: 0 };
		const mesh = tuftMesh(7, 1, 3, flat);
		expect(mesh.positions.length).toBe((3 * 2 + 1) * 3);
		expect(mesh.indices.length).toBe(2 * 6 + 3);
		// The collar still spans the record's profile of its own width, and its two sides stand level.
		const at = (index: number) => mesh.positions[index] ?? Number.NaN;
		const span = Math.hypot(at(0) - at(3), at(2) - at(5));
		expect(span).toBeCloseTo(blade.width * curveAt(blade.profile, 0), 5);
		expect(at(1)).toBeCloseTo(at(4), 6);
	});

	test('a cover with no species blade draws the strip it draws today', () => {
		const mesh = tuftMesh(7, 2, 3);
		expect(mesh.positions.length).toBe(2 * (3 * 2 + 1) * 3);
		expect(mesh.indices.length).toBe(2 * (2 * 6 + 3));
	});

	test('a species without a grass blade is refused', () => {
		const oak = { ...meadowRecord, id: 'oak', foliage: { kind: 'none' } } as Species;
		expect(() => grassCover(oak)).toThrow('no grass blade');
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
		const updates: Float32Array[] = [];
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
					return {
						update: (data: Float32Array) => {
							// Keep the numbers as the engine receives them, not the live buffer.
							updates.push(new Float32Array(data));
						},
					};
				},
			},
			quality: { preset, onChange: () => () => {} },
			engine: { capabilities: { tier: 'webgl2' } },
		} as unknown as SketchContext;
		return { ctx, made, materials, uploads, updates, layers };
	}

	test('the High count fills the hill and each preset draws its share', async () => {
		const { ctx, made } = context('high');
		const grass = await createGrass(ctx, field);
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
	test('the grass reads the field it is given, and takes its newest layer', async () => {
		const { ctx, materials, uploads, layers } = context('high');
		const air = {
			base: [2, 0.5, 0.3, 7],
			gust: [1, 10, 0.4, 8],
			swirl: [0.5, 20, 0.1, 0],
			sent: [0, 0, 0, -1e9],
		};
		const wind = {
			texture: { layer: 3 },
			origin: [0, 0],
			size: 128,
			air,
		} as unknown as WindField;
		const grass = await createGrass(ctx, { ...field, wind });
		const options = materials[0] as {
			uniforms: { windStrength: number; windBox: number };
			textures: { wind: unknown };
		};
		expect(options.uniforms.windStrength).toBe(1);
		expect(options.uniforms.windBox).toBe(128);
		expect(options.textures.wind).toBe(wind.texture);
		// The air's four vectors, the sent gust among them, travel as the reading texture the shader
		// samples. The texture holds them as 16-bit floats, so the test rounds the expected values
		// the same way.
		const reading = uploads.find((upload) => upload.width === 4);
		const data = (reading?.data ?? new Float32Array()) as Float32Array;
		expect([...data]).toEqual([
			...new Float32Array([...air.base, ...air.gust, ...air.swirl, ...air.sent]),
		]);
		grass.setWindLayer(wind);
		expect(layers).toEqual([3]);
	});
	test('the steady settings follow a base wind that a page changes', async () => {
		const { ctx, updates } = context('high');
		const air = {
			base: [2, 0.5, 0.3, 7],
			gust: [1, 10, 0.4, 8],
			swirl: [0.5, 20, 0.1, 0],
			sent: [0, 0, 0, -1e9],
		};
		const wind = {
			texture: { layer: 0 },
			origin: [0, 0],
			size: 128,
			air,
		} as unknown as WindField;
		const grass = await createGrass(ctx, { ...field, wind });
		grass.setWindLayer(wind);
		const settled = updates.length;
		// A page's strength slider raises the base wind, as the demo's does.
		air.base[0] = 9;
		air.base[1] = 1.2;
		grass.setWindLayer(wind);
		expect(updates.length).toBe(settled + 1);
		const held = updates.at(-1) as Float32Array;
		expect(held[0]).toBe(9);
		// The texture holds the numbers as 32-bit floats, so the test rounds the expected value.
		expect(held[1]).toBe(Math.fround(1.2));
		// A frame that changes nothing writes nothing.
		grass.setWindLayer(wind);
		expect(updates.length).toBe(settled + 1);
	});
	test('the grass that names no field binds the slots and stands still', async () => {
		const { ctx, materials, uploads } = context('high');
		await createGrass(ctx, field);
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

	test('WebGPU builds the blade list in a compute pass, which the shadows read', async () => {
		const passes: Record<string, unknown>[] = [];
		const uniformCalls: number[][] = [];
		const uploads: Record<string, unknown>[] = [];
		const made: { capacity: number; options: Record<string, unknown> }[] = [];
		const cast: boolean[] = [];
		const camera = {
			fov: 90,
			near: 0.5,
			far: 300,
			getWorldMatrix(out: Float64Array) {
				out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
			},
		};
		const ctx = {
			engine: {
				capabilities: { tier: 'webgpu' },
				viewport: { width: 960, height: 540 },
			},
			materials: {},
			geometry: {},
			scene: {
				addComputeInstances: async (_description: unknown, options: Record<string, unknown>) => {
					made.push({ capacity: options.capacity as number, options });
					return {
						counts: { buffer: 1, bytes: 4 },
						instances: { buffer: 2, bytes: (options.capacity as number) * 64 },
						materialIndex: 7,
						material: { setUniform: () => undefined },
						object: {
							setCastShadows: (on: boolean) => cast.push(on),
							setReceiveShadows: () => undefined,
						},
					};
				},
			},
			render: {
				addPass: (options: Record<string, unknown>) => {
					passes.push(options);
					return {};
				},
				setPassUniforms: (_pass: unknown, values: number[]) => uniformCalls.push(values),
			},
			textures: {
				fromData: (options: Record<string, unknown>) => {
					uploads.push(options);
					return { update: () => undefined };
				},
			},
			quality: { preset: 'high', onChange: () => () => {} },
		} as unknown as SketchContext;
		const grass = await createGrass(ctx, { ...field, camera } as unknown as Parameters<
			typeof createGrass
		>[1]);
		expect(grass.batches).toEqual([]);
		expect(grass.draws.length).toBe(1);
		expect(made[0]?.capacity).toBe(125);
		// The draw's count starts empty: the pass writes it each frame.
		expect(made[0]?.options.count).toBe(0);
		expect(cast).toEqual([true]);
		// The material thins the far tufts and widens their blades, as the pass does.
		if (!made[0]) throw new Error('the blade list made no draw');
		expect((made[0].options.uniforms as Record<string, number>).cull).toBe(1);
		// The pass's values hold the camera's place, its right, up and forward with its lens, then
		// the tufts that the preset draws, the material that the rows read, and the data texture's
		// width. The camera looks down its own -z, at the origin turned.
		const values = passes[0]?.values as number[];
		expect(values.slice(0, 4)).toEqual([1, 2, 3, 1]);
		expect(values.slice(4, 7)).toEqual([1, 0, 0]);
		expect(values[7]).toBeCloseTo(1, 12);
		expect(values.slice(8, 12)).toEqual([0, 1, 0, 960 / 540]);
		expect(values.slice(12, 15).map((value) => value || 0)).toEqual([0, 0, -1]);
		expect(values[15]).toBe(0.5);
		expect(values.slice(16, 19)).toEqual([100, 7, 2048]);
		expect(values[19]).toBe(300);
		// The tuft data holds two texels for each tuft.
		const data = uploads.find((upload) => upload.width === 2048);
		if (!data) throw new Error('the blade list wrote no tuft texture');
		expect(data.height).toBe(Math.ceil((125 * 2) / 2048));
		expect((data.data as Float32Array).length % 8).toBe(0);
		grass.fit('low');
		expect(uniformCalls.at(-1)?.[16]).toBe(35);
	});
});

describe('the wind blocks of the grass shader', () => {
	test('read the wind field with one copy in every reader of the add-on and its test pages', () => {
		// A shader cannot import another shader of the add-on, so each reader copies the field's
		// steady settings and its sampling function. The grass holds the add-on's source copy, which
		// the wind add-on's own test holds to the field's. The plant shader, the floating leaves and
		// two test pages read the field too: the cost page carries both blocks, and the gust page carries the steady
		// block twice and keeps only the reading function of the other, so it is held to the steady
		// block alone.
		const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
		const block = (source: string, name: string) => {
			const from = `// <${name}>`;
			const to = `// </${name}>`;
			return source.slice(source.indexOf(from), source.indexOf(to));
		};
		const COST_PAGE = '../../../../tests/pages/sketches/wind-reader-cost-sketch.ts';
		const GUST_PAGE = '../../../../tests/pages/sketches/gust-crossing-sketch.ts';
		for (const name of ['wind-steady', 'wind-sample']) {
			const grass = block(read('./grass.wgsl'), name);
			expect(grass.length).toBeGreaterThan(0);
			for (const file of [
				'../render/plant.wgsl',
				'../floating-leaves/floating-leaves.wgsl',
				'../floating-leaves/floating-leaves-state.wgsl',
				'../floating-leaves/floating-leaves-state.fallback.wgsl',
				COST_PAGE,
				...(name === 'wind-steady' ? [GUST_PAGE] : []),
			])
				expect(block(read(file), name)).toBe(grass);
		}
		// The gust page draws the steady block twice, once for each path's form.
		const gust = read(GUST_PAGE);
		const steady = block(read('./grass.wgsl'), 'wind-steady');
		const copies = gust.split('// <wind-steady>').length - 1;
		expect(copies).toBe(2);
		for (const piece of gust.split('// <wind-steady>').slice(1))
			expect(`// <wind-steady>${piece.slice(0, steady.length - '// <wind-steady>'.length)}`).toBe(
				steady,
			);
		// The blade list and the draw both thin the far tufts by the same hash and share, so a
		// change to one copy must reach the other.
		const density = block(read('./grass.wgsl'), 'tuft-density');
		expect(density.length).toBeGreaterThan(0);
		expect(block(read('./grass-blades.wgsl'), 'tuft-density')).toBe(density);
	});
});
