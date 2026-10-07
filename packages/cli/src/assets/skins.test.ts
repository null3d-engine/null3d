import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { readFileSync } from 'node:fs';
import { shippedDecoder } from '../../../../tests/lib/meshopt-checks.ts';
import { samplePath } from '../../../../tools/lib/samples.ts';
import {
	type GltfData,
	type MeshoptDecode,
	parseGltf,
	readContainer,
} from '../../../engine/src/scene/gltf-parse.ts';
import { encodeOnce, encoderPool } from './encoder-pool.js';
import { DEFAULT_OPTIONS, optimizeModel } from './pipeline.js';

// Texture encodes take seconds each on a busy machine or a CI runner of four cores.
setDefaultTimeout(60_000);

const pool = encoderPool(2);
const encode = encodeOnce((job) => pool.encode(job));
afterAll(() => pool.close());

/** Small textures, since these tests read only the meshes. */
const OPTIONS = { ...DEFAULT_OPTIONS, maxTextureSize: 32 };

const KNIGHT = samplePath('sources/characters/kaykit-knight/Knight.glb');

/** A file's data as the engine's loader parses it, with the buffers inside it. */
const parse = (glb: Uint8Array, decode?: MeshoptDecode): GltfData =>
	parseGltf(
		readContainer(glb, 'https://example.com/knight.glb'),
		new Map(),
		'https://example.com/knight.glb',
		decode,
	);

type Box = { min: number[]; max: number[] };

/** The box of each mesh that a skin moves, by its node's name. */
function skinnedBoxes(data: GltfData): Map<string, Box> {
	const boxes = new Map<string, Box>();
	for (const node of data.nodes) {
		if (!node.skinned || node.skin < 0) continue;
		const box = boxes.get(node.name) ?? {
			min: [Infinity, Infinity, Infinity],
			max: [-Infinity, -Infinity, -Infinity],
		};
		for (const p of data.meshes[node.mesh]?.primitives ?? [])
			for (let axis = 0; axis < 3; axis++) {
				box.min[axis] = Math.min(box.min[axis] as number, p.min[axis] as number);
				box.max[axis] = Math.max(box.max[axis] as number, p.max[axis] as number);
			}
		boxes.set(node.name, box);
	}
	return boxes;
}

describe('the boxes of skinned meshes', async () => {
	const [source, optimized] = await Promise.all([
		parse(new Uint8Array(readFileSync(KNIGHT))),
		optimizeModel(KNIGHT, OPTIONS, encode).then(async (model) =>
			parse(model.glb, await shippedDecoder()),
		),
	]);

	it("hold the Knight's body in meters, as its joints place it at rest", () => {
		const boxes = skinnedBoxes(source);
		expect(boxes.size).toBeGreaterThan(0);
		const all = [...boxes.values()];
		const low = Math.min(...all.map((b) => b.min[1] as number));
		const high = Math.max(...all.map((b) => b.max[1] as number));
		const wide = Math.max(...all.map((b) => (b.max[0] as number) - (b.min[0] as number)));
		// The Knight stands about 2.4 m tall on the ground.
		expect(low).toBeGreaterThan(-0.1);
		expect(high).toBeGreaterThan(2);
		expect(high).toBeLessThan(3);
		expect(wide).toBeLessThan(3);
	});

	it('are the same after the asset tool stores the positions as integers', () => {
		const before = skinnedBoxes(source);
		const after = skinnedBoxes(optimized);
		expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
		for (const [name, box] of after) {
			const want = before.get(name) as Box;
			for (let axis = 0; axis < 3; axis++) {
				// A 14-bit step of the Knight's volume is under a millimeter.
				expect(Math.abs((box.min[axis] as number) - (want.min[axis] as number))).toBeLessThan(1e-3);
				expect(Math.abs((box.max[axis] as number) - (want.max[axis] as number))).toBeLessThan(1e-3);
			}
		}
	});
});
