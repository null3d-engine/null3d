// Measures a cold start of the engine on a slow network: it builds the engine test page for
// production, serves the build on the production preview's port (tests/lib/server.ts), and loads
// it in a fresh Chrome profile, whose cache starts empty, with Chrome's Slow 4G profile. It prints
// each run's startup milestones, requests and bytes, and their medians. `--switches` adds the
// engine's page switches, which pick another thread mode.
// From the repository root:
//   bun run bench:startup                 (3 runs on WebGPU, pipelined)
//   bun run bench:startup -- --runs 5 --gpu webgl2
//   bun run bench:startup -- --switches latency=low
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { pageResult } from '../tests/lib/page-result.ts';
import { PREVIEW_PORT, REPO_ROOT } from '../tests/lib/server.ts';
import { median } from './lib/report.ts';

/** Chrome's Slow 4G profile: 562.5 ms round trips, 1.4 Mbps down and 675 kbps up, at 90%. */
const SLOW_4G = {
	offline: false,
	latency: 562.5,
	downloadThroughput: ((1.4 * 1_000_000) / 8) * 0.9,
	uploadThroughput: ((675 * 1000) / 8) * 0.9,
};
const URL_BASE = `http://localhost:${PREVIEW_PORT}/tests/pages/engine.html`;

interface StartupRun {
	/** From the start of createEngine: the GPU probe, the core's download and compile, and all. */
	probeMs: number;
	coreMs: number;
	engineReadyMs: number;
	/** Navigation start until the GPU finished the first frame. */
	firstFrameMs: number;
	requests: number;
	kilobytes: number;
}

function startPreview(): Promise<ChildProcess> {
	const child = spawn('bunx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return new Promise((resolve, reject) => {
		const deadline = setTimeout(() => reject(new Error('vite preview did not start')), 30_000);
		child.stdout?.on('data', (chunk: Buffer) => {
			if (chunk.toString().includes(String(PREVIEW_PORT))) {
				clearTimeout(deadline);
				resolve(child);
			}
		});
	});
}

async function measure(gpu: string, switches: string): Promise<StartupRun> {
	const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
		// The page's requests and its workers' requests, as the network delivered them.
		let requests = 0;
		let bytes = 0;
		const sizes: Promise<void>[] = [];
		context.on('requestfinished', (request) => {
			requests++;
			sizes.push(
				request.sizes().then(
					(size) => {
						bytes += size.responseBodySize + size.responseHeadersSize;
					},
					() => {},
				),
			);
		});
		const query = [`gpu=${gpu}`, 'seconds=0.2', switches].filter(Boolean).join('&');
		await page.goto(`${URL_BASE}?${query}`, { timeout: 120_000 });
		const result = await pageResult<{
			error?: string;
			stats: {
				load: { engineStartMs: number; probeMs: number; coreMs: number; firstFrameDoneMs: number };
			};
		}>(page, 180_000);
		if (result.error) throw new Error(result.error);
		await Promise.all(sizes);
		const { load } = result.stats;
		return {
			probeMs: load.probeMs,
			coreMs: load.coreMs,
			engineReadyMs: load.engineStartMs,
			firstFrameMs: load.firstFrameDoneMs,
			requests,
			kilobytes: bytes / 1024,
		};
	} finally {
		await browser.close();
	}
}

const { values } = parseArgs({
	options: {
		runs: { type: 'string', default: '3' },
		gpu: { type: 'string', default: 'webgpu' },
		switches: { type: 'string', default: '' },
	},
});
const build = spawnSync('bunx', ['vite', 'build'], { cwd: REPO_ROOT, encoding: 'utf8' });
if (build.status !== 0) throw new Error(`the production build failed:\n${build.stderr}`);
const preview = await startPreview();
try {
	const runs: StartupRun[] = [];
	for (let run = 0; run < Number(values.runs); run++)
		runs.push(await measure(values.gpu, values.switches));
	const row = (label: string, r: StartupRun) =>
		`| ${label} | ${r.probeMs.toFixed(0)} | ${r.coreMs.toFixed(0)} | ${r.engineReadyMs.toFixed(0)} | ${r.firstFrameMs.toFixed(0)} | ${r.requests} | ${r.kilobytes.toFixed(0)} |`;
	const switches = values.switches ? ` with ?${values.switches}` : '';
	console.log(`Cold start on ${values.gpu}${switches}, Slow 4G, empty cache, production build`);
	console.log(
		'| Run | Probe done, ms | Core ready, ms | Engine ready, ms | First frame on screen, ms from navigation | Requests | KB |',
	);
	console.log('| --- | --- | --- | --- | --- | --- | --- |');
	for (const [i, r] of runs.entries()) console.log(row(String(i + 1), r));
	const pick = (key: keyof StartupRun) => median(runs.map((r) => r[key]));
	console.log(
		row('Median', {
			probeMs: pick('probeMs'),
			coreMs: pick('coreMs'),
			engineReadyMs: pick('engineReadyMs'),
			firstFrameMs: pick('firstFrameMs'),
			requests: pick('requests'),
			kilobytes: pick('kilobytes'),
		}),
	);
} finally {
	preview.kill();
}
