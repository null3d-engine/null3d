// Measures what the engine's sketch worker and render worker allocate per frame while S1 runs, with
// Chrome's heap profiler. Engine code and the sketch's row writes must allocate nothing per frame;
// the few places that allocate because the browser does each have a budget below. It opens the
// null3d S1 page in Chrome, lets the browser optimize the frame code, attaches the heap profiler to
// both workers through Chrome's debugging protocol, and samples allocations twice, a few seconds
// each. It prints the bytes per frame of every place that allocated, and judges each place by the
// sample where it allocated least, so an event that happens once fails no place. In each sample it
// sets aside one burst of objects per place: the browser makes one when it installs code that it
// has just optimized, in whichever callback runs first, even an empty one. From the page's
// start to the end of the samples, it moves the mouse over the canvas and presses a key and the
// mouse button, so the samples cover the sketch's reading of input. It draws with WebGPU, or with
// WebGL2 when `--gpu webgl2` asks for it. `--scene s1-cells` runs S1-cells, whose views skip whole
// grid cells, `--scene s3` runs S3, whose 256 point lights move every frame, and `--scene s4` runs
// S4, the phone scene, with its shadows, street lights and quality governor. `--blend` makes
// S1's boxes see through, so each frame sorts every visible row for the transparent pass.
// `--animated 64` adds 64 animated characters to S1, which play, cross-fade, blend a masked layer
// and an additive one, and fire events to the sketch's handlers through the animator. `--morphed 64`
// adds 64 spheres with three morph targets each, whose weights the sketch sets in every frame.
// `--grading`
// gives S1 a color grading table and the vignette, and changes both every frame. `--sprites` draws
// S1's swarm as one dynamic batch of blended sprites instead of boxes, and `--lines` as one dynamic
// batch of dashed line segments, whose dashes move every frame. `--labels 256` adds 256
// objects to S1, each with an HTML label that the page binds. The camera orbits, so each frame
// places every label at a new point, and the thread that draws copies them for the page.
// `--prepass` turns the depth prepass on, in any scene. It samples the production build of the
// benchmark pages, as a developer ships the engine, and names
// the build's functions through its source maps; `--dev` samples the dev server's pages, with the
// engine's development checks. `--no-inline` turns the browser's inlining off, so each function's
// objects count in its own place, not in its caller's; budgets then do not hold, so read the places,
// not the verdict. From the repository root:
//   bun run bench:allocation
//   bun run bench:allocation --n 30000 --seconds 5 --warmup 30
//   bun run bench:allocation --gpu webgl2
//   bun run bench:allocation --scene s1-cells --gpu webgl2
//   bun run bench:allocation --scene s3
//   bun run bench:allocation --scene s4 --gpu webgl2
//   bun run bench:allocation --blend --n 30000 --gpu webgl2
//   bun run bench:allocation --animated 64 --gpu webgl2
//   bun run bench:allocation --morphed 64 --gpu webgl2
//   bun run bench:allocation --grading --gpu webgl2
//   bun run bench:allocation --sprites --gpu webgl2
//   bun run bench:allocation --lines --gpu webgl2
//   bun run bench:allocation --scene s4 --prepass --gpu webgl2
//   bun run bench:allocation --labels 256 --gpu webgl2
//   bun run bench:allocation --labels 256 --no-inline
// At 30,000 instances a frame's upload goes through the staging ring; at 100,000 it does not.
import { chromium, type Page } from '@playwright/test';
import { DEBUG_PORT } from '../tests/lib/server.ts';
import {
	type HeapProfile,
	type ProfileNode,
	profilePlaces,
	type Sample,
	steadyPlaces,
	totalSize,
} from './lib/allocation';
import { attachWorkers, DevTools, pagesAt, sleep } from './lib/devtools';
import { pagePath } from './lib/parity';
import { DEV_OPTION, pagesText, serveBenchPages } from './lib/serve';
import type { BuildNames } from './lib/source-names';
import { S3_DEFAULT_COUNT } from './scenes/spec';

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
/**
 * Samples the check takes one after another. Allocation in every frame shows in each of them. An
 * event that happens once, such as the browser installing code it has just optimized, lands in one.
 */
const SAMPLES = 2;
/** The workers the check samples, by a part of their script's URL. */
const WORKERS = ['sketch-worker', 'render-worker'] as const;

/**
 * Places that allocate for reasons outside the engine's frame code, by function and file, with the
 * most bytes per frame each may allocate:
 * - frame timers, which get a new number object from the browser's clock at each reading;
 * - the sketch worker's frame wait in the frame loop, which the runner holds: the result and promise
 *   of `Atomics.waitAsync`, the await on that promise, and settling it between tasks;
 * - the render worker's WebGPU objects: the command encoder, the passes, the command buffer, and
 *   the canvas texture and its view. Each render pass adds its encoder, about 17 bytes. S4's two
 *   shadow passes and nine more uploads per frame put its replay 46 to 48 bytes above S1's;
 * - the completion tracker's object for each frame: the queue's promise and its reaction on WebGPU,
 *   which the browser counts in the renderer's `drawFrame` where it inlines the tracker, or the fence
 *   on WebGL2. After a few minutes the browser compiles the render loop's `draw` with `drawFrame`
 *   inlined and the tracker's `afterSubmit` not, and counts the object there. Also the clock
 *   readings at each frame's submit and completion, and at each check of the frames still in flight;
 * - the staging ring's mapping, for uploads that go through it: the mapped range and the views that
 *   copy into it, and the promise of the request to map the buffer again;
 * - the upload route timing, which reads the clock around the uploads of one submit in a few;
 * - the time the browser passes to each animation frame callback, between tasks;
 * - the benchmark sketch's camera path. With --dev, its numbers go to the engine's development
 *   checks. In S4, the browser runs it on its middle tier for the whole sample, which boxes about
 *   two of the numbers that it passes to the camera's setters;
 * - an instance batch's array views, rebuilt once each time the engine's memory grows, which it
 *   does a few times while its buffers reach their final sizes.
 */
const BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'sketch-worker': {
		'frame sketch/runner.ts': 240,
		'runPipelined sketch/runner.ts': 128,
		'slotChange shared/wake.ts': 16,
		'(IDLE)': 96,
		'(anonymous) null3d/sketch-common.ts': 48,
		'views scene/scene.ts': 16,
	},
	'render-worker': {
		'replay webgpu/backend.ts': 320,
		'commandEncoder webgpu/backend.ts': 32,
		'draw render/loop.ts': 64,
		'drawFrame render/scene-renderer.ts': 192,
		'(IDLE)': 48,
		'(JS)': 24,
		'take webgpu/staging.ts': 160,
		'write webgpu/staging.ts': 96,
		'afterSubmit webgpu/staging.ts': 160,
		'then (built-in)': 128,
		'Uint8Array (built-in)': 64,
		'submit webgpu/backend.ts': 32,
		'afterSubmit gpu/completion.ts': 160,
		'push gpu/completion.ts': 24,
		'finish gpu/completion.ts': 40,
		'unfinished gpu/completion.ts': 16,
	},
};
/** The most bytes per frame any other place may allocate: sampling noise, less than one object. */
const OTHER_BUDGET = 4;

/** Gives each node of a profile its function's name and file from the build's source maps. */
function nameNodes(node: ProfileNode, names: BuildNames): void {
	node.callFrame = names.name(node.callFrame);
	for (const child of node.children) nameNodes(child, names);
}

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

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const option = (name: string, fallback: number) => {
		const at = args.indexOf(name);
		return at >= 0 ? Number(args[at + 1]) : fallback;
	};
	const scene = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : 's1';
	if (scene !== 's1' && scene !== 's1-cells' && scene !== 's3' && scene !== 's4')
		throw new Error(`--scene takes s1, s1-cells, s3 or s4, not ${scene}`);
	const n = option('--n', scene === 's3' ? S3_DEFAULT_COUNT : 100_000);
	const seconds = option('--seconds', 5);
	const gpu = args.includes('--gpu') ? args[args.indexOf('--gpu') + 1] : 'webgpu';
	if (gpu !== 'webgpu' && gpu !== 'webgl2')
		throw new Error(`--gpu takes webgpu or webgl2, not ${gpu}`);
	// The browser optimizes code that runs once per frame only after many frames; until then,
	// numbers that such code computes are allocated.
	const warmup = option('--warmup', WARMUP_SECONDS);
	const dev = args.includes(DEV_OPTION);
	const noInline = args.includes('--no-inline');
	const server = await serveBenchPages({ dev });
	const browser = await chromium.launch({
		channel: 'chrome',
		headless: false,
		args: [
			`--remote-debugging-port=${DEBUG_PORT}`,
			...(noInline ? ['--js-flags=--no-turbo-inlining --no-maglev-inlining'] : []),
		],
	});
	try {
		const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
		// The page's own measurement starts after the sampling ends, so its timers stay off.
		const pageSeconds = warmup + seconds * SAMPLES + 60;
		const kind = gpu === 'webgl2' ? 'null3d-webgl2' : 'null3d-webgpu';
		const blend = args.includes('--blend') ? '&blend' : '';
		const animatedCount = option('--animated', 0);
		if (animatedCount > 0 && scene !== 's1')
			throw new Error('--animated adds animated characters to S1 only');
		const animated = animatedCount > 0 ? `&animated=${animatedCount}` : '';
		const morphedCount = option('--morphed', 0);
		if (morphedCount > 0 && scene !== 's1')
			throw new Error('--morphed adds morphed objects to S1 only');
		const morphed = morphedCount > 0 ? `&morphed=${morphedCount}` : '';
		const grading = args.includes('--grading') ? '&grading' : '';
		if (grading && scene !== 's1') throw new Error('--grading grades S1 only');
		const sprites = args.includes('--sprites') ? '&sprites' : '';
		if (sprites && scene !== 's1') throw new Error('--sprites draws S1 as sprites only');
		const lines = args.includes('--lines') ? '&lines' : '';
		if (lines && scene !== 's1') throw new Error('--lines draws S1 as lines only');
		const prepass = args.includes('--prepass') ? '&prepass=on' : '';
		const labelCount = option('--labels', 0);
		if (labelCount > 0 && scene !== 's1') throw new Error('--labels adds labels to S1 only');
		const labels = labelCount > 0 ? `&labels=${labelCount}` : '';
		const query = `seconds=${pageSeconds}&n=${n}${blend}${animated}${morphed}${grading}${sprites}${lines}${prepass}${labels}`;
		const url = `${server.url}${pagePath(scene, kind, query)}`;
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
		for (const sessionId of sessions.values())
			await devtools.send('HeapProfiler.enable', {}, sessionId);
		const samples = new Map<string, Sample[]>();
		const bytes = new Map<string, number>();
		let frames = 0;
		for (let k = 0; k < SAMPLES; k++) {
			for (const sessionId of sessions.values()) {
				// The profiler keeps the samples of objects that garbage collection frees, which
				// per-frame garbage is; by default it reports only objects still alive when sampling
				// stops.
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
			const profiles = new Map<string, HeapProfile>();
			for (const [name, sessionId] of sessions) {
				const { profile } = await devtools.send<{ profile: HeapProfile }>(
					'HeapProfiler.stopSampling',
					{},
					sessionId,
				);
				if (server.names) nameNodes(profile.head, server.names);
				profiles.set(name, profile);
			}
			const sampleFrames = (await framesSoFar()) - startFrames;
			frames += sampleFrames;
			for (const [name, profile] of profiles) {
				samples.set(name, [
					...(samples.get(name) ?? []),
					{ places: profilePlaces(profile), frames: sampleFrames },
				]);
				bytes.set(name, (bytes.get(name) ?? 0) + totalSize(profile.head));
			}
		}
		driving = false;
		await input;
		devtools.close();
		console.log(
			`${scene.toUpperCase()} on ${gpu} with ${n} instances${animatedCount > 0 ? ` and ${animatedCount} animated characters` : ''}${morphedCount > 0 ? ` and ${morphedCount} morphed objects` : ''}${labelCount > 0 ? ` and ${labelCount} labels` : ''}, ${pagesText(dev)}${noInline ? ', inlining off' : ''}, sampled ${SAMPLES} times for ${seconds} s after ${warmup} s: ${frames} frames`,
		);
		console.log(
			'Bytes per frame in the sample where each place allocated least, its budget, and the most:',
		);
		const over: string[] = [];
		for (const [worker, workerSamples] of samples) {
			const budgets = BUDGETS[worker as (typeof WORKERS)[number]];
			console.log(`${worker}: ${((bytes.get(worker) ?? 0) / frames).toFixed(1)} bytes per frame`);
			for (const [name, { perFrame, most, callers }] of steadyPlaces(workerSamples)) {
				const budget = budgets[name] ?? OTHER_BUDGET;
				if (perFrame > budget) over.push(`${worker}: ${name}`);
				console.log(
					`  ${perFrame.toFixed(1).padStart(6)} of ${String(budget).padStart(3)} (${most.toFixed(1).padStart(6)})  ${name}${callers ? ` < ${callers}` : ''}`,
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
