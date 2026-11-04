// Visits the built Island view pages in rotated order, and takes several short windows on each
// visit after its warm-up, with the load and the busiest apps at each visit.
// bun facing-window-runner.ts <out.jsonl> <visits per copy> <folder,folder,...> [query]
import { appendFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const W = process.env.WT as string;
const [out, visitsText, foldersText, query = ''] = process.argv.slice(2) as [
	string,
	string,
	string,
	string?,
];
const visits = Number(visitsText);
const folders = foldersText.split(',');
const { GPU_TIMING_ARGS } = await import(`${W}/packages/cli/src/browser.js`);
const { launchInWindow, newParkedPage } = await import(`${W}/tests/lib/app-window.ts`);
const { chromeForTesting } = await import(`${W}/tests/lib/chrome-for-testing.ts`);
const UNCAPPED = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
const base = 6651;
const servers = folders.map((folder, k) =>
	Bun.spawn(
		['bunx', 'vite', 'preview', '--outDir', folder, '--port', String(base + k), '--strictPort'],
		{
			cwd: W,
			stdout: 'ignore',
			stderr: 'ignore',
		},
	),
);
await new Promise((resolve) => setTimeout(resolve, 6000));
const text = async (cmd: string[]) => (await new Response(Bun.spawn(cmd).stdout).text()).trim();
async function gate(): Promise<number> {
	const until = Date.now() + 15 * 60_000;
	while ((loadavg()[0] ?? 99) >= 8 && Date.now() < until)
		await new Promise((r) => setTimeout(r, 10_000));
	return loadavg()[0] ?? 99;
}
const browser = await launchInWindow({
	...chromeForTesting(),
	args: [...GPU_TIMING_ARGS, ...UNCAPPED],
});
try {
	for (let visit = 0; visit < visits; visit++)
		for (let k = 0; k < folders.length; k++) {
			const at = (k + visit) % folders.length;
			const folder = folders[at] as string;
			for (let attempt = 0; attempt < 3; attempt++) {
				const gated = await gate();
				const apps = (await text(['ps', '-Ao', 'pcpu,comm', '-r']))
					.split('\n')
					.slice(1, 6)
					.map((line) => line.trim().replace(/\s+/, ' ').slice(0, 90));
				const page = await newParkedPage(browser, { viewport: { width: 1600, height: 900 } });
				const problems: string[] = [];
				page.on('pageerror', (e) => problems.push(String(e)));
				page.on('console', (m) => {
					if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text().slice(0, 300));
				});
				await page.goto(`http://localhost:${base + at}/tests/pages/island-view.html?${query}`);
				const result = await page
					.waitForFunction(
						() => (globalThis as { __null3dResult?: unknown }).__null3dResult,
						null,
						{
							timeout: 600_000,
							polling: 1000,
						},
					)
					.then(
						() => page.evaluate(() => (globalThis as { __null3dResult?: unknown }).__null3dResult),
						(e) => ({ error: String(e) }),
					);
				await page.close();
				const after = loadavg()[0] ?? 99;
				const bad =
					problems.some((p) => !p.startsWith('Failed to load resource')) ||
					// biome-ignore lint/suspicious/noExplicitAny: scratch
					!(result as any)?.windows;
				appendFileSync(
					out,
					`${JSON.stringify({ folder, visit, attempt, gated, after, apps, bad, problems, result })}\n`,
				);
				// biome-ignore lint/suspicious/noExplicitAny: scratch
				const w = ((result as any)?.windows ?? []) as any[];
				console.log(
					`${folder} visit ${visit}${bad ? ' INVALID' : ''} load ${gated.toFixed(1)}->${after.toFixed(1)}: gpu ${w.map((x) => x.gpuMs?.median?.toFixed(2)).join(' ')} | ${apps[0]}${bad ? ` | ${problems[0]}` : ''}`,
				);
				if (!bad) break;
			}
		}
} finally {
	await browser.close();
	for (const server of servers) server.kill();
}
