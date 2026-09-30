// Measures what the engine's sketch worker and render worker allocate per frame while S1 runs, with
// Chrome's heap profiler. Engine code and the sketch's row writes must allocate nothing per frame;
// the few places that allocate because the browser does each have a budget below. It opens the
// null3d S1 page in Chrome, lets the browser optimize the frame code, attaches the heap profiler to
// both workers through Chrome's debugging protocol, samples allocations for a few seconds, and
// prints the bytes per frame of every place that allocated. From the page's start to the end of
// the sample, it moves the mouse over the canvas and presses a key and the mouse button, so the
// sample covers the sketch's reading of input. It draws with WebGPU, or with WebGL2 when
// `--gpu webgl2` asks for it. It samples the production build of the benchmark pages, as a
// developer ships the engine, and names the build's functions through its source maps; `--dev`
// samples the dev server's pages, with the engine's development checks. From the repository root:
//   bun run bench:allocation
//   bun run bench:allocation --n 30000 --seconds 5 --warmup 30
//   bun run bench:allocation --gpu webgl2
// At 30,000 instances a frame's upload goes through the staging ring; at 100,000 it does not.
import { chromium, type Page } from '@playwright/test';
import { DEBUG_PORT } from '../tests/lib/server.ts';
import { attachWorkers, type CallFrame, DevTools, pagesAt, placeName, sleep } from './lib/devtools';
import { pagePath } from './lib/parity';
import { DEV_OPTION, pagesText, serveBenchPages } from './lib/serve';
import type { BuildNames } from './lib/source-names';

/** Bytes between allocation samples: small, so a few bytes per frame still show. */
const SAMPLING_INTERVAL = 128;
/**
 * Seconds the sketch runs before sampling starts. The browser optimizes code that runs once per frame
 * only after many frames, and until then the numbers such code computes are allocated.
 */
const WARMUP_SECONDS = 30;
/**
 * Frames the page must draw before sampling starts as well. The browser optimizes by frames, so a
 * display at a lower refresh rate needs more seconds for the same warm-up.
 */
const WARMUP_FRAMES = 3600;
/** The workers the check samples, by a part of their script's URL. */
const WORKERS = ['sketch-worker', 'render-worker'] as const;

/**
 * Places that allocate for reasons outside the engine's frame code, by function and file, with the
 * most bytes per frame each may allocate:
 * - frame timers, which get a new number object from the browser's clock at each reading;
 * - the sketch worker's frame wait: the result and promise of `Atomics.waitAsync`, and settling it
 *   between tasks;
 * - the render worker's WebGPU objects: the command encoder, the passes, the command buffer, and
 *   the canvas texture and its view;
 * - the staging ring's mapping, for uploads that go through it: the mapped range and the views that
 *   copy into it, and the promise of the request to map the buffer again;
 * - the upload route timing, which reads the clock around the uploads of one submit in a few;
 * - the time the browser passes to each animation frame callback, between tasks;
 * - with --dev, the benchmark sketch's camera path, whose numbers go to the engine's development
 *   checks;
 * - an instance batch's array views, rebuilt once each time the engine's memory grows, which it
 *   does a few times while its buffers reach their final sizes.
 */
const BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {
		'frame sketch/runner.ts': 240,
		'runPipelined workers/sketch-worker.ts': 128,
		'changeOf workers/sketch-worker.ts': 16,
		'(IDLE)': 96,
		'(anonymous) null3d/sketch-common.ts': 48,
		'views scene/scene.ts': 16,
	},
	'render-worker': {
		'replay webgpu/backend.ts': 320,
		'commandEncoder webgpu/backend.ts': 32,
		'draw render/loop.ts': 64,
		'drawFrame render/webgpu-renderer.ts': 48,
		'drawFrame render/webgl2-renderer.ts': 48,
		'(IDLE)': 48,
		'(JS)': 24,
		'take webgpu/staging.ts': 160,
		'write webgpu/staging.ts': 96,
		'afterSubmit webgpu/staging.ts': 160,
		'then (built-in)': 80,
		'Uint8Array (built-in)': 64,
		'submit webgpu/backend.ts': 32,
	},
};
/** The most bytes per frame any other place may allocate: sampling noise, less than one object. */
const OTHER_BUDGET = 4;

interface ProfileNode {
	callFrame: CallFrame;
	selfSize: number;
	children: ProfileNode[];
}

/** Gives each node of a profile its function's name and file from the build's source maps. */
function nameNodes(node: ProfileNode, names: BuildNames): void {
	node.callFrame = names.name(node.callFrame);
	for (const child of node.children) nameNodes(child, names);
}

function totalSize(node: ProfileNode): number {
	return node.selfSize + node.children.reduce((sum, child) => sum + totalSize(child), 0);
}

/** Callers shown for each place that allocates. */
const CALLERS_SHOWN = 2;

/** How often the input driver acts, in milliseconds: about once per frame at 60 Hz. */
const INPUT_STEP_MS = 16;

/**
 * Moves the mouse in circles over the canvas until `running` turns false. It presses a key every
 * 10 steps and holds the mouse button down for a few steps in every 30, so the page writes moves,
 * drags, clicks and key presses into the input ring.
 */
async function driveInput(page: Page, running: () => boolean): Promise<void> {
	const box = await page.locator('canvas').boundingBox();
	if (!box) throw new Error('the benchmark page has no canvas');
	for (let step = 0; running(); step++) {
		const angle = step * 0.2;
		await page.mouse.move(
			box.x + box.width * (0.5 + 0.3 * Math.cos(angle)),
			box.y + box.height * (0.5 + 0.3 * Math.sin(angle)),
		);
		if (step % 10 === 0) await page.keyboard.press('KeyW');
		if (step % 30 === 0) await page.mouse.down();
		if (step % 30 === 5) await page.mouse.up();
		await sleep(INPUT_STEP_MS);
	}
}

interface Place {
	bytes: number;
	/** The callers of the call path that allocated most here. */
	callers: string;
	largest: number;
}

/** Bytes by the place that allocated them. */
function byPlace(
	node: ProfileNode,
	out = new Map<string, Place>(),
	callers: readonly string[] = [],
): Map<string, Place> {
	const name = placeName(node.callFrame);
	if (node.selfSize > 0) {
		const place = out.get(name) ?? { bytes: 0, callers: '', largest: 0 };
		place.bytes += node.selfSize;
		if (node.selfSize > place.largest) {
			place.largest = node.selfSize;
			place.callers = callers.slice(0, CALLERS_SHOWN).join(' < ');
		}
		out.set(name, place);
	}
	for (const child of node.children) byPlace(child, out, [name, ...callers]);
	return out;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const option = (name: string, fallback: number) => {
		const at = args.indexOf(name);
		return at >= 0 ? Number(args[at + 1]) : fallback;
	};
	const n = option('--n', 100_000);
	const seconds = option('--seconds', 5);
	const gpu = args.includes('--gpu') ? args[args.indexOf('--gpu') + 1] : 'webgpu';
	if (gpu !== 'webgpu' && gpu !== 'webgl2')
		throw new Error(`--gpu takes webgpu or webgl2, not ${gpu}`);
	// The browser optimizes code that runs once per frame only after many frames; until then,
	// numbers that such code computes are allocated.
	const warmup = option('--warmup', WARMUP_SECONDS);
	const dev = args.includes(DEV_OPTION);
	const server = await serveBenchPages({ dev });
	const browser = await chromium.launch({
		channel: 'chrome',
		headless: false,
		args: [`--remote-debugging-port=${DEBUG_PORT}`],
	});
	try {
		const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
		// The page's own measurement starts after the sampling ends, so its timers stay off.
		const pageSeconds = warmup + seconds + 60;
		const kind = gpu === 'webgl2' ? 'null3d-webgl2' : 'null3d-webgpu';
		const url = `${server.url}${pagePath('s1', kind, `seconds=${pageSeconds}&n=${n}`)}`;
		await page.goto(url);
		// Counts the display's frames on the page, which the render worker draws at the same rate.
		await page.evaluate(() => {
			const scope = globalThis as unknown as {
				requestAnimationFrame(callback: () => void): number;
				__frameCounter?: { frames: number };
			};
			const counter = { frames: 0 };
			const tick = () => {
				counter.frames++;
				scope.requestAnimationFrame(tick);
			};
			scope.requestAnimationFrame(tick);
			scope.__frameCounter = counter;
		});
		const framesSoFar = () =>
			page.evaluate(
				() => (globalThis as { __frameCounter?: { frames: number } }).__frameCounter?.frames ?? 0,
			);
		const devtools = await DevTools.connect(DEBUG_PORT);
		const [target] = await pagesAt(devtools, url);
		if (!target) throw new Error(`no page target for ${url}`);
		const { workers: sessions } = await attachWorkers(devtools, target.targetId, WORKERS);
		// Input runs from now to the end of the sample, so the code that reads it warms up too.
		let driving = true;
		const input = driveInput(page, () => driving);
		// A failure is reported where the input is awaited, after the sample.
		input.catch(() => {});
		// Let the sketch run its setup and warm up before sampling.
		await sleep(warmup * 1000);
		while ((await framesSoFar()) < WARMUP_FRAMES) await sleep(1000);
		for (const sessionId of sessions.values()) {
			await devtools.send('HeapProfiler.enable', {}, sessionId);
			// The profiler keeps the samples of objects that garbage collection frees, which per-frame
			// garbage is; by default it reports only objects still alive when sampling stops.
			await devtools.send(
				'HeapProfiler.startSampling',
				{
					samplingInterval: SAMPLING_INTERVAL,
					includeObjectsCollectedByMajorGC: true,
					includeObjectsCollectedByMinorGC: true,
				},
				sessionId,
			);
		}
		const startFrames = await framesSoFar();
		await sleep(seconds * 1000);
		const profiles = new Map<string, ProfileNode>();
		for (const [name, sessionId] of sessions) {
			const { profile } = await devtools.send<{ profile: { head: ProfileNode } }>(
				'HeapProfiler.stopSampling',
				{},
				sessionId,
			);
			if (server.names) nameNodes(profile.head, server.names);
			profiles.set(name, profile.head);
		}
		const frames = (await framesSoFar()) - startFrames;
		driving = false;
		await input;
		devtools.close();
		console.log(
			`S1 on ${gpu} with ${n} instances, ${pagesText(dev)}, sampled for ${seconds} s after ${warmup} s: ${frames} frames`,
		);
		const over: string[] = [];
		for (const [worker, head] of profiles) {
			const budgets = BUDGETS[worker as (typeof WORKERS)[number]];
			console.log(`${worker}: ${(totalSize(head) / frames).toFixed(1)} bytes per frame`);
			const places = [...byPlace(head)].sort((a, b) => b[1].bytes - a[1].bytes);
			for (const [name, { bytes, callers }] of places) {
				const perFrame = bytes / frames;
				const budget = budgets[name] ?? OTHER_BUDGET;
				if (perFrame > budget) over.push(`${worker}: ${name}`);
				console.log(
					`  ${perFrame.toFixed(1).padStart(6)} of ${String(budget).padStart(3)}  ${name}${callers ? ` < ${callers}` : ''}`,
				);
			}
		}
		console.log(over.length === 0 ? 'pass' : `FAIL: over budget: ${over.join('; ')}`);
		process.exitCode = over.length === 0 ? 0 : 1;
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
