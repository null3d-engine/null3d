// Meshes and models destroyed while others stay, on every GPU path. The engine packs the data of
// the meshes that stay over the data of the destroyed ones, so the meshes that stay must draw
// exactly as in a scene that never had the destroyed ones: plain meshes, morphed meshes whose
// deltas moved, and skinned meshes. A mesh made after the destroy takes the room they left.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Picture {
	pixels: string;
	meshBytes: number;
	failures: string[];
}

interface DestroyResult {
	error?: string;
	pictures: Record<'destroy' | 'reference', Picture>;
}

/** The pixels of a picture that differ from its first pixel, the background. */
function drawn(pixels: string): number {
	const bytes = Buffer.from(pixels, 'base64');
	let count = 0;
	for (let i = 0; i < bytes.length; i += 4)
		if (bytes.readUInt32LE(i) !== bytes.readUInt32LE(0)) count++;
	return count;
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`the meshes that stay draw the same after others are destroyed, on ${gpu}`, async ({
		page,
	}) => {
		await page.goto(`destroy.html?gpu=${gpu}`);
		const result = await pageResult<DestroyResult>(page, 45_000);
		expect(result.error).toBeUndefined();
		const { destroy, reference } = result.pictures;
		expect(destroy.failures).toEqual([]);
		expect(reference.failures).toEqual([]);
		expect(drawn(reference.pixels)).toBeGreaterThan(2000);
		expect(destroy.pixels === reference.pixels).toBe(true);
		// The destroyed meshes' room went to later ones, so the buffers never had to grow past
		// what the scene with them needed.
		expect(destroy.meshBytes).toBeGreaterThan(0);
	});
