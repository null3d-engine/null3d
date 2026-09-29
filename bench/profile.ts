// Samples Chrome's CPU profiler on one of the engine's threads while a benchmark scene runs, and
// splits the time of that thread's frame work between the engine's own JavaScript, the engine core
// in WebAssembly, and the browser functions they call. By default it samples the render worker's
// draw-list replay: a replay loop in WebAssembly would still make every browser call, each through
// a JavaScript import, so the engine's own share bounds how much faster such a loop could be. With
// `--thread sketch` it samples the sketch worker's frame step, whose time splits further by phase.
// Build the core with `bun tools/build-wasm.ts --names` first, so the core's functions have names.
// It runs in Chrome on this computer, or with `--android` in Chrome on a phone connected by USB.
// From the repository root:
//   bun run bench:profile
//   bun run bench:profile --scene s2 --gpu webgpu --seconds 10
//   bun run bench:profile --android --n 300000 --thread sketch
import { chromium } from '@playwright/test';
import { forwardPort, phoneModel } from '../tests/lib/adb.ts';
import { HTTP_PORT, startServer } from '../tests/lib/server.ts';
import {
	attachWorkers,
	type CallFrame,
	closePagesAt,
	connectPhoneChrome,
	DevTools,
	pageResultOf,
	sleep,
} from './lib/devtools';
import { PARITY_SCENES, type ParityScene, pagePath } from './lib/parity';
import { type CpuProfile, type EntrySplit, splitEntry } from './lib/profile';

/** Chrome's debugging port on this computer, for a Chrome started here or one on a phone. */
const DEBUG_PORT = 9334;
/** The engine's source files, as the dev server serves them. */
const ENGINE_URL = '/packages/engine/src/';
/** The worker whose time the tool splits, by a part of its script's address. */
const RENDER_WORKER = 'render-worker';
const SKETCH_WORKER = 'sketch-worker';
/** Microseconds between samples: dense, as a frame's replay can take less than a tenth of a millisecond. */
const SAMPLING_INTERVAL = 50;
/**
 * Seconds the browser runs a scene before sampling starts. It optimizes code that runs once per
 * frame only after many frames, and code it has not optimized yet would count as the engine's.
 */
const WARMUP_SECONDS = 20;
const PROFILE_SECONDS = 10;
/** Seconds between the start of the page's measured run and the profile, at each end. */
const MARGIN_SECONDS = 2;
/** The functions listed of each kind, the costliest first. */
const TOP_CALLS = 6;
/** How long a page may take to publish its result after its measured run. */
const RESULT_TIMEOUT_MS = 60_000;

const isReplay = ({ functionName, url }: CallFrame) =>
	functionName === 'replay' && url.includes('/gpu/');

/** The threads the profiler samples: each one's worker and the function that holds its frame's work. */
const THREADS = {
	render: { worker: RENDER_WORKER, entry: 'replay', isEntry: isReplay },
	sketch: {
		worker: SKETCH_WORKER,
		entry: 'frame step',
		isEntry: ({ functionName, url }: CallFrame) =>
			functionName === 'step' && url.includes('/sketch/runner'),
	},
} as const;
type ThreadName = keyof typeof THREADS;

interface Options {
	scenes: ParityScene[];
	gpu: 'webgl2' | 'webgpu';
	thread: ThreadName;
	n: number | null;
	seconds: number;
	warmup: number;
	android: boolean;
}

function parseArgs(args: string[]): Options {
	const value = (name: string) => {
		const at = args.indexOf(name);
		return at >= 0 ? args[at + 1] : undefined;
	};
	const number = (name: string, fallback: number) => {
		const text = value(name);
		const parsed = text === undefined ? fallback : Number(text);
		if (!(parsed > 0)) throw new Error(`${name} takes a positive number, not ${text}`);
		return parsed;
	};
	const scenes = (value('--scene')?.split(',') ?? [...PARITY_SCENES]) as ParityScene[];
	for (const scene of scenes)
		if (!PARITY_SCENES.includes(scene))
			throw new Error(`"${scene}" is not a scene. Use one of: ${PARITY_SCENES.join(', ')}.`);
	const gpu = value('--gpu') ?? 'webgl2';
	if (gpu !== 'webgl2' && gpu !== 'webgpu')
		throw new Error(`--gpu takes webgl2 or webgpu, not ${gpu}`);
	const thread = value('--thread') ?? 'render';
	if (!(thread in THREADS))
		throw new Error(`--thread takes ${Object.keys(THREADS).join(' or ')}, not ${thread}`);
	return {
		scenes,
		gpu,
		thread: thread as ThreadName,
		n: value('--n') === undefined ? null : number('--n', 1),
		seconds: number('--seconds', PROFILE_SECONDS),
		warmup: number('--warmup', WARMUP_SECONDS),
		android: args.includes('--android'),
	};
}

/** What a benchmark page publishes when its measured run ends. */
interface PageResult {
	ok: boolean;
	error?: string;
	n: number;
	stats: {
		frames: number;
		presentedFps: number;
		threads: Record<
			string,
			{ busyMs: { median: number }; phases: Record<string, { median: number }> }
		>;
	};
}

async function waitForResult(devtools: DevTools, page: string, timeoutMs: number) {
	const result = await pageResultOf<PageResult>(devtools, page, timeoutMs);
	if (!result.ok) throw new Error(`the page failed: ${result.error}`);
	return result;
}

interface SceneProfile {
	scene: ParityScene;
	result: PageResult;
	split: EntrySplit;
}

/**
 * Runs one scene: the page warms up for its own run's length, then measures for that length. The
 * profile covers the middle of the measured run, so both describe the same frames.
 */
async function profileScene(
	devtools: DevTools,
	serverUrl: string,
	scene: ParityScene,
	options: Options,
): Promise<SceneProfile> {
	const pageSeconds = Math.max(options.warmup, options.seconds + 2 * MARGIN_SECONDS);
	const switches = `seconds=${pageSeconds}${options.n === null ? '' : `&n=${options.n}`}`;
	const url = `${serverUrl}${pagePath(scene, `null3d-${options.gpu}`, switches)}`;
	const { targetId } = await devtools.send<{ targetId: string }>('Target.createTarget', { url });
	try {
		const thread = THREADS[options.thread];
		const { page, workers } = await attachWorkers(devtools, targetId, [thread.worker]);
		const worker = workers.get(thread.worker) as string;
		await sleep((pageSeconds + MARGIN_SECONDS) * 1000);
		await devtools.send('Profiler.enable', {}, worker);
		await devtools.send('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL }, worker);
		await devtools.send('Profiler.start', {}, worker);
		await sleep(options.seconds * 1000);
		const { profile } = await devtools.send<{ profile: CpuProfile }>('Profiler.stop', {}, worker);
		const result = await waitForResult(devtools, page, pageSeconds * 1000 + RESULT_TIMEOUT_MS);
		return { scene, result, split: splitEntry(profile, thread.isEntry, ENGINE_URL) };
	} finally {
		// A page left open would draw on beside the next scene's page.
		await devtools.send('Target.closeTarget', { targetId });
	}
}

const fixed = (value: number, digits = 3) => value.toFixed(digits);
const percent = (part: number, whole: number) =>
	whole > 0 ? `${fixed((100 * part) / whole, 1)}%` : '-';

/**
 * One scene's lines: the engine's per-frame times on the profiled thread, by phase, and the
 * profile's split of the time under that thread's entry function.
 */
function report({ scene, result, split }: SceneProfile, name: ThreadName): string[] {
	const { worker, entry } = THREADS[name];
	const thread = result.stats.threads[worker];
	const phases = Object.entries(thread?.phases ?? {})
		.map(([phase, spread]) => `${phase} ${fixed(spread.median)}`)
		.join(', ');
	const lines = [
		`${scene}, ${result.n} objects: ${result.stats.frames} frames at ${fixed(result.stats.presentedFps, 1)} per second`,
		`  ${worker.replace('-', ' ')} per frame (engine's median): busy ${thread ? fixed(thread.busyMs.median) : '-'} ms; ${phases || 'no phases'}`,
		`  ${entry}, ${fixed(split.entryMs, 1)} ms sampled in ${fixed(split.profileMs / 1000, 1)} s: engine code ${percent(split.engineMs, split.entryMs)}, engine core ${percent(split.coreMs, split.entryMs)}, browser calls ${percent(split.browserMs, split.entryMs)}, other ${percent(split.otherMs, split.entryMs)}`,
	];
	const top = (calls: EntrySplit['browserCalls'], title: string) => {
		if (calls.length === 0) return;
		lines.push(`  ${title}:`);
		for (const call of calls.slice(0, TOP_CALLS))
			lines.push(`    ${percent(call.ms, split.entryMs).padStart(6)}  ${call.name}`);
	};
	top(split.engineCalls, 'engine functions, by their own time');
	top(split.coreCalls, 'engine core functions, by their own time');
	top(split.browserCalls, 'browser calls');
	return lines;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const server = await startServer();
	const stops: (() => Promise<void> | void)[] = [() => server.stop()];
	try {
		let device = 'this computer, Chrome';
		let devtools: DevTools;
		if (options.android) {
			device = `${phoneModel()}, Chrome`;
			forwardPort(HTTP_PORT);
			devtools = await connectPhoneChrome(DEBUG_PORT);
		} else {
			const browser = await chromium.launch({
				channel: 'chrome',
				headless: false,
				args: [`--remote-debugging-port=${DEBUG_PORT}`],
			});
			stops.push(() => browser.close());
			devtools = await DevTools.connect(DEBUG_PORT);
		}
		stops.push(() => devtools.close());
		// A benchmark page left open by an earlier run would draw beside the profiled one.
		await closePagesAt(devtools, `${server.url}/bench/pages/`);
		console.log(
			`Profiling the ${THREADS[options.thread].worker.replace('-', ' ')} on ${device}, ${options.gpu}: ${options.seconds} s per scene after at least ${options.warmup} s`,
		);
		for (const scene of options.scenes) {
			const profiled = await profileScene(devtools, server.url, scene, options);
			console.log(report(profiled, options.thread).join('\n'));
		}
	} finally {
		for (const stop of stops.reverse()) await stop();
	}
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
