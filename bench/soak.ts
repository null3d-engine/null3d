// The soak test: runs S1 in Chrome for ten minutes and samples, every 30 seconds, the JavaScript
// heap of the page and of each engine worker and the size of the engine's WebAssembly memory,
// through Chrome's debugging protocol. A leak in the engine's frame code shows as steady growth.
// Before each heap sample, the page and the workers that return to their event loop collect their
// garbage, so a sample counts only what a thread keeps. While the engine runs, the job workers block
// inside the job system's loop, so their heaps are read as they are. The test fails when the sketch
// worker's or the render worker's heap grows after the warm-up by more than a small allowance, when
// the WebAssembly memory grows after it, when the page reports an error, or when the engine no
// longer draws at the end. It runs the production build of the benchmark pages, as a developer ships
// the engine; `--dev` runs the dev server's pages, with the engine's development checks. From the
// repository root:
//   bun run bench:soak
//   bun run bench:soak --gpu webgl2 --minutes 20 --n 30000
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { pageResult } from '../tests/lib/page-result.ts';
import { DEBUG_PORT } from '../tests/lib/server.ts';
import {
	type AttachedWorker,
	attachEveryWorker,
	DevTools,
	pagesAt,
	sleep,
	wasmMemoryBytes,
} from './lib/devtools';
import { pagePath } from './lib/parity';
import { pagesText, serveBenchPages } from './lib/serve';
import { judgeSoak, kb, mb, type SoakSample, soakTable } from './lib/soak';

/** Seconds between samples. */
const SAMPLE_SECONDS = 30;
/**
 * Seconds before the samples that the judge compares. The engine sizes its memory in the first
 * frames, and the browser keeps optimizing frame code for a while after that.
 */
const WARMUP_SECONDS = 120;
/** The most that a judged heap may grow after the warm-up. */
const HEAP_ALLOWANCE_BYTES = 256 * 1024;
/** The threads whose heaps must stay flat: the two that run frame code. */
const JUDGED = ['sketch worker', 'render worker'];
/** The threads in the table, in its order. The job workers' heaps count together. */
const THREADS = ['page', 'sketch worker', 'render worker', 'job workers'];
/** How long the engine measures itself at the end of the run, to show that it still draws. */
const END_MEASURE_SECONDS = 5;
/** How long a thread may take to answer before its sample counts as missing. */
const ANSWER_TIMEOUT_MS = 10_000;
/** How long the page may take to start the engine and build the scene. */
const START_TIMEOUT_MS = 120_000;

interface Options {
	gpu: 'webgpu' | 'webgl2';
	minutes: number;
	n: number;
	dev: boolean;
}

function readOptions(args: string[]): Options {
	const { values } = parseArgs({
		args,
		options: {
			gpu: { type: 'string', default: 'webgpu' },
			minutes: { type: 'string', default: '10' },
			n: { type: 'string', default: '100000' },
			dev: { type: 'boolean', default: false },
		},
	});
	const { gpu } = values;
	if (gpu !== 'webgpu' && gpu !== 'webgl2')
		throw new Error(`--gpu takes webgpu or webgl2, not ${gpu}`);
	const minutes = Number(values.minutes);
	if (!(minutes > 0)) throw new Error(`--minutes takes a number above 0, not ${values.minutes}`);
	const n = Number(values.n);
	if (!Number.isSafeInteger(n) || n < 1)
		throw new Error(`--n takes a whole number above 0, not ${values.n}`);
	return { gpu, minutes, n, dev: values.dev };
}

/** What the page publishes once the engine runs the scene in demo mode. */
interface DemoResult {
	ok: boolean;
	error?: string;
	tier: string;
	mode: { latency: string; jobWorkers: number };
}

/** The table's thread for a worker, from its script's address. */
function threadOf({ url }: AttachedWorker): string {
	if (url.includes('sketch-worker')) return 'sketch worker';
	if (url.includes('render-worker')) return 'render worker';
	if (url.includes('job-worker')) return 'job workers';
	return url;
}

/** Resolves with the promise's value, or rejects when the thread does not answer in time. */
function answer<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error('no answer')), ANSWER_TIMEOUT_MS);
	});
	return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * A thread's used JavaScript heap in bytes, after a full garbage collection when `collect` is true,
 * or null when the thread does not answer.
 */
async function heapBytes(
	devtools: DevTools,
	sessionId: string,
	collect: boolean,
): Promise<number | null> {
	try {
		if (collect) await answer(devtools.send('HeapProfiler.collectGarbage', {}, sessionId));
		const usage = await answer(
			devtools.send<{ usedSize: number }>('Runtime.getHeapUsage', {}, sessionId),
		);
		return usage.usedSize;
	} catch {
		return null;
	}
}

async function takeSample(
	devtools: DevTools,
	page: string,
	workers: readonly AttachedWorker[],
	atSeconds: number,
): Promise<SoakSample> {
	const readings = await Promise.all([
		heapBytes(devtools, page, true).then((bytes) => ['page', bytes] as const),
		...workers.map(async (worker) => {
			const thread = threadOf(worker);
			return [
				thread,
				await heapBytes(devtools, worker.sessionId, thread !== 'job workers'),
			] as const;
		}),
	]);
	const heaps: Record<string, number | null> = {};
	for (const [thread, bytes] of readings) {
		const sum = heaps[thread];
		heaps[thread] = bytes === null || sum === null ? null : (sum ?? 0) + bytes;
	}
	return { atSeconds, heaps, wasmBytes: await wasmMemoryBytes(devtools, page) };
}

/** Takes a sample now and at every interval after it until the run's end, and prints each one. */
async function sampleRun(
	devtools: DevTools,
	attached: { page: string; workers: AttachedWorker[] },
	minutes: number,
): Promise<SoakSample[]> {
	const samples: SoakSample[] = [];
	const startedAt = performance.now();
	for (let at = 0; at <= minutes * 60; at += SAMPLE_SECONDS) {
		const wait = startedAt + at * 1000 - performance.now();
		if (wait > 0) await sleep(wait);
		const sample = await takeSample(devtools, attached.page, attached.workers, at);
		samples.push(sample);
		const heaps = THREADS.map((thread) => {
			const bytes = sample.heaps[thread];
			return `${thread} ${typeof bytes === 'number' ? mb(bytes) : 'no answer'}`;
		});
		console.log(`  ${at} s: ${heaps.join(', ')}; WebAssembly memory ${mb(sample.wasmBytes)}`);
	}
	return samples;
}

/** The frames that the engine draws in a short measurement, which shows that it still runs. */
function measureEnd(page: Page): Promise<{ frames: number; presentedFps: number }> {
	return page.evaluate(async (seconds) => {
		type Measured = { frames: number; presentedFps: number };
		const scope = globalThis as { __null3dEngine?: { measure(s: number): Promise<Measured> } };
		if (!scope.__null3dEngine) throw new Error('the page keeps no engine for tools');
		const { frames, presentedFps } = await scope.__null3dEngine.measure(seconds);
		return { frames, presentedFps };
	}, END_MEASURE_SECONDS);
}

async function main(): Promise<void> {
	const options = readOptions(process.argv.slice(2));
	const server = await serveBenchPages({ dev: options.dev });
	const browser = await chromium.launch({
		channel: 'chrome',
		args: [`--remote-debugging-port=${DEBUG_PORT}`],
	});
	try {
		const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		page.on('console', (message) => {
			if (message.type() === 'error') pageErrors.push(message.text());
		});
		const url = `${server.url}${pagePath('s1', `null3d-${options.gpu}`, `demo&n=${options.n}`)}`;
		await page.goto(url);
		const started = await pageResult<DemoResult>(page, START_TIMEOUT_MS);
		if (!started.ok) throw new Error(`the page did not start the engine: ${started.error}`);
		const devtools = await DevTools.connect(DEBUG_PORT);
		try {
			const [target] = await pagesAt(devtools, url);
			if (!target) throw new Error(`no page target for ${url}`);
			const { jobWorkers, latency } = started.mode;
			const attached = await attachEveryWorker(devtools, target.targetId, 2 + jobWorkers);
			console.log(
				`Soak: S1 with ${options.n.toLocaleString('en-US')} instances on ${started.tier}, ${latency}, with ${jobWorkers} job workers, ${pagesText(options.dev)}, for ${options.minutes} min, sampled every ${SAMPLE_SECONDS} s`,
			);
			const samples = await sampleRun(devtools, attached, options.minutes);
			const end = await measureEnd(page);
			const verdict = judgeSoak(
				{ samples, framesAtEnd: end.frames, pageErrors },
				{ warmupSeconds: WARMUP_SECONDS, heapAllowanceBytes: HEAP_ALLOWANCE_BYTES, judged: JUDGED },
			);
			console.log(`\n${soakTable(samples, THREADS, WARMUP_SECONDS).join('\n')}\n`);
			console.log("The job workers' heaps are read without a collection, so they include garbage.");
			console.log(
				`At the end, the engine drew ${end.frames} frames in ${END_MEASURE_SECONDS} s, ${end.presentedFps.toFixed(1)} per second.`,
			);
			const growth = JUDGED.map((thread) => {
				const bytes = verdict.heapGrowth[thread];
				return `the ${thread}'s heap ${bytes === undefined ? 'was not judged' : `grew ${kb(bytes)}`}`;
			});
			console.log(
				`After the ${WARMUP_SECONDS}-second warm-up, ${growth.join(' and ')}, with an allowance of ${kb(HEAP_ALLOWANCE_BYTES)} each. The WebAssembly memory grew ${mb(verdict.wasmGrowth)}.`,
			);
			for (const problem of verdict.problems) console.error(`FAIL: ${problem}`);
			if (verdict.problems.length === 0) console.log('pass');
			process.exitCode = verdict.problems.length === 0 ? 0 : 1;
		} finally {
			devtools.close();
		}
	} finally {
		await browser.close();
		server.stop();
	}
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
