import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Camera, InstanceBatch, Texture, Textures } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import type { PlantAsset } from './asset';
import type { PlantWind } from './plant';
import { plantPoses } from './poses';

/** A field of the wind add-on, whose texture the pose pass reads. */
const field = {
	texture: { layer: 0 } as Texture,
	origin: [0, 0],
	size: 96,
	air: {
		base: [4, 0, 0.65, 0],
		gust: [3.5, 14, 2, 6],
		swirl: [1.6, 0.06, 0.5, 0],
	},
} as WindField;

/** The plant's wind data: the branch records' texture and the plant's own numbers. */
function windData(branches: number, swayDistance = 0): PlantWind {
	return {
		field,
		pivots: { layer: 0 } as Texture,
		branches,
		height: 12,
		crown: { center: [0, 6, 0], radius: 5 } as unknown as PlantWind['crown'],
		transmission: 0.35,
		swayDistance,
	};
}

/** The grown plant that the pose pass reads its branch count from. */
function assetWith(branches: number): PlantAsset {
	return { wind: { branches } } as PlantAsset;
}

interface PassOptions {
	kind: string;
	size: readonly [number, number];
	history?: boolean;
	dispatch?: readonly [number, number, number];
	textures?: readonly unknown[];
}

/** A sketch's context, recording what the pose pass asked it for. */
function fakeContext(options: { tier: string; features?: readonly string[]; maxSize?: number }) {
	const passes: PassOptions[] = [];
	const uploads: Float32Array[] = [];
	const values: number[][] = [];
	const textures = {
		maxSize: options.maxSize ?? 8192,
		fromData: () =>
			({
				layer: 0,
				update: (data: Float32Array) => uploads.push(Float32Array.from(data)),
			}) as unknown as Texture,
		fromPass: () => ({ layer: 0 }) as Texture,
	} as unknown as Textures;
	const contexts = {
		engine: {
			capabilities: { tier: options.tier, features: options.features ?? [] },
			viewport: { width: 1, height: 1, pixelRatio: 1 },
		},
		textures,
		render: {
			addPass: (given: PassOptions) => {
				passes.push(given);
				return { enabled: true } as never;
			},
			removePass: () => {},
			setPassUniforms: (_pass: unknown, given: readonly number[]) => {
				values.push(Array.from(given));
			},
		},
		time: { now: 0, dt: 1 / 60, frame: 1 },
	};
	// The fakes carry what the pose pass reads, not every member of a sketch's context.
	const sketch = contexts as unknown as Parameters<typeof plantPoses>[0];
	return { contexts: sketch, passes, uploads, values };
}

/** A batch of `count` copies standing along z, each turned a quarter about y. */
function batchOf(count: number, spacing: number): InstanceBatch {
	const positions = new Float32Array(count * 3);
	const rotations = new Float32Array(count * 4);
	const scales = new Float32Array(count * 3).fill(1);
	for (let row = 0; row < count; row++) {
		positions[row * 3 + 2] = -row * spacing;
		rotations.set([0, 0, 0, 1], row * 4);
	}
	return { count, positions, rotations, scales } as InstanceBatch;
}

const camera = {
	getPosition: (out: number[]) => {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
	},
} as unknown as Camera;

/** The text between two markers of a file, trimmed. */
function marked(file: URL, name: string): string {
	const text = readFileSync(file, 'utf8');
	const start = text.indexOf(`// <${name}>`);
	const end = text.indexOf(`// </${name}>`);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return text.slice(start + `// <${name}>`.length, end).trim();
}

/** The pass's compute form. */
const computeFile = new URL('./poses.wgsl', import.meta.url);
/** The pass's WebGL2 form. */
const fallbackFile = new URL('./poses.fallback.wgsl', import.meta.url);

describe('the pass’s two forms', () => {
	test('hold one spring and one set of turns', () => {
		// The shader build resolves only the engine's library, so the two forms carry copies, and this
		// keeps them equal.
		for (const name of ['pose-spring', 'pose-turn']) {
			const canonical = marked(computeFile, name);
			expect(canonical.length).toBeGreaterThan(0);
			expect(marked(fallbackFile, name)).toBe(canonical);
		}
	});

	test('read one table, with the header, the air and three texels a branch', () => {
		// The two forms index the table differently, so this test reads the numbers that both name.
		for (const file of [computeFile, fallbackFile]) {
			const text = readFileSync(file, 'utf8');
			expect(text).toContain('const POSE_TEXELS: u32 = 3u;');
			expect(text).toMatch(/const HEADER_ROW: (?:i32|u32) = 0(?:u)?;/);
			expect(text).toMatch(/const AIR_ROW: (?:i32|u32) = 1(?:u)?;/);
			expect(text).toMatch(/const FIRST_POSE_ROW: (?:i32|u32) = 2(?:u)?;/);
		}
	});
});

describe('the plant’s branch poses', () => {
	test('makes no pass on a device that draws no 16-bit float target', () => {
		const { contexts } = fakeContext({ tier: 'webgl2' });
		expect(plantPoses(contexts, windData(20), assetWith(20), field, { trees: 4 })).toBeUndefined();
	});

	test('makes the pass on a WebGL2 device with a float target', () => {
		const { contexts, passes } = fakeContext({
			tier: 'webgl2',
			features: ['EXT_color_buffer_float'],
		});
		expect(plantPoses(contexts, windData(20), assetWith(20), field, { trees: 4 })).toBeDefined();
		expect(passes).toHaveLength(1);
	});

	test('sizes the table by the branches and the slots, and keeps two states', () => {
		const { contexts, passes } = fakeContext({ tier: 'webgpu' });
		plantPoses(contexts, windData(50), assetWith(50), field, { trees: 6, slots: 3 });
		const pass = passes[0];
		expect(pass?.kind).toBe('compute');
		// Three texels a branch, or one for each copy's row in the header, whichever is wider, and a
		// row for the header, a row for the air, and a row for each slot.
		expect(pass?.size).toEqual([150, 5]);
		expect(pass?.history).toBe(true);
		expect(pass?.dispatch).toEqual([3, 1, 1]);
		// The field, the branch records and the slot table.
		expect(pass?.textures).toHaveLength(3);
	});

	test('gives a slot to each near copy, and to no copy past the sway distance', () => {
		const { contexts, values, uploads } = fakeContext({ tier: 'webgpu' });
		const poses = plantPoses(contexts, windData(10, 6), assetWith(10), field, {
			trees: 3,
			slots: 3,
		});
		poses?.attach(batchOf(3, 4));
		poses?.update(camera);
		// The copies stand at 0, 4 and 8 m, and the plant sways within 6 m, so two take a slot. The
		// pass reads that count from its values' fourth vector, and each copy's row from the table.
		expect(values.at(-1)?.[15]).toBe(2);
		const table = uploads.at(-1);
		expect(table).toBeDefined();
		// Eight floats a row: the slot's place, its normal matrix and its copy's row.
		expect(table?.[0]).toBeCloseTo(0, 6);
		expect(table?.[1]).toBeCloseTo(0, 6);
		expect(table?.[2]).toBeCloseTo(0, 6);
		expect(table?.[15]).toBe(0);
		expect(table?.[16]).toBeCloseTo(0, 6);
		expect(table?.[17]).toBeCloseTo(0, 6);
		expect(table?.[18]).toBeCloseTo(-4, 6);
		expect(table?.[31]).toBe(1);
	});

	test('gives every copy a slot when the plant sways at every distance', () => {
		const { contexts, values } = fakeContext({ tier: 'webgpu' });
		const poses = plantPoses(contexts, windData(10), assetWith(10), field, { trees: 3, slots: 3 });
		poses?.attach(batchOf(3, 4));
		poses?.update(camera);
		expect(values.at(-1)?.[15]).toBe(3);
	});

	test('refuses a variant whose pose table is wider than the device’s largest texture', () => {
		const { contexts } = fakeContext({ tier: 'webgpu', maxSize: 2048 });
		expect(() => plantPoses(contexts, windData(700), assetWith(700), field, { trees: 4 })).toThrow(
			'largest texture',
		);
	});
});
