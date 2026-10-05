// Hot updates of WGSL on the dev server, on every GPU tier. A copy of the hot reload fixture runs
// on a dev server of its own, which watches the copy's files. The test edits the WGSL of each of
// the three custom materials in turn: a surface function in a `.wgsl` file, one in a tagged
// template literal, and a full shader in a tagged template literal. Each edit must show in the
// frame with no page reload, and the frames must draw every object meanwhile. WGSL that does not
// compile shows in Vite's overlay while the old shader keeps drawing, and an edit that changes a
// material's uniforms reloads the page.
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { createServer } from 'vite';
import { TIERS } from '../../packages/cli/src/page.js';
import null3d from '../../packages/vite-plugin/src/index.ts';
import { sourceResolve } from '../../tools/lib/source-condition.ts';
import { REPO_ROOT } from '../lib/server.ts';

/** What the fixture's page publishes for the test. */
interface HotPage {
	__hot: {
		engine: { measure(seconds: number): Promise<{ skippedDraws: number; pipelines: number }> };
		colors(): Promise<number[][]>;
		load: number;
	};
}

/**
 * The channel that a pixel shows most clearly, or `other` for a dark pixel or one without a clear
 * channel. The tone curve brightens the other channels of a bright pure color a little.
 */
function colorOf([r = 0, g = 0, b = 0]: number[]): string {
	const [second = 0, most = 0] = [r, g, b].sort((x, y) => x - y).slice(1);
	if (most < 60 || most - second < 40) return 'other';
	return most === r ? 'red' : most === g ? 'green' : 'blue';
}

/** The color of each column of the frame: left, middle and right. */
async function columns(page: Page): Promise<string[]> {
	const colors = await page.evaluate(() => (globalThis as unknown as HotPage).__hot.colors());
	return colors.map(colorOf);
}

/** Waits until the columns show `expected`, and returns how long that took in milliseconds. */
async function shows(page: Page, expected: string[], timeoutMs = 20_000): Promise<number> {
	const start = performance.now();
	await expect.poll(() => columns(page), { timeout: timeoutMs, intervals: [50] }).toEqual(expected);
	return performance.now() - start;
}

/** The number that the page draws anew each time it loads. */
function loadOf(page: Page): Promise<number> {
	return page.evaluate(() => (globalThis as unknown as HotPage).__hot.load);
}

/** Replaces text in a file of the copy, which must hold it. */
function edit(file: string, from: string, to: string): void {
	const text = readFileSync(file, 'utf8');
	if (!text.includes(from)) throw new Error(`${file} does not hold ${from}`);
	writeFileSync(file, text.replace(from, to));
}

for (const tier of TIERS) {
	test(`WGSL edits show without a page reload on ${tier}`, async ({ page }) => {
		test.setTimeout(180_000);
		const root = join(REPO_ROOT, 'target/hot-reload', `${tier}-${process.pid}`);
		rmSync(root, { recursive: true, force: true });
		mkdirSync(root, { recursive: true });
		cpSync(join(REPO_ROOT, 'tests/fixtures/hot-reload'), root, { recursive: true });
		// The copy imports the engine as the test pages do, from the packages that they install.
		symlinkSync(join(REPO_ROOT, 'tests/node_modules'), join(root, 'node_modules'));
		const server = await createServer({
			root,
			configFile: false,
			logLevel: 'silent',
			cacheDir: join(root, '.vite'),
			plugins: [null3d()],
			resolve: sourceResolve,
			optimizeDeps: { noDiscovery: true },
			server: { host: 'localhost', port: 0 },
		});
		await server.listen();
		try {
			await page.goto(`${server.resolvedUrls?.local[0]}?gpu=${tier}`);
			await page.waitForFunction(() => '__hot' in globalThis, null, { timeout: 60_000 });
			await shows(page, ['red', 'blue', 'green'], 30_000);
			const load = await loadOf(page);
			const tint = join(root, 'tint.wgsl');
			const sketch = join(root, 'sketch.ts');

			// Each edit shows with every object drawn in every frame meanwhile.
			const measured = page.evaluate(() =>
				(globalThis as unknown as HotPage).__hot.engine.measure(6),
			);
			edit(tint, 'vec3f(1.0, 0.0, 0.0)', 'vec3f(0.0, 1.0, 0.0)');
			const fileMs = await shows(page, ['green', 'blue', 'green']);
			edit(sketch, 's.emissive = vec3f(0.0, 0.0, 1.0)', 's.emissive = vec3f(1.0, 0.0, 0.0)');
			const literalMs = await shows(page, ['green', 'red', 'green']);
			edit(sketch, 'finish(vec3f(0.0, 1.0, 0.0)', 'finish(vec3f(0.0, 0.0, 1.0)');
			const fullMs = await shows(page, ['green', 'red', 'blue']);
			const stats = await measured;
			// The times from each edit to its first frame read back, for the guides' figures.
			const description = `${tier}: file ${fileMs.toFixed(0)} ms, literal ${literalMs.toFixed(0)} ms, full shader ${fullMs.toFixed(0)} ms`;
			test.info().annotations.push({ type: 'hot update', description });
			console.log(`hot update ${description}`);
			expect(stats.skippedDraws).toBe(0);
			expect(stats.pipelines).toBeGreaterThan(0);
			expect(await loadOf(page)).toBe(load);

			// WGSL that does not compile shows in the overlay, and the old shader keeps drawing.
			edit(tint, 'vec3f(0.0, 1.0, 0.0)', 'vec3f(0.0, 1.0, 0.0) 2.0');
			const overlay = page.locator('vite-error-overlay');
			await expect(overlay).toBeAttached({ timeout: 20_000 });
			const message = await overlay.evaluate(
				(element) => element.shadowRoot?.querySelector('.message-body')?.textContent ?? '',
			);
			expect(message).toContain('null3D could not compile the WGSL:\ntint.wgsl:6:');
			expect(await columns(page)).toEqual(['green', 'red', 'blue']);
			// The fix closes the overlay and shows.
			edit(tint, 'vec3f(0.0, 1.0, 0.0) 2.0', 'vec3f(0.0, 0.0, 1.0)');
			await shows(page, ['blue', 'red', 'blue']);
			await expect(overlay).not.toBeAttached();
			expect(await loadOf(page)).toBe(load);

			// A new uniform changes what the page keeps of the material, so the page reloads.
			edit(
				tint,
				'struct Uniforms { strength: f32 }',
				'struct Uniforms { strength: f32, gain: f32 }',
			);
			await expect.poll(() => loadOf(page).catch(() => load), { timeout: 30_000 }).not.toBe(load);
		} finally {
			await server.close();
			rmSync(root, { recursive: true, force: true });
		}
	});
}
