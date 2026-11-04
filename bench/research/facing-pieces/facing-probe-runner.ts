// Opens the built Island probe page of each folder in turn and saves each result as JSON.
// bun facing-probe-runner.ts <out-prefix> <folder>[,<folder>...] [query]
import { writeFileSync } from 'node:fs';

const W = process.env.WT as string;
const [prefix, foldersText, query = ''] = process.argv.slice(2) as [string, string, string?];
const { GPU_TIMING_ARGS } = await import(`${W}/packages/cli/src/browser.js`);
const { launchInWindow, newParkedPage } = await import(`${W}/tests/lib/app-window.ts`);
const { chromeForTesting } = await import(`${W}/tests/lib/chrome-for-testing.ts`);
const port = 6646;
const browser = await launchInWindow({ ...chromeForTesting(), args: [...GPU_TIMING_ARGS] });
try {
	for (const folder of foldersText.split(',')) {
		const server = Bun.spawn(
			['bunx', 'vite', 'preview', '--outDir', folder, '--port', String(port), '--strictPort'],
			{ cwd: W, stdout: 'ignore', stderr: 'ignore' },
		);
		await new Promise((resolve) => setTimeout(resolve, 6000));
		const page = await newParkedPage(browser, { viewport: { width: 1600, height: 900 } });
		const problems: string[] = [];
		page.on('console', (m) => {
			if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text().slice(0, 300));
		});
		await page.goto(`http://localhost:${port}/tests/pages/island-probe.html?${query}`);
		const trail = setInterval(() => {
			page
				.evaluate(() => {
					const t = (globalThis as { __null3dProgress?: string[] }).__null3dProgress ?? [];
					return `${t.length}: ${t.slice(-2).join(' | ')}`;
				})
				.then((t) => console.log(`progress ${t.slice(0, 300)}`))
				.catch(() => {});
		}, 15_000);
		const result = await page
			.waitForFunction(() => (globalThis as { __null3dResult?: unknown }).__null3dResult, null, {
				timeout: 1_500_000,
				polling: 2000,
			})
			.then(
				() => page.evaluate(() => (globalThis as { __null3dResult?: unknown }).__null3dResult),
				(e) => ({ error: String(e) }),
			);
		clearInterval(trail);
		const name = folder.split('/').pop();
		writeFileSync(`${prefix}-${name}.json`, JSON.stringify({ folder, query, result, problems }));
		console.log(`${folder}: done, ${problems.length} problems`);
		await page.close();
		server.kill();
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
} finally {
	await browser.close();
}
