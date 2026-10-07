import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	BATCH_FIELD_COLORS,
	BATCH_FIELD_POSITIONS,
	LINE_MODE_LOOP,
	LINE_MODE_SEGMENTS,
	LINE_MODE_STRIP,
	MATERIAL_FEATURE_BLEND,
	MATERIAL_FEATURE_DOUBLE_SIDED,
	SHADING_LINE,
	SHADING_LINE_LIT,
} from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { LineBatch, type LineBatchRows, type LineChecks, lineParts } from './lines';
import { CoreMemory } from './memory';
import { Geometry, Materials } from './resources';
import { Scene } from './scene';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Where the fake core puts each of a batch's arrays: a 4 KB block per field. */
const fieldAddress = (field: number) => 4096 * (field + 2);

/**
 * A core that records the line materials it creates, with their features and custom values, the
 * meshes it makes, the line batches it creates and the widths it sets, and that gives each batch
 * array a block of its memory.
 */
function fakeCore() {
	const materials: { shading: number; features: number; custom: number[] }[] = [];
	const meshes: number[][] = [];
	const batches: unknown[][] = [];
	const widths: number[][] = [];
	const glue = {
		sceneCapacity: () => 15,
		createLineBatch: (...args: unknown[]) => batches.push(args),
		setLineWidth: (batch: number, width: number) => widths.push([batch, width]) && 0,
		setBatchLayers: () => 0,
		createMaterial: (shading: number, features: number) =>
			materials.push({ shading, features, custom: [] }),
		setMaterialValue: () => 0,
		setMaterialValues: (material: number, at: number, count: number, ...values: number[]) => {
			const custom = materials[material - 1]?.custom;
			custom?.splice(at, count, ...values.slice(0, count));
			return 0;
		},
		setMaterialMap: () => 0,
		meshArrays: () => 1024,
		createMeshFromArrays: () => {
			meshes.push([...new Float32Array(memory.buffer, 1024, 24)]);
			return meshes.length;
		},
		meshRadius: () => 1,
		batchArrays: (_batch: number, field: number) => fieldAddress(field),
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const memory = new WebAssembly.Memory({ initial: 1 });
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const makers = { geometry: new Geometry(core), materials: new Materials(core) };
	const scene = new Scene(core, { frame: 1 }, false, undefined, undefined, makers);
	return { core, makers, scene, materials, meshes, batches, widths, memory };
}

/** Checks that log each call, as the scene's checks would run them. */
function loggedChecks(log: string[]): LineChecks {
	return {
		width: (width, call) => log.push(`${call} width ${width}`),
		values: (_values, call) => log.push(`${call} values`),
	};
}

/** The calls of a line batch that reach the instance batch, as a log. */
function rowCalls(log: string[]): LineBatchRows {
	return {
		setActiveCount: (count) => log.push(`active ${count}`),
		setLayers: (mask) => log.push(`layers ${mask}`),
		markDirty: (start, count) => log.push(`dirty ${start} ${count}`),
		destroy: () => log.push('destroy'),
		destroyedFrame: -1,
		listen: (_target, type) => log.push(`on ${type}`),
		unlisten: (_target, type) => log.push(`off ${type}`),
	};
}

/** The error that `call` rejects with. */
async function rejected(call: () => Promise<unknown>): Promise<EngineError> {
	try {
		await call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not reject');
}

const SQUARE = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];

describe('line parts', () => {
	test('a line material draws both faces, is opaque by default and holds the dashes', () => {
		const { core, makers, materials } = fakeCore();
		const options = { positions: SQUARE, dashSize: 0.5, dashOffset: 2 };
		lineParts(makers, core, undefined, options, loggedChecks([]), 'createLines');
		const [material] = materials;
		expect(material?.shading).toBe(SHADING_LINE);
		const features = material?.features ?? 0;
		expect(features & MATERIAL_FEATURE_DOUBLE_SIDED).toBe(MATERIAL_FEATURE_DOUBLE_SIDED);
		expect(features & MATERIAL_FEATURE_BLEND).toBe(0);
		// Dash size, gap size, dash scale and dash offset.
		expect(material?.custom).toEqual([0.5, 1, 1, 2]);
	});

	test('lit lines take the lit shading, and blended ones blend', () => {
		const { core, makers, materials } = fakeCore();
		const options = { positions: SQUARE, lit: true, alphaMode: 'blend' } as const;
		lineParts(makers, core, undefined, options, loggedChecks([]), 'createLines');
		expect(materials[0]?.shading).toBe(SHADING_LINE_LIT);
		expect((materials[0]?.features ?? 0) & MATERIAL_FEATURE_BLEND).toBe(MATERIAL_FEATURE_BLEND);
	});

	test('the segment mesh codes its corners within one unit, and batches share it', () => {
		const { core, makers, meshes } = fakeCore();
		const first = lineParts(makers, core, undefined, { positions: SQUARE }, loggedChecks([]), 'l');
		const second = lineParts(
			makers,
			core,
			first.mesh,
			{ positions: SQUARE },
			loggedChecks([]),
			'l',
		);
		expect(second.mesh).toBe(first.mesh);
		expect(meshes).toHaveLength(1);
		const corners = meshes[0] ?? [];
		for (let k = 0; k < corners.length; k += 3) {
			const [x = 0, y = 0] = corners.slice(k, k + 2);
			expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-6);
		}
	});

	test('set changes the dashes it gets and keeps the others', () => {
		const { core, makers, materials } = fakeCore();
		const log: string[] = [];
		const { material } = lineParts(
			makers,
			core,
			undefined,
			{ positions: SQUARE, gapSize: 3 },
			loggedChecks(log),
			'createLines',
		);
		material.set({ dashOffset: 0.25 });
		expect(materials[0]?.custom).toEqual([1, 3, 1, 0.25]);
		expect(log).toEqual(['lines.material.set values']);
	});
});

describe('scene.createLines', () => {
	test('makes a batch of the points with its mode, width and look, and copies the points', async () => {
		const { scene, batches, memory } = fakeCore();
		const colors = [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1];
		const lines = await scene.createLines({
			positions: SQUARE,
			colors,
			mode: 'loop',
			width: 3,
			worldUnits: true,
			dashed: true,
			dynamic: true,
		});
		expect(lines).toBeInstanceOf(LineBatch);
		expect(lines.count).toBe(4);
		// Points, dynamic, mesh, material, mode, width, world units and dashes.
		expect(batches).toEqual([[4, true, 1, 1, LINE_MODE_LOOP, 3, true, true]]);
		const at = (field: number) => [...new Float32Array(memory.buffer, fieldAddress(field), 12)];
		expect(at(BATCH_FIELD_POSITIONS)).toEqual(SQUARE);
		expect(at(BATCH_FIELD_COLORS)).toEqual(colors);
	});

	test('the mode defaults to a strip one pixel wide, and pairs make segments', async () => {
		const { scene, batches } = fakeCore();
		await scene.createLines({ positions: SQUARE });
		await scene.createLines({ positions: SQUARE, mode: 'segments' });
		expect(batches.map((b) => [b[4], b[5]])).toEqual([
			[LINE_MODE_STRIP, 1],
			[LINE_MODE_SEGMENTS, 1],
		]);
	});

	test('points or colors that make no line reject with E1206', async () => {
		const { scene, batches } = fakeCore();
		for (const options of [
			{ positions: [0, 0, 0, 1, 0] },
			{ positions: [0, 0, 0] },
			{ positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], mode: 'segments' as const },
			{ positions: SQUARE, colors: [1, 1, 1] },
			{ positions: [0, 0, 0, Number.NaN, 0, 0] },
		]) {
			const error = await rejected(() => scene.createLines(options));
			expect(error.message).toMatch(/^E1206: createLines\(\) got /);
		}
		expect(batches).toEqual([]);
	});

	test('an unknown mode rejects with E1217, and bad widths and dashes with E1108 or E1203', async () => {
		const { scene } = fakeCore();
		const mode = await rejected(() =>
			scene.createLines({ positions: SQUARE, mode: 'fan' as 'strip' }),
		);
		expect(mode.code).toBe('E1217');
		expect((await rejected(() => scene.createLines({ positions: SQUARE, width: 0 }))).code).toBe(
			'E1108',
		);
		const infinite = await rejected(() =>
			scene.createLines({ positions: SQUARE, width: Number.POSITIVE_INFINITY }),
		);
		expect(infinite.code).toBe('E1203');
		const gap = await rejected(() => scene.createLines({ positions: SQUARE, gapSize: -1 }));
		expect(gap.code).toBe('E1108');
	});
});

describe('line batches', () => {
	test('the arrays view the points and their colors, 3 floats each', () => {
		const { core, makers } = fakeCore();
		const checks = loggedChecks([]);
		const { material } = lineParts(makers, core, undefined, { positions: SQUARE }, checks, 'l');
		const lines = new LineBatch(core, 7, 5, material, rowCalls([]), checks);
		for (const [view, field] of [
			[lines.positions, BATCH_FIELD_POSITIONS],
			[lines.colors, BATCH_FIELD_COLORS],
		] as const) {
			expect(view.byteOffset).toBe(fieldAddress(field));
			expect(view.length).toBe(15);
		}
		expect(lines.positions).toBe(lines.positions);
	});

	test('the views are made again after the memory grows', () => {
		const { core, makers, memory } = fakeCore();
		const checks = loggedChecks([]);
		const { material } = lineParts(makers, core, undefined, { positions: SQUARE }, checks, 'l');
		const lines = new LineBatch(core, 7, 5, material, rowCalls([]), checks);
		const before = lines.colors;
		memory.grow(1);
		core.refresh();
		expect(lines.colors).not.toBe(before);
		expect(lines.colors.buffer).toBe(memory.buffer);
	});

	test('calls reach the instance batch and the core, with markDirty defaulting to every point', () => {
		const { core, makers, widths } = fakeCore();
		const log: string[] = [];
		const checks = loggedChecks(log);
		const { material } = lineParts(makers, core, undefined, { positions: SQUARE }, checks, 'l');
		log.length = 0;
		const lines = new LineBatch(core, 7, 5, material, rowCalls(log), checks);
		lines.setActiveCount(3);
		lines.setLayers(6);
		lines.markDirty();
		lines.markDirty(2);
		lines.setWidth(4);
		lines.destroy();
		expect(log).toEqual([
			'active 3',
			'layers 6',
			'dirty 0 5',
			'dirty 2 3',
			'lines.setWidth width 4',
			'destroy',
		]);
		expect(widths).toEqual([[7, 4]]);
	});
});
