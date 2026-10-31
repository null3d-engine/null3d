// The built module against the TypeScript reference: one view's leaves and one build's vertices,
// compared value for value. The crate is the shipped port, and `reference-builder.ts` is the
// TypeScript that it replaces, so a change to either side that moves a number fails here. The
// module comes from `bun run build`, and CI's build job hands it to the unit tests. A checkout
// without that build skips and says why; CI fails with the same words, so a broken upload cannot
// leave the parity check silently unrun.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Blocks } from './blocks';
import { chunkShape } from './chunk';
import { createHeightfield } from './heightfield';
import { ReferenceTerrainBuilder } from './reference-builder';
import type { TerrainBuilderOptions } from './terrain-builder';
import { run, type TerrainInput } from './terrain-task';

const WASM = fileURLToPath(new URL('../dist/terrain.wasm', import.meta.url));
const built = existsSync(WASM);
const inCI = Boolean(process.env.CI);
const missing = `the built terrain module is missing at ${WASM}; run \`bun run build\` to run this test`;

if (!built && !inCI) console.warn(`${missing}.`);

// CI's build job uploads the module with the page's other WebAssembly, so a missing file there is
// a broken upload rather than a checkout that has not built yet.
test.skipIf(!inCI)('CI hands the unit tests the terrain module', () => {
	if (!built)
		throw new Error(`${missing}. CI's build job uploads it with the page's other WebAssembly.`);
});

const SIZE = 1024;
const QUADS = 16;
const MAX_LEVEL = 5;
const RESOLUTION = 33;
const MAX_BLOCKS = 256;
const BUILDS = 128;
/**
 * A camera off the middle of the ground, and a scale at which the selection mixes levels and its
 * leaves fit one build, so one call compares every level the tree can pick.
 */
const EYE = [120, 60, -80] as const;
const SCALE = 20;

/** Ground with folds at every scale, so the selection mixes levels and the build reads them. */
function height(x: number, z: number): number {
	return 40 * Math.sin(x / 180) * Math.cos(z / 140) + 12 * Math.sin((x + z) / 45);
}

function optionsFor(): TerrainBuilderOptions {
	const field = createHeightfield({ size: SIZE, resolution: RESOLUTION, height });
	const blocks = new Blocks({ size: SIZE, maxLevel: MAX_LEVEL, quads: QUADS, field });
	const shape = chunkShape(QUADS);
	return {
		size: SIZE,
		field,
		blocks,
		ring: shape.ring,
		quads: QUADS,
		maxLevel: MAX_LEVEL,
		vertices: shape.vertices,
		maxBlocks: MAX_BLOCKS,
		builds: BUILDS,
		skirt: undefined,
	};
}

/** A call's input, with the arrays that the add-on hands the worker. */
function inputFor(options: TerrainBuilderOptions): TerrainInput {
	const capacity = Math.max(1024, options.maxBlocks * 4);
	const boxes = options.blocks.boundsLength;
	const lows = new Float32Array(boxes);
	const highs = new Float32Array(boxes);
	options.blocks.packBounds(lows, highs);
	return {
		op: 'select',
		id: 1,
		version: 0,
		size: options.size,
		resolution: options.field.resolution,
		quads: options.quads,
		maxLevel: options.maxLevel,
		boundLevel: options.blocks.boundLevel,
		vertices: options.vertices,
		scale: SCALE,
		eyeX: EYE[0],
		eyeY: EYE[1],
		eyeZ: EYE[2],
		capacity,
		batch: Math.min(capacity, BUILDS),
		count: 0,
		skirt: -1,
		buildLeaves: new Int32Array(Math.min(capacity, BUILDS) * 3),
		heights: options.field.heights,
		lows,
		highs,
		ring: options.ring,
		leaves: new Int32Array(capacity * 3),
		outPositions: new Float32Array(Math.min(capacity, BUILDS) * options.vertices * 3),
		outNormals: new Float32Array(Math.min(capacity, BUILDS) * options.vertices * 3),
		outRecord: new Float32Array(Math.min(capacity, BUILDS) * options.vertices * 4),
	};
}

/** A view's leaves and a build's vertices from the built module, as numbers. */
async function fromModule(module: WebAssembly.Module) {
	const options = optionsFor();
	const input = inputFor(options);
	const selected = run(input, () => module).output;
	const count = selected.count;
	const leaves = Array.from(selected.leaves as Int32Array);
	// A build writes at most one batch, as the add-on's own pipeline asks for them.
	const blocks = Math.min(count, input.batch);
	input.op = 'build';
	input.count = blocks;
	input.buildLeaves.set((selected.leaves as Int32Array).subarray(0, blocks * 3));
	const built = run(input, () => module).output;
	return {
		count,
		blocks,
		leaves,
		positions: built.positions as Float32Array,
		normals: built.normals as Float32Array,
		record: built.record as Float32Array,
		vertices: options.vertices,
	};
}

/** The same view and build from the TypeScript reference. */
async function fromReference() {
	const options = optionsFor();
	const reference = new ReferenceTerrainBuilder(options);
	const count = await reference.select(EYE[0], EYE[1], EYE[2], SCALE);
	const leaves = Array.from(reference.leaves.subarray(0, count * 3));
	const blocks = Math.min(count, reference.batch);
	reference.buildLeaves.set(reference.leaves.subarray(0, blocks * 3));
	await reference.build(blocks);
	return { count, blocks, leaves, slots: reference.slots, vertices: options.vertices };
}

/** The block of `index` in a call's arrays, as numbers. */
function blockOf(array: Float32Array, index: number, stride: number, vertices: number): number[] {
	const at = index * vertices * stride;
	return Array.from(array.subarray(at, at + vertices * stride));
}

describe.skipIf(!built)('the built module against the TypeScript reference', () => {
	test('picks the same leaves and writes the same vertices for one view', async () => {
		const module = await WebAssembly.compile(readFileSync(WASM));
		const mine = await fromModule(module);
		const reference = await fromReference();
		expect(mine.count).toBe(reference.count);
		expect(mine.count).toBeGreaterThan(0);
		expect(mine.leaves).toEqual(reference.leaves);
		expect(mine.blocks).toBe(reference.blocks);
		for (let i = 0; i < mine.blocks; i++) {
			const slot = reference.slots[i];
			if (!slot) throw new Error(`the reference wrote no slot for block ${i}`);
			expect(blockOf(mine.positions, i, 3, mine.vertices)).toEqual(Array.from(slot.positions));
			expect(blockOf(mine.normals, i, 3, mine.vertices)).toEqual(Array.from(slot.normals));
			expect(blockOf(mine.record, i, 4, mine.vertices)).toEqual(Array.from(slot.record));
		}
	});
});
