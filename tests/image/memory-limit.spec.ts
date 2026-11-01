// A heap near its memory limit: each first frame either draws or stops with the error that names
// full memory, whichever way the heap lies, and the core never traps. The draw path sets how much the
// first frame asks for, so each case runs on both paths.
import { expect, type Page, test } from '@playwright/test';

/** How long the page that fills its memory may run before it must have stopped, in milliseconds. */
const FILL_TIME = 240_000;

/** The engine's lowest memory maximum, in MiB. */
const LOWEST_LIMIT = 256;

/** Draws one held frame and returns how it ended. */
async function holdOnce(page: Page, query: Record<string, string>, timeout = 120_000) {
	await page.goto(`/tests/pages/image.html?${new URLSearchParams(query)}`);
	await page.waitForFunction(
		() => (globalThis as { __null3dHold?: unknown }).__null3dHold !== undefined,
		undefined,
		{ timeout },
	);
	return page.evaluate(() => {
		const hold = (globalThis as { __null3dHold?: { ok: boolean; error?: string } }).__null3dHold;
		return { ok: hold?.ok ?? false, error: hold?.error ?? '' };
	});
}

// Small requests cannot report a refusal, so a full heap must meet them with its reserve. Each case
// draws no picture, so a software GPU runs it as fast as a real one.
for (const [name, extra] of [
	['the pages kept under the maximum', {}],
	['the block the heap holds, when growth is refused early', { 'memory-maximum': 'hidden' }],
] as const)
	test(`a heap filled by small requests stops with E1109, using ${name}`, async ({ page }) => {
		test.setTimeout(FILL_TIME + 30_000);
		const printed: string[] = [];
		page.on('console', (message) => {
			if (message.text().startsWith('null3D core:')) printed.push(message.text());
		});
		const { ok, error } = await holdOnce(
			page,
			{
				sketch: '/tests/pages/sketches/memory-fill-sketch.ts',
				hold: '120',
				size: '64x64',
				memory: `${LOWEST_LIMIT}`,
				...extra,
			},
			FILL_TIME,
		);
		expect(ok).toBe(false);
		// The stop names the reserve's size: a larger request would have been refused first.
		expect(error).toContain('E1109');
		expect(error).toContain('could not get 8 MB');
		expect(printed).toEqual([]);
	});

/** The mesh data to try, in MiB: from a first frame that fits the limit to one that does not. */
const MESH_MIB = [70, 85, 100, 110, 120, 130, 140, 160, 200];

/** The memory maximum in MiB that the island scene must draw under, on the direct path's peak. */
const ISLAND_LIMIT = 320;

for (const direct of ['on', 'off'])
	test(`a first frame near the memory limit never traps, direct draws ${direct}`, async ({
		page,
		browserName,
	}) => {
		test.skip(browserName !== 'chromium', 'the draw path switch is for WebGPU');
		test.setTimeout(600_000);
		const ends: string[] = [];
		for (const mib of MESH_MIB) {
			const { ok, error } = await holdOnce(page, {
				sketch: `/tests/pages/sketches/memory-meshes-sketch.ts?mib=${mib}`,
				hold: '1',
				size: '64x64',
				preset: 'high',
				gpu: 'webgpu',
				direct,
				memory: `${LOWEST_LIMIT}`,
			});
			expect(ok || error.includes('E1109'), `${mib} MiB of meshes: ${error}`).toBe(true);
			ends.push(ok ? 'drew' : 'stopped');
		}
		// The runs must pass the limit from below, or they would not have tested a heap near its end.
		expect(ends[0]).toBe('drew');
		expect(ends.at(-1)).toBe('stopped');
	});

test('the island scene draws under a third of the default memory limit on both paths', async ({
	page,
	browserName,
}, info) => {
	test.skip(
		browserName !== 'chromium' || info.project.name !== 'chrome-real-gpu',
		'the scene takes minutes to draw on a software GPU',
	);
	test.setTimeout(600_000);
	for (const direct of ['on', 'off']) {
		const { ok, error } = await holdOnce(page, {
			sketch: '/examples/showcase/island/sketch.ts',
			hold: '1',
			size: '640x360',
			preset: 'high',
			gpu: 'webgpu',
			direct,
			memory: `${ISLAND_LIMIT}`,
		});
		expect(ok, `direct draws ${direct}: ${error}`).toBe(true);
	}
});
