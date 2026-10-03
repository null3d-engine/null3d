import { type CDPSession, expect, type Page, test } from '@playwright/test';
import * as Slot from '../../packages/engine/src/shared/slot.ts';
import { ENGINE_MODES, THREADED_MODES } from '../lib/engine-checks.ts';
import { prefixEngineScripts, restoreEngineScripts } from '../lib/engine-scripts.ts';
import { gpuObjectsHeld, watchGpuObjects } from '../lib/gpu-ledger.ts';
import { pageResult } from '../lib/page-result.ts';
import type { RestartResult } from '../lib/plans.ts';

/** How many times each test starts and stops the engine on one page. */
const CYCLES = 3;

/** How many objects the page can still reach whose prototype chain holds `prototype`. */
async function reachable(cdp: CDPSession, prototype: string): Promise<number> {
	const { result } = await cdp.send('Runtime.evaluate', { expression: prototype });
	const { objects } = await cdp.send('Runtime.queryObjects', {
		prototypeObjectId: result.objectId as string,
	});
	const count = await cdp.send('Runtime.callFunctionOn', {
		objectId: objects.objectId as string,
		functionDeclaration: 'function () { return this.length; }',
		returnByValue: true,
	});
	return count.result.value as number;
}

/**
 * How long a test collects garbage and counts again until the page has let go of an engine. A
 * worker that has just stopped can hold its objects until its last messages have arrived, so one
 * collection right after a stop can still find them.
 */
const RELEASE_TIMEOUT_MS = 10_000;

/**
 * Collects garbage and counts the shared memories and the workers that the page reaches, again
 * and again until it reaches `memories` memories and no worker, within the bound.
 */
async function expectReleased(page: Page, memories: number): Promise<void> {
	const cdp = await page.context().newCDPSession(page);
	await expect
		.poll(
			async () => {
				await cdp.send('HeapProfiler.collectGarbage');
				return {
					memories: await reachable(cdp, 'WebAssembly.Memory.prototype'),
					workers: await reachable(cdp, 'Worker.prototype'),
				};
			},
			{ timeout: RELEASE_TIMEOUT_MS },
		)
		.toEqual({ memories, workers: 0 });
}

// A page starts the engine again after it stops it, and after a collection it reaches none of a
// stopped engine's memory, except the single-threaded build's core, which the page keeps for the
// next engine. Each stop destroys every GPU object that the engine made, with its device or its
// WebGL2 context, on whichever thread drew: a browser frees what a stopped worker still holds only
// when it collects the worker's objects. The count of GPU objects is exact, so a few starts show an
// object that any start leaves behind.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`the engine starts again after it stops, and lets go of its memory and its GPU objects, ${mode.name} on ${gpu}`, async ({
			page,
		}) => {
			await watchGpuObjects(page);
			await page.goto(`shared-memory.html?room=off&cycles=${CYCLES}&gpu=${gpu}&${mode.query}`);
			const result = await pageResult<RestartResult & { error?: string }>(page, 60_000);
			await restoreEngineScripts(page);
			await expect.poll(() => gpuObjectsHeld(page)).toEqual({});
			expect(result.error).toBeUndefined();
			expect(result.kinds.engine?.error).toBeUndefined();
			expect(result.kinds.engine?.cycles).toBe(CYCLES);
			await expectReleased(page, mode.build === 'single' ? 1 : 0);
		});
	}
}

/**
 * Makes each GPU texture fail as the iPad's did once its GPU memory ran out, in every thread, so
 * the thread that draws fails at its first frame, while the engine starts.
 */
const TEXTURES_FAIL = `if (typeof GPUDevice !== 'undefined') GPUDevice.prototype.createTexture = () => {
	throw new DOMException('GPUDevice.createTexture: Unable to create texture.', 'InvalidStateError');
};`;

// When the thread that draws fails while the engine starts, the start fails with that error instead
// of waiting for frames that never come. The engine has stopped by then, so after a collection the
// page reaches none of its memory and none of its workers.
for (const mode of ENGINE_MODES) {
	test(`a start whose drawing fails rejects, and lets go of its memory, ${mode.name}`, async ({
		page,
	}) => {
		await prefixEngineScripts(page, TEXTURES_FAIL);
		await page.goto(`shared-memory.html?room=off&cycles=1&gpu=webgpu&${mode.query}`);
		const result = await pageResult<RestartResult & { error?: string }>(page, 60_000);
		await restoreEngineScripts(page);
		const engine = result.kinds.engine;
		expect(engine?.error).toMatch(/^E140[45]: .*Unable to create texture/);
		await expectReleased(page, mode.build === 'single' ? 1 : 0);
	});
}

/** What the page's trail notes once its second copy of a worker that did not load has loaded. */
const COPY_LOADED = /null3d-render: a second copy of the worker loaded/;

// With the sketch on the main thread, the setup can wait for frames of the render worker, as the
// preset check after the first frame does. When the render worker's script does not load, as over
// a network that drops a request, the start rejects at once with the reason, instead of waiting for
// frames that never come. The page's trail notes the failure, and that a second copy of the worker
// loads. Once that copy has stopped, the page reaches none of the engine's memory and workers.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	test(`a start whose render worker does not load rejects at once, sketch on the main thread on ${gpu}`, async ({
		page,
	}) => {
		let renderLoads = 0;
		await page
			.context()
			.route(/\/render-worker\.ts/, (route) =>
				++renderLoads === 1 ? route.abort('connectionreset') : route.continue(),
			);
		await page.goto(`shared-memory.html?room=off&cycles=1&gpu=${gpu}&sketch-thread=main`);
		const result = await pageResult<RestartResult>(page, 30_000);
		const engine = result.kinds.engine;
		expect(engine?.error).toMatch(
			/^E1405: the render worker did not start: its script or a file it imports did not load\./,
		);
		expect(engine?.trail?.join('\n')).toContain(
			'null3d-render: failed: its script or a file it imports did not load',
		);
		await expect
			.poll(() =>
				page.evaluate(() =>
					(globalThis as { __null3dProgress?: string[] }).__null3dProgress?.join('\n'),
				),
			)
			.toMatch(COPY_LOADED);
		await expectReleased(page, 0);
	});
}

/** How long the page goes on after its capture before it stops the engine. */
const STOP_AFTER_MS = 500;
/** The longest that the render worker holds a frame while it waits for the page to stop. */
const HOLD_MS = 10_000;
/** How long it holds the frame after the stop began, so the page's stop runs its steps meanwhile. */
const SETTLE_MS = 200;
/** What the render worker logs when the stop began while it held a frame. */
const HELD = 'null3D test: the engine stopped while the render worker held a frame';

/**
 * Makes the render worker hold the first frame that it takes after it answers a capture, after it
 * found the frame's draw list and before it replays it, until the page stops the engine. It then
 * asks the core, through the render worker's own instance of it, for the address of the frame's
 * list, and fails the frame when the core no longer holds the list there: the core gives 0 once
 * the engine is gone.
 */
const HOLD_FRAME_UNTIL_STOP = `if (self.name === 'null3d-render' && !self.__null3dHoldFrame) {
	self.__null3dHoldFrame = true;
	let control;
	let core;
	let armed = false;
	self.addEventListener('message', (event) => {
		if (event.data?.type === 'init') control = event.data.control;
	});
	WebAssembly.Instance = new Proxy(WebAssembly.Instance, {
		construct(target, args) {
			const made = Reflect.construct(target, args);
			if (made.exports.drawListAddress) core = made.exports;
			return made;
		},
	});
	const post = self.postMessage.bind(self);
	self.postMessage = (message, options) => {
		if (message?.type === 'captured') armed = true;
		return post(message, options);
	};
	const store = Atomics.store;
	Atomics.store = (array, index, value) => {
		if (armed && array.buffer === control && array.byteOffset === 0 && index === ${Slot.FramesTaken}) {
			armed = false;
			const slots = new Int32Array(control);
			const parity = value & 1;
			const list = Atomics.load(slots, ${Slot.DrawListAddress0} + parity);
			const until = performance.now() + ${HOLD_MS};
			while (Atomics.load(slots, ${Slot.Running}) !== 0 && performance.now() < until);
			if (Atomics.load(slots, ${Slot.Running}) === 0) console.log('${HELD}');
			const settled = performance.now() + ${SETTLE_MS};
			while (performance.now() < settled);
			if (core.drawListAddress(parity) !== list)
				throw new Error('the core freed the draw list while the render worker held its frame');
		}
		return store(array, index, value);
	};
}`;

// With the sketch on the main thread, the page's core lives in the memory that the render worker
// reads each frame's draw list from. When the engine stops while the render worker is inside a
// frame, the page must keep the core until the render worker has stopped, or the frame's replay
// reads a draw list that the core has freed.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	test(`a stop during a frame of the render worker keeps the frame's draw list, sketch on the main thread on ${gpu}`, async ({
		page,
	}) => {
		const logs: string[] = [];
		page.on('worker', (worker) => worker.on('console', (message) => logs.push(message.text())));
		await prefixEngineScripts(page, HOLD_FRAME_UNTIL_STOP);
		await page.goto(
			`scene.html?gpu=${gpu}&seconds=0.25&stop-after=${STOP_AFTER_MS}&sketch-thread=main`,
		);
		const result = await pageResult<{ error?: string; failures: string[] }>(page, 60_000);
		await restoreEngineScripts(page);
		expect(logs).toContain(HELD);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
	});
}

/** The job workers that the page's trail notes as started, and as stopped. */
const JOB_STARTED = /null3d-job-\d+: started/g;
const JOB_STOPPED = /null3d-job-\d+: stopped/g;

// A page that leaves while its engine runs, as a page in a frame does when the frame goes away,
// still ends the job workers' blocking waits: the browser then stops the workers wherever they are,
// and Safari never frees the shared memory of a thread that it stops inside such a wait. So on
// pagehide every job worker leaves its loop and says so, before anything stops the engine.
for (const mode of THREADED_MODES) {
	test(`a page that leaves without stopping the engine ends the job workers' waits, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`engine-frame.html?gpu=webgl2&${mode.query}`);
		await expect
			.poll(() => page.evaluate('window.__engineFrame?.engineFrame'), { timeout: 30_000 })
			.toBe('running');
		const trail = async () =>
			String(await page.evaluate("window.__null3dProgress?.join('\\n') ?? ''"));
		const jobs = (await trail()).match(JOB_STARTED)?.length ?? 0;
		expect(jobs).toBeGreaterThan(0);
		expect((await trail()).match(JOB_STOPPED)).toBeNull();
		await page.evaluate("dispatchEvent(new PageTransitionEvent('pagehide'))");
		await expect.poll(async () => (await trail()).match(JOB_STOPPED)?.length ?? 0).toBe(jobs);
	});
}
