// Runs the F10 upscaler probe on this computer's GPU and writes its figures beside the page.
// It serves index.html from a small local server, opens it in the installed Chrome through
// Playwright, waits for the page's measurements, and writes one JSON record for each canvas size
// and mip bias. The page itself holds the scene and the four upscalers; this driver only starts it
// and collects the result.
//
// Usage:
//   bun bench/probes/f10-upscalers/run.ts
//   bun bench/probes/f10-upscalers/run.ts --size 1920x1080,1280x720 --mip 0,1
//   bun bench/probes/f10-upscalers/run.ts --out results-mac.json --samples 11 --repeats 60
//
// A timing run must start from a quiet Mac, through the coordination script:
//   QUIET_OK=1 HEAVY_MAX_LOAD=8 zsh .internal/coordination/heavy.sh \
//     bun bench/probes/f10-upscalers/run.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChromium } from '../../../packages/cli/src/browser.js';
import { refuseInQuietWindow } from '../../../tools/lib/quiet-window.ts';

refuseInQuietWindow('The upscaler probe');

interface ProbeResult {
	config: Record<string, unknown>;
	gpu: Record<string, unknown>;
	timer: string;
	timings: Record<string, { median: number; samples: number[]; method: string }>;
	pipelines: Record<string, number>;
	metrics: Record<
		string,
		{ mae: number; psnr: number; ssim: number; sharpness: number; referenceSharpness: number }
	>;
	error?: string;
	done: boolean;
	log: string[];
}

declare global {
	interface Window {
		__probe?: ProbeResult;
	}
}

const here = import.meta.dir;
const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
	const index = args.indexOf(name);
	return index === -1 ? fallback : (args[index + 1] ?? fallback);
}
const sizes = option('--size', '1920x1080,1280x720')
	.split(',')
	.map((text) => {
		const match = /^(\d+)x(\d+)$/.exec(text.trim());
		if (!match) throw new Error(`--size takes WIDTHxHEIGHT, not ${text}`);
		return text.trim();
	});
const mips = option('--mip', '0,1')
	.split(',')
	.map((text) => {
		const value = text.trim();
		if (value !== '0' && value !== '1') throw new Error(`--mip takes 0 or 1, not ${value}`);
		return value;
	});
const scale = option('--scale', '0.5');
const samples = option('--samples', '9');
const repeats = option('--repeats', '40');
const show = option('--show', 'gsr');
const screenshot = option('--screenshot', '');
const extra = option('--extra', '');
const output = join(here, option('--out', 'results-mac.json'));

const page = readFileSync(join(here, 'index.html'), 'utf8');
const server = Bun.serve({
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/' || url.pathname === '/index.html')
			return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
		return new Response('not found', { status: 404 });
	},
});
const base = `http://127.0.0.1:${server.port}/`;
console.log(`serving the probe at ${base}`);

const browser = await launchChromium({
	headless: false,
	channel: 'chrome',
	args: [
		'--window-position=-2000,80',
		'--window-size=900,1000',
		'--disable-background-timer-throttling',
		'--disable-renderer-backgrounding',
		'--disable-backgrounding-occluded-windows',
	],
});

const results: ProbeResult[] = [];
try {
	const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
	for (const size of sizes)
		for (const mip of mips) {
			const query = `?size=${size}&scale=${scale}&mip=${mip}&samples=${samples}&repeats=${repeats}&show=${show}${extra ? `&${extra}` : ''}`;
			console.log(`\n${size}, scale ${scale}, mip bias ${mip === '1' ? -1 : 0}\n  ${base}${query}`);
			const tab = await context.newPage();
			tab.on('console', (message) => console.log(`  page: ${message.text()}`));
			tab.on('pageerror', (error) => console.log(`  page error: ${error.message}`));
			await tab.goto(base + query);
			await tab.waitForFunction(() => window.__probe?.done === true, undefined, {
				timeout: 10 * 60_000,
				polling: 500,
			});
			const result = (await tab.evaluate(() => window.__probe)) as ProbeResult;
			if (screenshot)
				await tab
					.locator('canvas')
					.screenshot({ path: `${screenshot.replace(/\.png$/, '')}-${size}-mip${mip}.png` });
			await tab.close();
			if (result.error) throw new Error(`the page failed: ${result.error}`);
			results.push(result);
			const gpu = result.gpu.unmaskedRenderer ?? result.gpu.renderer;
			console.log(`  gpu ${gpu}, timer ${result.timer}`);
			console.log('  pass                    ms');
			for (const [name, timing] of Object.entries(result.timings))
				console.log(`  ${name.padEnd(20)} ${timing.median.toFixed(3)}`);
			console.log('  pipeline               ms      MAE    PSNR    SSIM  sharpness');
			for (const [name, ms] of Object.entries(result.pipelines)) {
				const metric = result.metrics[name];
				console.log(
					`  ${name.padEnd(20)} ${ms.toFixed(3).padStart(6)} ${metric.mae.toFixed(2).padStart(7)}` +
						` ${metric.psnr.toFixed(2).padStart(7)} ${metric.ssim.toFixed(4).padStart(7)}` +
						` ${(metric.sharpness / metric.referenceSharpness).toFixed(3).padStart(9)}`,
				);
			}
		}
} finally {
	await browser.close();
	server.stop(true);
}

writeFileSync(output, `${JSON.stringify({ run: new Date().toISOString(), results }, null, 2)}\n`);
console.log(`\nwrote ${output}`);
