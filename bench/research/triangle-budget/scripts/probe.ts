// Opens one page of the study's dev server in Chrome for Testing, waits, and saves a screenshot of
// its canvas, to check by eye what a page draws.
// Run from the repository's root:
//   bun bench/research/triangle-budget/scripts/probe.ts '<path?query>' <seconds> <out.png>
import { join } from 'node:path';
import { GPU_TIMING_ARGS } from '../../../../packages/cli/src/browser.js';
import { launchInWindow, newParkedPage } from '../../../../tests/lib/app-window.ts';
import { chromeForTesting } from '../../../../tests/lib/chrome-for-testing.ts';

const [path, seconds, out] = process.argv.slice(2) as [string, string, string];
const root = join(import.meta.dirname, '../../../..');
const port = Number(process.env.TB_PORT ?? 6530);
const server = Bun.spawn(
	['bunx', 'vite', '--config', join(import.meta.dirname, '../vite.config.ts')],
	{
		cwd: root,
		// The probe reaches the study's server over the loopback, which is a secure origin already,
		// and its readiness poll and page loads use plain HTTP.
		env: { ...process.env, TB_PORT: String(port), NULL3D_HTTPS: '0' },
		stdout: 'ignore',
		stderr: 'inherit',
	},
);
for (let i = 0; i < 120; i++) {
	if (
		await fetch(`http://localhost:${port}/`).then(
			() => true,
			() => false,
		)
	)
		break;
	await new Promise((resolve) => setTimeout(resolve, 500));
}
const browser = await launchInWindow({
	executablePath: chromeForTesting().executablePath,
	args: GPU_TIMING_ARGS,
});
try {
	const page = await newParkedPage(browser, { viewport: { width: 1920, height: 1080 } });
	page.on('console', (m) => console.log(`console ${m.type()}: ${m.text().slice(0, 500)}`));
	page.on('pageerror', (e) => console.log(`page error: ${e}`));
	await page.goto(`http://localhost:${port}/${path}`);
	await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
	await page.locator('canvas').first().screenshot({ path: out });
	console.log(`saved ${out}`);
} finally {
	await browser.close();
	server.kill();
}
