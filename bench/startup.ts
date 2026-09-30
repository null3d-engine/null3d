// Times the engine's start, from navigation to the first frame, on the production build of the
// engine test page. It builds the page with relative addresses and serves it with `vite preview`,
// which gives each load its own address prefix (tests/lib/load-server.ts). It drives Chrome through
// its debugging protocol: Chrome on this computer, or with --android Chrome on a phone connected by
// USB, whose browsing data it never clears. A cold load uses addresses that the browser has never
// seen, so every file downloads and the browser compiles the core and the scripts from scratch. On
// this computer each cold load also gets a fresh Chrome profile, whose caches start empty. A warm
// load repeats the addresses of an earlier load in the same browser, as a repeat visit does. Each
// load runs on Chrome's Slow 4G profile or at the link's full speed. The tool prints each load's
// times and a table of the medians.
// From the repository root:
//   bun run bench:startup                 (3 cold loads, pipelined, on WebGPU and Slow 4G)
//   bun run bench:startup --runs 5 --gpu webgl2 --loads cold,warm --network slow-4g,full
//   bun run bench:startup --modes low-latency,single-threaded
//   bun run bench:startup --android       (5 loads of each kind, every mode, on both networks)
// Options:
//   --runs <n>          loads of each kind in each thread mode on each network: 3 on this
//                       computer, and 5 on a phone
//   --gpu <path>        auto, webgpu or webgl2: webgpu on this computer, and auto on a phone,
//                       which lets the engine pick
//   --modes <list>      thread modes: pipelined, low-latency, single-threaded,
//                       drawing-on-the-main-thread, or all: pipelined on this computer, all on a phone
//   --loads <list>      cold, warm: cold on this computer, both on a phone
//   --network <list>    slow-4g, full: slow-4g on this computer, both on a phone
//   --switches <query>  more page switches for every load, such as jobs=4
//   --android           Chrome on the Android phone connected by USB
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { forwardPort, phoneModel } from '../tests/lib/adb.ts';
import { ENGINE_MODES, type EngineMode } from '../tests/lib/engine-checks.ts';
import {
	LOAD_KINDS,
	LOAD_ROUTE,
	type Load,
	type LoadKind,
	loadPath,
	takeDownloads,
} from '../tests/lib/load-routes.ts';
import { buildStartupPages, prepareLoads } from '../tests/lib/load-server.ts';
import { slug } from '../tests/lib/runs.ts';
import { DEBUG_PORT, PREVIEW_PORT, REPO_ROOT, trackServer } from '../tests/lib/server.ts';
import {
	closePagesAt,
	connectPhoneChrome,
	DevTools,
	limitWorkerNetworks,
	pageResultOf,
} from './lib/devtools';
import {
	groupSamples,
	judgeLoad,
	type LoadSample,
	STARTUP_LEGEND,
	type StartupResult,
	startupTable,
} from './lib/startup';

/** The networks a load can run on: Chrome's Slow 4G profile, at 90% of its rates, or no limit. */
const NETWORKS = {
	'slow-4g': {
		label: 'Slow 4G',
		conditions: {
			offline: false,
			latency: 562.5,
			downloadThroughput: ((1.4 * 1_000_000) / 8) * 0.9,
			uploadThroughput: ((675 * 1000) / 8) * 0.9,
		},
	},
	full: {
		label: 'full speed',
		conditions: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
	},
} as const;
export type Network = keyof typeof NETWORKS;
const NETWORK_NAMES = Object.keys(NETWORKS) as Network[];

const GPUS = ['auto', 'webgpu', 'webgl2'] as const;
type Gpu = (typeof GPUS)[number];

/** The engine page's measured time after its first frame: short, as a load needs only its start. */
const PAGE_SECONDS = 0.2;
/** How long a load may take, as on Slow 4G on a slow phone. */
const LOAD_TIMEOUT_MS = 180_000;
/** How often the tool asks a page for its result. Each question wakes the page's thread. */
const POLL_MS = 500;

export interface Options {
	runs: number;
	gpu: Gpu;
	modes: EngineMode[];
	loads: LoadKind[];
	networks: Network[];
	/** More page switches for every load. */
	switches: string;
	android: boolean;
}

const USAGE =
	'usage: bun run bench:startup [--runs <n>] [--gpu auto|webgpu|webgl2] [--modes <list>|all] [--loads cold,warm] [--network slow-4g,full] [--switches <query>] [--android]';
const VALUE_FLAGS = ['--runs', '--gpu', '--modes', '--loads', '--network', '--switches'];

/**
 * The options. Without --android they measure what this tool always has: three cold loads in the
 * pipelined mode, on WebGPU and Slow 4G. With it they cover a phone as the benchmark protocol does,
 * with five loads of each kind: every thread mode, cold and warm, with and without Slow 4G, on the
 * GPU path the engine picks.
 */
export function parseArgs(args: readonly string[]): Options {
	const android = args.includes('--android');
	const values = new Map<string, string>();
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === '--android' || arg === '--') continue;
		const value = args[i + 1];
		if (!VALUE_FLAGS.includes(arg)) throw new Error(`unknown option ${arg}\n${USAGE}`);
		if (value === undefined) throw new Error(`${arg} needs a value\n${USAGE}`);
		values.set(arg, value);
		i++;
	}
	const list = <T extends string>(flag: string, allowed: readonly T[], fallback: readonly T[]) => {
		const text = values.get(flag);
		if (text === undefined) return [...fallback];
		const picked = text.split(',').filter(Boolean);
		if (picked.length === 0 || picked.some((v) => !(allowed as readonly string[]).includes(v)))
			throw new Error(`${flag}: use some of ${allowed.join(', ')}\n${USAGE}`);
		return picked as T[];
	};
	const runs = Number(values.get('--runs') ?? (android ? 5 : 3));
	if (!(Number.isSafeInteger(runs) && runs >= 1))
		throw new Error(`--runs: use a whole number of at least 1\n${USAGE}`);
	const gpu = values.get('--gpu') ?? (android ? 'auto' : 'webgpu');
	if (!(GPUS as readonly string[]).includes(gpu))
		throw new Error(`--gpu: use ${GPUS.join(', ')}\n${USAGE}`);
	const modeNames = ENGINE_MODES.map((mode) => slug(mode.name));
	const modes =
		values.get('--modes') === 'all'
			? [...ENGINE_MODES]
			: list('--modes', modeNames, android ? modeNames : ['pipelined']).map(
					(name) => ENGINE_MODES.find((mode) => slug(mode.name) === name) as EngineMode,
				);
	return {
		runs,
		gpu: gpu as Gpu,
		modes,
		loads: list('--loads', LOAD_KINDS, android ? LOAD_KINDS : ['cold']),
		networks: list('--network', NETWORK_NAMES, android ? NETWORK_NAMES : ['slow-4g']),
		switches: values.get('--switches') ?? '',
		android,
	};
}

/** One load: its thread mode, kind and network, and its run, 0 for the first warm load of a mode. */
export interface LoadStep {
	mode: EngineMode;
	kind: LoadKind;
	network: Network;
	run: number;
}

/**
 * The loads in the order the tool makes them. With warm loads, each thread mode's first warm load
 * comes first, at full speed, to fill the cache; the report leaves it out. Then each run makes every
 * other load once, so the networks, modes and kinds take turns as the device warms up.
 */
export function loadSteps({ runs, modes, loads, networks }: Options): LoadStep[] {
	const first: LoadStep[] = loads.includes('warm')
		? modes.map((mode) => ({ mode, kind: 'warm', network: 'full', run: 0 }))
		: [];
	const repeated = Array.from({ length: runs }, (_, run) =>
		networks.flatMap((network) =>
			modes.flatMap((mode) => loads.map((kind) => ({ mode, kind, network, run: run + 1 }))),
		),
	).flat();
	return [...first, ...repeated];
}

/**
 * A step's load. A cold load has a key of its own; warm loads share their mode's key. Every key
 * starts with the name of this tool's run, so no run reuses another's addresses.
 */
export function stepLoad(step: LoadStep, session: string): Load {
	const mode = slug(step.mode.name);
	return step.kind === 'cold'
		? { kind: 'cold', key: `${session}.${mode}-${step.network}-${step.run}` }
		: { kind: 'warm', key: `${session}.${mode}` };
}

/** The address of the engine test page for a step, from the server's address. */
export function stepUrl(base: string, step: LoadStep, options: Options, session: string): string {
	const query = [
		options.gpu === 'auto' ? '' : `gpu=${options.gpu}`,
		`seconds=${PAGE_SECONDS}`,
		step.mode.query,
		options.switches,
	]
		.filter(Boolean)
		.join('&');
	return `${base}${loadPath(stepLoad(step, session), `tests/pages/engine.html?${query}`)}`;
}

/** A step as a report's labels: its thread mode, kind and network. */
const stepLabels = (step: LoadStep) => [step.mode.name, step.kind, NETWORKS[step.network].label];

/** Starts `vite preview` on the preview port, and resolves with the function that stops it. */
function startPreview(): Promise<() => void> {
	const child = spawn('bunx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const stop = trackServer(child);
	return new Promise((resolve, reject) => {
		const deadline = setTimeout(() => {
			stop();
			reject(new Error('vite preview did not start'));
		}, 30_000);
		child.stdout?.on('data', (chunk: Buffer) => {
			if (chunk.toString().includes(String(PREVIEW_PORT))) {
				clearTimeout(deadline);
				resolve(stop);
			}
		});
	});
}

/** A browser that the tool drives, and how to let go of it. */
interface Driven {
	devtools: DevTools;
	close(): Promise<void>;
}

/** Chrome on this computer, with a fresh profile, so its caches start empty. */
async function macChrome(): Promise<Driven> {
	const browser = await chromium.launch({
		channel: 'chrome',
		args: ['--enable-unsafe-webgpu', `--remote-debugging-port=${DEBUG_PORT}`],
	});
	try {
		const devtools = await DevTools.connect(DEBUG_PORT);
		return {
			devtools,
			close: async () => {
				devtools.close();
				await browser.close();
			},
		};
	} catch (e) {
		await browser.close();
		throw e;
	}
}

/**
 * Loads a page in a new tab on a network, and waits for its result. The tab starts blank, so the
 * network limit holds from the page's first request. On a limited network the tool also watches the
 * page's workers, so the limit covers their own requests, such as their imports of the core's
 * loader and of the sketch.
 */
async function measure(devtools: DevTools, url: string, network: Network): Promise<StartupResult> {
	const { targetId } = await devtools.send<{ targetId: string }>('Target.createTarget', {
		url: 'about:blank',
	});
	let stopWatching: (() => void) | undefined;
	try {
		const { sessionId } = await devtools.send<{ sessionId: string }>('Target.attachToTarget', {
			targetId,
			flatten: true,
		});
		await devtools.send('Network.enable', {}, sessionId);
		await devtools.send(
			'Network.emulateNetworkConditions',
			NETWORKS[network].conditions,
			sessionId,
		);
		if (network !== 'full') stopWatching = await limitWorkerNetworks(devtools, sessionId);
		await devtools.send('Page.navigate', { url }, sessionId);
		return await pageResultOf<StartupResult>(devtools, sessionId, LOAD_TIMEOUT_MS, POLL_MS);
	} finally {
		stopWatching?.();
		await devtools.send('Target.closeTarget', { targetId });
	}
}

/** One load's line as the tool prints it: its first frame and downloads, or why it failed. */
function loadLine(
	step: LoadStep,
	runs: number,
	{ problems, sample }: ReturnType<typeof judgeLoad>,
): string {
	const name =
		step.run === 0
			? `${step.mode.name}, first warm load`
			: `${stepLabels(step).join(', ')}, run ${step.run} of ${runs}`;
	if (!sample) return `FAIL  ${name}: ${problems.join('; ')}`;
	const requests = `${sample.requests} ${sample.requests === 1 ? 'request' : 'requests'}`;
	return `${name}: first frame done at ${sample.frameDoneMs.toFixed(0)} ms, ${requests}, ${(sample.bytes / 1024).toFixed(1)} KB`;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	buildStartupPages();
	const stopPreview = await startPreview();
	const base = `http://localhost:${PREVIEW_PORT}`;
	// On a phone, every load runs in the phone's own Chrome. On this computer, the warm loads share
	// one Chrome, and each cold load gets a fresh one.
	let shared: Driven | undefined;
	try {
		await prepareLoads(base);
		let device = 'this computer';
		if (options.android) {
			device = phoneModel();
			forwardPort(PREVIEW_PORT);
			const devtools = await connectPhoneChrome(DEBUG_PORT);
			// A startup page left open by an earlier run would compete with the loads.
			await closePagesAt(devtools, `${base}${LOAD_ROUTE}`);
			shared = { devtools, close: async () => devtools.close() };
		}
		const session = `startup-${Date.now().toString(36)}`;
		const loads: { labels: string[]; sample: LoadSample | undefined }[] = [];
		let browser = '';
		let failures = 0;
		for (const step of loadSteps(options)) {
			const fresh = !options.android && step.kind === 'cold';
			if (!fresh && !shared) shared = await macChrome();
			const driven = fresh ? await macChrome() : (shared as Driven);
			try {
				browser ||= (await driven.devtools.send<{ product: string }>('Browser.getVersion')).product;
				const result = await measure(
					driven.devtools,
					stepUrl(base, step, options, session),
					step.network,
				);
				result.downloads = await takeDownloads(stepLoad(step, session), base);
				const verdict = judgeLoad(result, step.mode);
				console.log(loadLine(step, options.runs, verdict));
				if (!verdict.sample) failures++;
				if (step.run > 0) loads.push({ labels: stepLabels(step), sample: verdict.sample });
			} finally {
				if (fresh) await driven.close();
			}
		}
		const switches = options.switches ? ` with ?${options.switches}` : '';
		console.log(
			`\nStartup of the engine test page's production build on ${device}, ${browser}, GPU path ${options.gpu}${switches}`,
		);
		console.log(startupTable(['Thread mode', 'Load', 'Network'], groupSamples(loads)).join('\n'));
		console.log(`\n${STARTUP_LEGEND.join('\n')}`);
		if (failures > 0) {
			console.error(`${failures} loads failed`);
			process.exitCode = 1;
		}
	} finally {
		await shared?.close();
		stopPreview();
	}
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
