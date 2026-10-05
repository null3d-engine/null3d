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
import { Geometry, Materials, type MeshGeometry } from './resources';
import { Scene } from './scene';
import {
	PointBatch,
	type PointChecks,
	SpriteBatch,
	type SpriteBatchRows,
	type SpriteMakers,
	type SpriteOptions,
	spriteParts,
} from './sprites';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Where the fake core puts each of a batch's arrays: a 4 KB block per field. */
const fieldAddress = (field: number) => 4096 * (field + 2);

/**
 * A core that records the sprite materials it creates, with their features and texture coordinate
 * transforms, the quads it makes and the sprite batches it creates, and that gives each batch
 * array a block of its memory.
 */
function fakeCore() {
	const materials: { shading: number; features: number; values: Map<number, number[]> }[] = [];
	const quads: number[][] = [];
	const batches: unknown[][] = [];
	const destroyedMaterials: number[] = [];
	const glue = {
		sceneCapacity: () => 15,
		destroyMaterial: (material: number) => destroyedMaterials.push(material) && 0,
		createSpriteBatch: (...args: unknown[]) => batches.push(args),
		setBatchLayers: () => 0,
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
		meshRadius: () => Math.SQRT1_2,
		batchArrays: (_batch: number, field: number) => fieldAddress(field),
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const memory = new WebAssembly.Memory({ initial: 1 });
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const makers: SpriteMakers = { geometry: new Geometry(core), materials: new Materials(core) };
	const scene = new Scene(core, { frame: 1 }, false, undefined, undefined, makers);
	return { core, makers, scene, materials, quads, batches, memory, destroyedMaterials };
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
		const { makers, materials } = fakeCore();
		spriteParts(makers, new Map(), {}, [4, 2], 'blend', 'createSprites');
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
		const { makers, materials } = fakeCore();
		spriteParts(makers, new Map(), { alphaMode: 'mask' }, [1, 1], 'blend', 'createSprites');
		const features = materials[0]?.features ?? 0;
		expect(features & MATERIAL_FEATURE_BLEND).toBe(0);
		expect(features & MATERIAL_FEATURE_ALPHA_MASK).toBe(MATERIAL_FEATURE_ALPHA_MASK);
	});

	test('the quad puts the center at the origin, and batches with one center share it', () => {
		const { makers, quads } = fakeCore();
		const shared = new Map<string, MeshGeometry>();
		const make = (options: SpriteOptions) =>
			spriteParts(makers, shared, options, [1, 1], 'blend', 'createSprites');
		const middle = make({ count: 1 });
		expect(make({ count: 2 }).mesh).toBe(middle.mesh);
		const standing = make({ count: 1, center: [0.5, 0] });
		expect(standing.mesh).not.toBe(middle.mesh);
		expect(quads).toEqual([
			[-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
			[-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0],
		]);
	});
});

/** The error that `call` rejects with. */
async function rejected(call: () => Promise<unknown>): Promise<EngineError> {
	try {
		await call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not reject');
}

describe('scene.createSprites', () => {
	test('makes a batch of the quad and the material, with the atlas and the size mode', async () => {
		const { scene, batches } = fakeCore();
		const sprites = await scene.createSprites({
			count: 6,
			dynamic: true,
			atlas: { columns: 3, rows: 2 },
			sizeAttenuation: false,
		});
		expect(sprites).toBeInstanceOf(SpriteBatch);
		expect(sprites.count).toBe(6);
		// Capacity, dynamic, quad, material, columns, rows and sizes in pixels.
		expect(batches).toEqual([[6, true, 1, 1, 3, 2, true]]);
	});

	test('an atlas side that is not a whole number from 1 to the limit rejects with E1108', async () => {
		const { scene, batches } = fakeCore();
		for (const atlas of [
			{ columns: 0, rows: 1 },
			{ columns: 2.5, rows: 1 },
			{ columns: 1, rows: SPRITE_MAX_ATLAS_SIDE + 1 },
		]) {
			const error = await rejected(() => scene.createSprites({ count: 1, atlas }));
			expect(error.message).toMatch(/E1108: createSprites\(\) got .* atlas (columns|rows)/);
		}
		expect(batches).toEqual([]);
	});

	test('a center that is not two finite numbers rejects with E1203', async () => {
		const { scene } = fakeCore();
		const error = await rejected(() => scene.createSprites({ count: 1, center: [Number.NaN, 0] }));
		expect(error.code).toBe('E1203');
	});
});

describe('sprite batches', () => {
	test('the arrays view each field of the batch with its floats per sprite', () => {
		const { core, makers } = fakeCore();
		const { material } = spriteParts(makers, new Map(), {}, [1, 1], 'blend', 'createSprites');
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
		const { core, makers, memory } = fakeCore();
		const { material } = spriteParts(makers, new Map(), {}, [1, 1], 'blend', 'createSprites');
		const sprites = new SpriteBatch(core, 7, 5, material, rowCalls([]));
		const before = sprites.positions;
		memory.grow(1);
		core.refresh();
		expect(sprites.positions).not.toBe(before);
		expect(sprites.positions.buffer).toBe(memory.buffer);
	});

	test('row calls reach the instance batch, with markDirty defaulting to every sprite', () => {
		const { core, makers, destroyedMaterials } = fakeCore();
		const { material } = spriteParts(makers, new Map(), {}, [1, 1], 'blend', 'createSprites');
		const log: string[] = [];
		const sprites = new SpriteBatch(core, 7, 5, material, rowCalls(log));
		sprites.setActiveCount(3);
		sprites.setLayers(6);
		sprites.markDirty();
		sprites.markDirty(2);
		sprites.destroy();
		expect(log).toEqual(['active 3', 'layers 6', 'dirty 0 5', 'dirty 2 3', 'destroy']);
		// The batch's own material goes with it, so batches made and destroyed in turn never fill
		// the material table.
		expect(destroyedMaterials).toEqual([1]);
	});
});

describe('scene.createPoints', () => {
	test('makes an opaque sprite batch of one frame, and writes the points, colors and size', async () => {
		const { scene, batches, materials, memory } = fakeCore();
		const points = await scene.createPoints({
			positions: [1, 2, 3, 4, 5, 6],
			colors: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
			size: 0.25,
			sizeAttenuation: false,
		});
		expect(points).toBeInstanceOf(PointBatch);
		expect(points.count).toBe(2);
		// Capacity, dynamic, quad, material, columns, rows and sizes in pixels.
		expect(batches).toEqual([[2, false, 1, 1, 1, 1, true]]);
		expect((materials[0]?.features ?? 0) & MATERIAL_FEATURE_BLEND).toBe(0);
		expect([...points.positions]).toEqual([1, 2, 3, 4, 5, 6]);
		const rgb = [...points.colors].filter((_, k) => k % 4 !== 3);
		expect(rgb.map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
		const sizes = new Float32Array(memory.buffer, fieldAddress(BATCH_FIELD_SIZES), 4);
		expect([...sizes]).toEqual([0.25, 0.25, 0.25, 0.25]);
	});

	test('colors of 4 numbers per point keep their alpha, and blended points blend', async () => {
		const { scene, materials } = fakeCore();
		const points = await scene.createPoints({
			positions: [0, 0, 0],
			colors: [1, 0.5, 0.25, 0.75],
			alphaMode: 'blend',
		});
		expect([...points.colors]).toEqual([1, 0.5, 0.25, 0.75]);
		expect((materials[0]?.features ?? 0) & MATERIAL_FEATURE_BLEND).toBe(MATERIAL_FEATURE_BLEND);
	});

	test('points or colors that make no points reject with E1206, and bad sizes with E1108 or E1203', async () => {
		const { scene, batches } = fakeCore();
		const cases: [Parameters<typeof scene.createPoints>[0], RegExp][] = [
			[{ positions: [] }, /E1206: createPoints\(\) got 0 numbers in positions/],
			[{ positions: [0, 0] }, /E1206: createPoints\(\) got 2 numbers in positions/],
			[
				{ positions: [0, 0, 0], colors: [1, 1] },
				/E1206: .* 2 numbers in colors for 1 points, not 3 or 4/,
			],
			[{ positions: [0, Number.NaN, 0] }, /E1206: .* NaN at index 1 of positions/],
			[{ positions: [0, 0, 0], size: 0 }, /E1108: createPoints\(\) got the size 0/],
			[
				{ positions: [0, 0, 0], size: Number.POSITIVE_INFINITY },
				/E1203: createPoints\(\) got Infinity for size/,
			],
		];
		for (const [options, message] of cases)
			expect((await rejected(() => scene.createPoints(options))).message).toMatch(message);
		expect(batches).toEqual([]);
	});
});

describe('point batches', () => {
	/** A point batch of 3 points over a sprite batch whose row calls go to `log`. */
	function pointBatch(log: string[]) {
		const { core, makers } = fakeCore();
		const { material } = spriteParts(makers, new Map(), {}, [1, 1], 'opaque', 'createPoints');
		const sprites = new SpriteBatch(core, 7, 3, material, rowCalls(log));
		const checks: PointChecks = {
			size: (size, call) => {
				if (!(size > 0)) throw new Error(`${call} got ${size}`);
			},
		};
		return { points: new PointBatch(sprites, checks), sprites };
	}

	test('the arrays are the sprite rows of positions and colors', () => {
		const { points, sprites } = pointBatch([]);
		expect(points.count).toBe(3);
		expect(points.positions).toBe(sprites.positions);
		expect(points.colors).toBe(sprites.colors);
		expect(points.colors.length).toBe(12);
	});

	test('setSize sizes every point and marks them all, and the other calls reach the batch', () => {
		const log: string[] = [];
		const { points, sprites } = pointBatch(log);
		points.setSize(4);
		expect([...sprites.sizes]).toEqual([4, 4, 4, 4, 4, 4]);
		expect(() => points.setSize(-1)).toThrow('points.setSize got -1');
		points.setActiveCount(2);
		points.setLayers(6);
		points.markDirty(1);
		points.destroy();
		expect(log).toEqual(['dirty 0 3', 'active 2', 'layers 6', 'dirty 1 2', 'destroy']);
	});
});
