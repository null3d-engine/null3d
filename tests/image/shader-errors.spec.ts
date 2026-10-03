// A WGSL error in sketch code reaches the developer on the dev server: Vite's overlay on the page
// shows the null3D plugin's message, the sketch file's line and column, and the code around them.
// The sketch loads in a worker, so the error comes from the worker's request for its module. The
// test starts a dev server of its own, because Vite shows the error on every page of its server,
// and the overlay would cover the pages that other tests click on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import null3d from '../../packages/vite-plugin/src/index.ts';
import { sourceResolve } from '../../tools/lib/source-condition.ts';
import { pageResult } from '../lib/page-result.ts';
import { REPO_ROOT } from '../lib/server.ts';

/** The sketch whose tagged WGSL does not compile, from the repository's root. */
const SKETCH = 'tests/pages/sketches/broken-shader-sketch.ts';

/** The 1-based line and column of the broken value in the sketch. */
function brokenPlace(): string {
	const lines = readFileSync(join(REPO_ROOT, SKETCH), 'utf8').split('\n');
	const line = lines.findIndex((text) => text.includes('vec4f(1.0) 2.0;'));
	return `${line + 1}:${(lines[line] ?? '').indexOf('2.0;') + 1}`;
}

interface ShaderErrorResult {
	error?: string;
	start: { code: string; message: string };
}

test("a WGSL error in a sketch shows in Vite's overlay at the file, line and column", async ({
	page,
}) => {
	const server = await createServer({
		root: REPO_ROOT,
		configFile: false,
		logLevel: 'silent',
		cacheDir: 'node_modules/.vite-shader-errors',
		plugins: [null3d()],
		resolve: sourceResolve,
		optimizeDeps: { noDiscovery: true },
		server: { host: 'localhost', port: 0, watch: null },
	});
	await server.listen();
	try {
		const address = server.resolvedUrls?.local[0];
		await page.goto(`${address}tests/pages/shader-error.html`);
		const result = await pageResult<ShaderErrorResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(result.start.code).toBe('E1410');

		const overlay = page.locator('vite-error-overlay');
		await expect(overlay).toBeAttached({ timeout: 10_000 });
		const shown = await overlay.evaluate((element) => {
			const text = (selector: string) =>
				element.shadowRoot?.querySelector(selector)?.textContent ?? '';
			return { message: text('.message-body'), file: text('.file'), frame: text('.frame') };
		});
		const place = brokenPlace();
		expect(shown.message).toBe(
			`null3D could not compile the WGSL:\n${SKETCH}:${place}: expected \`;\`, found "2.0"`,
		);
		expect(shown.file).toBe(`${join(REPO_ROOT, SKETCH)}:${place}`);
		expect(shown.frame).toContain('    return vec4f(1.0) 2.0;');
	} finally {
		await server.close();
	}
});
