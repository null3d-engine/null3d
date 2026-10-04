// The trees that the asset tool stores in a model, in a live engine. The stored trees page casts
// the same seeded rays through a model with a stored tree for every part and through the same
// model without them: the hits must be the same on both GPU paths. The engine takes every stored
// tree, so it warns of none. A tree that does not fit its part's triangles is refused with a
// warning, and the part builds its own, with the same hits.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import type { GltfJson } from '../pages/lib/gltf-files.ts';
import type { StoredTreeResults } from '../pages/lib/stored-trees.ts';

interface StoredTreesPage {
	error?: string;
	results: StoredTreeResults;
	failures: string[];
}

/** What the engine warns when a stored tree does not fit its part. */
const NO_FIT = /found a stored tree in .* that does not fit primitive \d+ of mesh "([^"]*)"/;

/** Opens the page with `switches`, and returns its result and the parts whose trees it refused. */
async function open(page: Page, switches: string) {
	const logs: string[] = [];
	// The page's console events carry its workers' messages too, so each warning arrives once.
	page.on('console', (message) => logs.push(message.text()));
	await page.goto(`stored-trees.html?${switches}`);
	const result = await pageResult<StoredTreesPage>(page, 60_000);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	const refused = logs.flatMap((line) => NO_FIT.exec(line)?.[1] ?? []).sort();
	return { results: result.results, refused };
}

/** The same hits through both copies, with enough rays that hit to mean something. */
function expectSameHits(results: StoredTreeResults, where: string) {
	expect([where, results.mismatches, results.examples]).toEqual([where, 0, []]);
	expect(results.rays).toBe(2000);
	expect(results.hits).toBeGreaterThan(1000);
}

/**
 * A binary glTF file whose JSON `change` edits. The JSON chunk is padded with spaces to a whole
 * number of words, and the binary chunk follows unchanged.
 */
function withJson(glb: Buffer, change: (json: GltfJson) => void): Buffer {
	const length = glb.readUInt32LE(12);
	const json = JSON.parse(glb.subarray(20, 20 + length).toString());
	change(json);
	const text = Buffer.from(JSON.stringify(json));
	const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
	const rest = glb.subarray(20 + length);
	const head = Buffer.alloc(20);
	head.writeUInt32LE(0x46546c67, 0);
	head.writeUInt32LE(2, 4);
	head.writeUInt32LE(20 + padded.length + rest.length, 8);
	head.writeUInt32LE(padded.length, 12);
	head.writeUInt32LE(0x4e4f534a, 16);
	return Buffer.concat([head, padded, rest]);
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a model with stored trees gives the hits of one without them, on ${gpu}`, async ({
		page,
	}) => {
		const { results, refused } = await open(page, `gpu=${gpu}`);
		expectSameHits(results, gpu);
		expect(refused).toEqual([]);
	});

test('a stored tree that does not fit its part is refused, and the part builds its own', async ({
	page,
}) => {
	// The ball's and the stand's trees change places, so neither fits its part's triangles.
	await page.route('**/asset-scene-trees.glb', async (route) => {
		const response = await route.fetch();
		const body = withJson(await response.body(), (json) => {
			const prims = json.meshes.map(
				(mesh: GltfJson) => mesh.primitives[0].extensions.NULL3D_mesh_bvh,
			);
			const [ball, stand] = [0, 1].map((k) => json.meshes[k].name);
			expect([ball, stand]).toEqual(['ball', 'stand']);
			[prims[0].tree, prims[1].tree] = [prims[1].tree, prims[0].tree];
		});
		await route.fulfill({ response, body });
	});
	const { results, refused } = await open(page, 'gpu=webgl2');
	expectSameHits(results, 'webgl2');
	expect(refused).toEqual(['ball', 'stand']);
});
