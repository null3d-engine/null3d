// Runs the test pages in real browser apps that Playwright cannot drive, such as Safari. It starts
// the dev server, opens each page with macOS's `open` command, waits for the page's report, and
// checks it against the same references the Playwright tests use. Run from the repository root:
//   bun tests/real-browsers.ts Safari Firefox
//   bun tests/real-browsers.ts --allow-no-webgpu Safari   (a missing WebGPU adapter is a skip)
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareToReference } from './lib/images.ts';
import { REPORT_DIR } from './lib/report-collector.ts';

const BASE_URL = 'http://localhost:5173';
const PAGE_TIMEOUT_MS = 60_000;
const SERVER_TIMEOUT_MS = 30_000;

interface PageCheck {
	page: 'clear' | 'isolation' | 'engine';
	query: string;
	tier?: 'webgpu' | 'webgl2';
	/** For engine checks: the thread that should draw. */
	renderThread?: string;
}

const ENGINE_MODES = [
	{ query: '', renderThread: 'render-worker' },
	{ query: '&latency=low', renderThread: 'game-worker' },
	{ query: '&threads=off', renderThread: 'main' },
] as const;

const CHECKS: PageCheck[] = [
	{ page: 'clear', query: 'gpu=webgpu', tier: 'webgpu' },
	{ page: 'clear', query: 'gpu=webgl2', tier: 'webgl2' },
	{ page: 'isolation', query: '' },
	...(['webgpu', 'webgl2'] as const).flatMap((tier) =>
		ENGINE_MODES.map((mode) => ({
			page: 'engine' as const,
			query: `gpu=${tier}&seconds=2${mode.query}`,
			tier,
			renderThread: mode.renderThread,
		})),
	),
];

/** Slower than this median frame interval means the engine's loop is not keeping up with the display. */
const MAX_MEDIAN_INTERVAL_MS = 34;
const MIN_FRAMES = 30;

interface Report {
	url: string;
	ok: boolean;
	error?: string;
	width?: number;
	height?: number;
	pixels?: string;
	crossOriginIsolated?: boolean;
	threaded?: boolean;
	mode?: { renderThread: string };
	capabilities?: { tier: string };
	intervals?: { count: number; median: number };
	count?: { updates: number };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(): Promise<void> {
	const deadline = Date.now() + SERVER_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(`${BASE_URL}/index.html`)).ok) return;
		} catch {
			// not listening yet
		}
		await sleep(250);
	}
	throw new Error('the dev server did not start');
}

/** The report whose page URL carries this run ID, once it arrives. */
async function waitForReport(page: string, runId: string): Promise<Report> {
	const file = join(REPORT_DIR, `${page}.jsonl`);
	const deadline = Date.now() + PAGE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (existsSync(file)) {
			for (const line of readFileSync(file, 'utf8').split('\n')) {
				if (line.includes(runId)) return JSON.parse(line) as Report;
			}
		}
		await sleep(250);
	}
	throw new Error(`no report from ${page} within ${PAGE_TIMEOUT_MS / 1000} s`);
}

/** Problems with one report, or 'skip' when a missing WebGPU adapter is allowed. */
export function judge(check: PageCheck, report: Report, allowNoWebGPU: boolean): string[] | 'skip' {
	if (!report.ok) {
		if (allowNoWebGPU && check.tier === 'webgpu' && report.error === 'no WebGPU adapter')
			return 'skip';
		return [report.error ?? 'the page failed without a message'];
	}
	if (check.page === 'engine') {
		const problems: string[] = [];
		if (report.mode?.renderThread !== check.renderThread)
			problems.push(`drew on ${report.mode?.renderThread}, expected ${check.renderThread}`);
		if (!report.capabilities?.tier.startsWith(check.tier ?? ''))
			problems.push(`used ${report.capabilities?.tier}`);
		if ((report.intervals?.count ?? 0) <= MIN_FRAMES)
			problems.push(`only ${report.intervals?.count} frames`);
		if ((report.intervals?.median ?? Infinity) >= MAX_MEDIAN_INTERVAL_MS)
			problems.push(`median frame interval ${report.intervals?.median} ms`);
		if ((report.count?.updates ?? 0) <= MIN_FRAMES)
			problems.push(`the game updated only ${report.count?.updates} times`);
		return problems;
	}
	if (check.page === 'isolation') {
		const problems: string[] = [];
		if (!report.crossOriginIsolated) problems.push('the page is not cross-origin isolated');
		if (!report.threaded) problems.push('the threaded build did not load');
		return problems;
	}
	try {
		compareToReference(
			'clear',
			check.tier ?? 'webgpu',
			Buffer.from(report.pixels ?? '', 'base64'),
			report.width ?? 0,
			report.height ?? 0,
		);
		return [];
	} catch (e) {
		return [(e as Error).message];
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const allowNoWebGPU = args.includes('--allow-no-webgpu');
	const browsers = args.filter((a) => !a.startsWith('--'));
	if (browsers.length === 0) {
		console.error('usage: bun tests/real-browsers.ts [--allow-no-webgpu] <macOS app name>...');
		process.exit(2);
	}

	const server: ChildProcess = spawn('bunx', ['vite', '--config', 'vite.config.ts'], {
		cwd: import.meta.dirname,
		stdio: 'ignore',
	});
	let failures = 0;
	try {
		await waitForServer();
		for (const browser of browsers) {
			for (const check of CHECKS) {
				const runId = randomUUID();
				const query = [check.query, `run=${runId}`].filter(Boolean).join('&');
				execFileSync('open', ['-a', browser, `${BASE_URL}/${check.page}.html?${query}`]);
				const label = `${browser}: ${check.page}${check.renderThread ? ` drawing on ${check.renderThread}` : ''}${check.tier ? ` on ${check.tier}` : ''}`;
				let verdict: string[] | 'skip';
				try {
					verdict = judge(check, await waitForReport(check.page, runId), allowNoWebGPU);
				} catch (e) {
					verdict = [(e as Error).message];
				}
				if (verdict === 'skip') {
					console.log(`skip  ${label}: no WebGPU adapter`);
				} else if (verdict.length === 0) {
					console.log(`pass  ${label}`);
				} else {
					failures++;
					console.log(`FAIL  ${label}: ${verdict.join('; ')}`);
				}
			}
		}
	} finally {
		server.kill();
	}
	process.exit(failures > 0 ? 1 : 0);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
