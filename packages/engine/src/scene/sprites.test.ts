import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	BATCH_FIELD_COLORS,
	BATCH_FIELD_FRAMES,
	BATCH_FIELD_POSITIONS,
	BATCH_FIELD_ROTATIONS,
	BATCH_FIELD_SIZES,
	MATERIAL_FEATURE_ALPHA_MASK,
	MATERIAL_FEATURE_BLEND,
	MATERIAL_FEATURE_DOUBLE_SIDED,
	MATERIAL_PARAM_UV_U,
	MATERIAL_PARAM_UV_V,
	SHADING_SPRITE,
	SPRITE_MAX_ATLAS_SIDE,
} from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { Materials } from './resources';
import { spriteParts } from './sprite-parts';
import { SpriteBatch, type SpriteBatchRows, type SpriteOptions } from './sprites';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Where the fake core puts each of a batch's arrays: a 4 KB block per field. */
const fieldAddress = (field: number) => 4096 * (field + 2);

/**
 * A core that records the sprite materials it creates, with their features and texture coordinate
 * transforms, and the quads it makes, and that gives each batch array a block of its memory.
 */
function fakeCore() {
	const materials: { shading: number; features: number; values: Map<number, number[]> }[] = [];
	const quads: number[][] = [];
	const glue = {
		createMaterial: (shading: number, features: number) =>
			materials.push({ shading, features, values: new Map() }),
		setMaterialValue: (material: number, param: number, x: number, y: number, z: number) => {
			materials[material - 1]?.values.set(param, [x, y, z]);
			return 0;
		},
		setMaterialMap: () => 0,
		meshArrays: () => 1024,
		createMeshFromArrays: () => {
			quads.push([...new Float32Array(memory.buffer, 1024, 12)]);
			return quads.length;
		},
		batchArrays: (_batch: number, field: number) => fieldAddress(field),
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const memory = new WebAssembly.Memory({ initial: 1 });
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	return { core, materials, quads, memory };
}

/** The calls of a sprite batch that reach the instance batch, as a log. */
function rowCalls(log: string[]): SpriteBatchRows {
	return {
		setActiveCount: (count) => log.push(`active ${count}`),
		setLayers: (mask) => log.push(`layers ${mask}`),
		markDirty: (start, count) => log.push(`dirty ${start} ${count}`),
		destroy: () => log.push('destroy'),
	};
}

describe('sprite parts', () => {
	test('a sprite material blends, draws both faces and scales the atlas into its frames', () => {
		const { core, materials } = fakeCore();
		const parts = spriteParts(
			core,
			new Materials(core),
			new Map(),
			{ count: 4, atlas: { columns: 4, rows: 2 } },
			'createSprites',
		);
		expect([parts.columns, parts.rows]).toEqual([4, 2]);
		const [material] = materials;
		expect(material?.shading).toBe(SHADING_SPRITE);
		expect((material?.features ?? 0) & MATERIAL_FEATURE_BLEND).toBe(MATERIAL_FEATURE_BLEND);
		expect((material?.features ?? 0) & MATERIAL_FEATURE_DOUBLE_SIDED).toBe(
			MATERIAL_FEATURE_DOUBLE_SIDED,
		);
		// Plus 0 turns the transform's negative zeros into zeros.
		const row = (param: number) => material?.values.get(param)?.map((v) => v + 0);
		expect(row(MATERIAL_PARAM_UV_U)).toEqual([0.25, 0, 0]);
		expect(row(MATERIAL_PARAM_UV_V)).toEqual([0, 0.5, 0]);
	});

	test('a masked sprite material does not blend', () => {
		const { core, materials } = fakeCore();
		spriteParts(
			core,
			new Materials(core),
			new Map(),
			{ count: 1, alphaMode: 'mask' },
			'createSprites',
		);
		const features = materials[0]?.features ?? 0;
		expect(features & MATERIAL_FEATURE_BLEND).toBe(0);
		expect(features & MATERIAL_FEATURE_ALPHA_MASK).toBe(MATERIAL_FEATURE_ALPHA_MASK);
	});

	test('the quad puts the center at the origin, and batches with one center share it', () => {
		const { core, quads } = fakeCore();
		const shared = new Map<string, number>();
		const make = (options: SpriteOptions) =>
			spriteParts(core, new Materials(core), shared, options, 'createSprites');
		const middle = make({ count: 1 });
		expect(make({ count: 2 }).mesh).toBe(middle.mesh);
		const standing = make({ count: 1, center: [0.5, 0] });
		expect(standing.mesh).not.toBe(middle.mesh);
		expect(quads).toEqual([
			[-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
			[-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0],
		]);
	});

	test('an atlas side that is not a whole number from 1 to the limit throws E1108', () => {
		const { core } = fakeCore();
		for (const atlas of [
			{ columns: 0, rows: 1 },
			{ columns: 2.5, rows: 1 },
			{ columns: 1, rows: SPRITE_MAX_ATLAS_SIDE + 1 },
		]) {
			const make = () =>
				spriteParts(core, new Materials(core), new Map(), { count: 1, atlas }, 'createSprites');
			expect(make).toThrow(/E1108: createSprites\(\) got .* atlas (columns|rows)/);
		}
	});

	test('a center that is not two finite numbers throws E1203', () => {
		const { core } = fakeCore();
		try {
			spriteParts(
				core,
				new Materials(core),
				new Map(),
				{ count: 1, center: [Number.NaN, 0] },
				'createSprites',
			);
			throw new Error('no error');
		} catch (error) {
			expect((error as EngineError).code).toBe('E1203');
		}
	});
});

describe('sprite batches', () => {
	test('the arrays view each field of the batch with its floats per sprite', () => {
		const { core } = fakeCore();
		const { material } = spriteParts(
			core,
			new Materials(core),
			new Map(),
			{ count: 1 },
			'createSprites',
		);
		const sprites = new SpriteBatch(core, 7, 5, material, rowCalls([]));
		const views: [ArrayLike<number> & { byteOffset: number }, number, number][] = [
			[sprites.positions, BATCH_FIELD_POSITIONS, 15],
			[sprites.sizes, BATCH_FIELD_SIZES, 10],
			[sprites.rotations, BATCH_FIELD_ROTATIONS, 5],
			[sprites.colors, BATCH_FIELD_COLORS, 20],
			[sprites.frames, BATCH_FIELD_FRAMES, 5],
		];
		for (const [view, field, length] of views) {
			expect(view.byteOffset).toBe(fieldAddress(field));
			expect(view.length).toBe(length);
		}
		expect(sprites.frames).toBeInstanceOf(Uint32Array);
		// Reads reuse the views while the memory keeps its buffer.
		expect(sprites.sizes).toBe(sprites.sizes);
	});

	test('the views are made again after the memory grows', () => {
		const { core, memory } = fakeCore();
		const { material } = spriteParts(
			core,
			new Materials(core),
			new Map(),
			{ count: 1 },
			'createSprites',
		);
		const sprites = new SpriteBatch(core, 7, 5, material, rowCalls([]));
		const before = sprites.positions;
		memory.grow(1);
		core.refresh();
		expect(sprites.positions).not.toBe(before);
		expect(sprites.positions.buffer).toBe(memory.buffer);
	});

	test('row calls reach the instance batch, with markDirty defaulting to every sprite', () => {
		const { core } = fakeCore();
		const { material } = spriteParts(
			core,
			new Materials(core),
			new Map(),
			{ count: 1 },
			'createSprites',
		);
		const log: string[] = [];
		const sprites = new SpriteBatch(core, 7, 5, material, rowCalls(log));
		sprites.setActiveCount(3);
		sprites.setLayers(6);
		sprites.markDirty();
		sprites.markDirty(2);
		sprites.destroy();
		expect(log).toEqual(['active 3', 'layers 6', 'dirty 0 5', 'dirty 2 3', 'destroy']);
	});
});
