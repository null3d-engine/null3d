// Samples Chrome's CPU profiler on the render worker while a benchmark scene runs, and splits the
// time of the draw-list replay into the engine's own JavaScript and the browser functions it calls.
// A replay loop in WebAssembly would still make every browser call, each through a JavaScript
// import, so the engine's own share bounds how much faster such a loop could be. It runs in Chrome
// on this computer, or with `--android` in Chrome on a phone connected by USB. From the repository
// root:
//   bun run bench:profile
//   bun run bench:profile --scene s2 --gpu webgpu --seconds 10
//   bun run bench:profile --android --n 300000
import { chromium } from '@playwright/test';
import { forwardDevTools, forwardPort, phoneModel, startBrowser } from '../tests/lib/adb.ts';
import { HTTP_PORT, startServer } from '../tests/lib/server.ts';
import { attachWorkers, type CallFrame, DevTools, evaluate, pagesAt, sleep } from './lib/devtools';
import { PARITY_SCENES, type ParityScene, pagePath } from './lib/parity';
import { type CpuProfile, type EntrySplit, splitEntry } from './lib/profile';

/** Chrome's debugging port on this computer, for a Chrome started here or one on a phone. */
const DEBUG_PORT = 9334;
/** The engine's source files, as the dev server serves them. */
const ENGINE_URL = '/packages/engine/src/';
/** The worker whose time the tool splits, by a part of its script's address. */
const RENDER_WORKER = 'render-worker';
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

interface Options {
	scenes: ParityScene[];
	gpu: 'webgl2' | 'webgpu';
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
	return {
		scenes,
		gpu,
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
			{ busyMs: { median: number }; phases: { replay?: { median: number } } }
		>;
	};
}

async function waitForResult(devtools: DevTools, page: string, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await evaluate<PageResult | null>(
			devtools,
			page,
			'globalThis.__null3dResult ?? null',
		);
		if (result) {
			if (!result.ok) throw new Error(`the page failed: ${result.error}`);
			return result;
		}
		await sleep(1000);
	}
	throw new Error('the page published no result in time');
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
		const { page, workers } = await attachWorkers(devtools, targetId, [RENDER_WORKER]);
		const render = workers.get(RENDER_WORKER) as string;
		await sleep((pageSeconds + MARGIN_SECONDS) * 1000);
		await devtools.send('Profiler.enable', {}, render);
		await devtools.send('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL }, render);
		await devtools.send('Profiler.start', {}, render);
		await sleep(options.seconds * 1000);
		const { profile } = await devtools.send<{ profile: CpuProfile }>('Profiler.stop', {}, render);
		const result = await waitForResult(devtools, page, pageSeconds * 1000 + RESULT_TIMEOUT_MS);
		return { scene, result, split: splitEntry(profile, isReplay, ENGINE_URL) };
	} finally {
		// A page left open would draw on beside the next scene's page.
		await devtools.send('Target.closeTarget', { targetId });
	}
}

const fixed = (value: number, digits = 3) => value.toFixed(digits);
const percent = (part: number, whole: number) =>
	whole > 0 ? `${fixed((100 * part) / whole, 1)}%` : '-';

/** One scene's lines: the engine's per-frame times, and the profile's split of the replay. */
function report({ scene, result, split }: SceneProfile): string[] {
	const thread = result.stats.threads[RENDER_WORKER];
	const lines = [
		`${scene}, ${result.n} objects: ${result.stats.frames} frames at ${fixed(result.stats.presentedFps, 1)} per second`,
		`  render worker per frame (engine's median): busy ${thread ? fixed(thread.busyMs.median) : '-'} ms, replay ${thread?.phases.replay ? fixed(thread.phases.replay.median) : '-'} ms`,
		`  replay, ${fixed(split.entryMs, 1)} ms sampled in ${fixed(split.profileMs / 1000, 1)} s: engine code ${percent(split.engineMs, split.entryMs)}, browser calls ${percent(split.browserMs, split.entryMs)}, other ${percent(split.otherMs, split.entryMs)}`,
	];
	const top = (calls: EntrySplit['browserCalls'], title: string) => {
		lines.push(`  ${title}:`);
		for (const call of calls.slice(0, TOP_CALLS))
			lines.push(`    ${percent(call.ms, split.entryMs).padStart(6)}  ${call.name}`);
	};
	top(split.engineCalls, 'engine functions, by their own time');
	top(split.browserCalls, 'browser calls');
	return lines;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const server = await startServer();
	const stops: (() => Promise<void> | void)[] = [() => server.stop()];
	try {
		let device = 'this computer, Chrome';
		if (options.android) {
			device = `${phoneModel()}, Chrome`;
			forwardPort(HTTP_PORT);
			forwardDevTools(DEBUG_PORT);
			// Chrome has its debugging socket only while it runs.
			startBrowser('chrome');
		} else {
			const browser = await chromium.launch({
				channel: 'chrome',
				headless: false,
				args: [`--remote-debugging-port=${DEBUG_PORT}`],
			});
			stops.push(() => browser.close());
		}
		const devtools = await DevTools.connect(DEBUG_PORT);
		stops.push(() => devtools.close());
		// A benchmark page left open by an earlier run would draw beside the profiled one.
		for (const { targetId } of await pagesAt(devtools, `${server.url}/bench/pages/`))
			await devtools.send('Target.closeTarget', { targetId });
		console.log(
			`Profiling the render worker on ${device}, ${options.gpu}: ${options.seconds} s per scene after at least ${options.warmup} s`,
		);
		for (const scene of options.scenes) {
			const profiled = await profileScene(devtools, server.url, scene, options);
			console.log(report(profiled).join('\n'));
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
