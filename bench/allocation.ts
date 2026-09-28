// Measures what the engine's game worker and render worker allocate per frame while S1 runs, with
// Chrome's heap profiler. Engine code and the game's row writes must allocate nothing per frame;
// the few places that allocate because the browser does each have a budget below. It opens the
// null3d S1 page in Chrome, lets the browser optimize the frame code, attaches the heap profiler to
// both workers through Chrome's debugging protocol, samples allocations for a few seconds, and
// prints the bytes per frame of every place that allocated. From the repository root:
//   bun run bench:allocation
//   bun run bench:allocation -- --n 30000 --seconds 5 --warmup 30
// At 30,000 instances a frame's upload goes through the staging ring; at 100,000 it does not.
import { chromium } from '@playwright/test';
import { startServer } from '../tests/lib/server.ts';
import { pagePath } from './lib/parity';

/** Chrome's debugging port for this check. */
const DEBUG_PORT = 9333;
/** Bytes between allocation samples: small, so a few bytes per frame still show. */
const SAMPLING_INTERVAL = 128;
/**
 * Seconds the game runs before sampling starts. The browser optimizes code that runs once per frame
 * only after many frames, and until then the numbers such code computes are allocated.
 */
const WARMUP_SECONDS = 30;
/** The workers the check samples, by a part of their script's URL. */
const WORKERS = ['game-worker', 'render-worker'] as const;

/**
 * Places that allocate for reasons outside the engine's frame code, by function and file, with the
 * most bytes per frame each may allocate:
 * - frame timers, which get a new number object from the browser's clock at each reading;
 * - the game worker's frame wait: the result and promise of `Atomics.waitAsync`, and settling it
 *   between tasks;
 * - the render worker's WebGPU objects: the command encoder, the passes, the command buffer, and
 *   the canvas texture and its view;
 * - the staging ring's mapping, for uploads that go through it: the mapped range and the views that
 *   copy into it, and the promise of the request to map the buffer again;
 * - the upload route timing, which reads the clock around the uploads of one submit in a few;
 * - the time the browser passes to each animation frame callback, between tasks;
 * - the benchmark game's camera path, whose numbers go to the engine's development checks;
 * - an instance batch's array views, rebuilt once each time the engine's memory grows, which it
 *   does a few times while its buffers reach their final sizes.
 */
const BUDGETS: Record<(typeof WORKERS)[number], Record<string, number>> = {
	'game-worker': {
		'step game/runner.ts': 240,
		'runPipelined workers/game-worker.ts': 128,
		'changeOf workers/game-worker.ts': 16,
		'(IDLE)': 96,
		'(anonymous) null3d/game-common.ts': 48,
		'views scene/scene.ts': 16,
	},
	'render-worker': {
		'replay webgpu/backend.ts': 320,
		'commandEncoder webgpu/backend.ts': 32,
		'draw render/loop.ts': 64,
		'drawFrame render/scene-renderer.ts': 48,
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
	callFrame: { functionName: string; url: string; lineNumber: number };
	selfSize: number;
	children: ProfileNode[];
}

interface TargetInfo {
	targetId: string;
	type: string;
	url: string;
}

/** A minimal client for Chrome's debugging protocol over the browser's WebSocket. */
class DevTools {
	private next = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (result: unknown) => void; reject: (error: Error) => void }
	>();
	private readonly listeners = new Map<string, ((params: unknown, sessionId?: string) => void)[]>();

	private constructor(private readonly socket: WebSocket) {
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data)) as {
				id?: number;
				method?: string;
				params?: unknown;
				sessionId?: string;
				result?: unknown;
				error?: { message: string };
			};
			if (message.id === undefined) {
				for (const listener of this.listeners.get(message.method ?? '') ?? [])
					listener(message.params, message.sessionId);
				return;
			}
			const call = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) call?.reject(new Error(message.error.message));
			else call?.resolve(message.result);
		};
	}

	static async connect(): Promise<DevTools> {
		const version = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).json()) as {
			webSocketDebuggerUrl: string;
		};
		const socket = new WebSocket(version.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => {
			socket.onopen = resolve;
			socket.onerror = reject;
		});
		return new DevTools(socket);
	}

	send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
		const id = this.next++;
		this.socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject }),
		);
	}

	on(method: string, listener: (params: unknown, sessionId?: string) => void): void {
		this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
	}

	close(): void {
		this.socket.close();
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function totalSize(node: ProfileNode): number {
	return node.selfSize + node.children.reduce((sum, child) => sum + totalSize(child), 0);
}

/** Callers shown for each place that allocates. */
const CALLERS_SHOWN = 2;

/**
 * A place in the code, by function and file: the key of the budgets. A named function with no file
 * is one of the browser's built-in functions, such as a promise's then.
 */
function placeName({ functionName, url }: ProfileNode['callFrame']): string {
	const name = functionName || '(anonymous)';
	if (!url) return name.startsWith('(') ? name : `${name} (built-in)`;
	return `${name} ${url.split('/').slice(-2).join('/').replace(/\?.*$/, '')}`;
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

/**
 * Attaches to the page and then to its workers, which Chrome reports only to a session that asks
 * to attach to a page's related targets. Returns a debugging session for each sampled worker.
 */
async function attachWorkers(devtools: DevTools, pageUrl: string): Promise<Map<string, string>> {
	const sessions = new Map<string, string>();
	devtools.on('Target.attachedToTarget', (params) => {
		const { sessionId, targetInfo } = params as { sessionId: string; targetInfo: TargetInfo };
		const name = WORKERS.find((w) => targetInfo.type === 'worker' && targetInfo.url.includes(w));
		if (name) sessions.set(name, sessionId);
	});
	const { targetInfos } = await devtools.send<{ targetInfos: TargetInfo[] }>('Target.getTargets');
	const path = new URL(pageUrl).pathname;
	const page = targetInfos.find((t) => t.type === 'page' && t.url.includes(path));
	if (!page) throw new Error(`no page target for ${pageUrl}`);
	const { sessionId } = await devtools.send<{ sessionId: string }>('Target.attachToTarget', {
		targetId: page.targetId,
		flatten: true,
	});
	await devtools.send(
		'Target.setAutoAttach',
		{ autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
		sessionId,
	);
	for (let tries = 0; tries < 100 && sessions.size < WORKERS.length; tries++) await sleep(100);
	const missing = WORKERS.filter((w) => !sessions.has(w));
	if (missing.length > 0) throw new Error(`no worker target appeared for ${missing.join(', ')}`);
	return sessions;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const option = (name: string, fallback: number) => {
		const at = args.indexOf(name);
		return at >= 0 ? Number(args[at + 1]) : fallback;
	};
	const n = option('--n', 100_000);
	const seconds = option('--seconds', 5);
	// The browser optimizes code that runs once per frame only after many frames; until then,
	// numbers that such code computes are allocated.
	const warmup = option('--warmup', WARMUP_SECONDS);
	const server = await startServer();
	const browser = await chromium.launch({
		channel: 'chrome',
		headless: false,
		args: [`--remote-debugging-port=${DEBUG_PORT}`],
	});
	try {
		const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
		// The page's own measurement starts after the sampling ends, so its timers stay off.
		const pageSeconds = warmup + seconds + 60;
		const url = `${server.url}${pagePath('s1', 'null3d-webgpu', `seconds=${pageSeconds}&n=${n}`)}`;
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
		const devtools = await DevTools.connect();
		const sessions = await attachWorkers(devtools, url);
		// Let the game run its setup and warm up before sampling.
		await sleep(warmup * 1000);
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
			profiles.set(name, profile.head);
		}
		const frames = (await framesSoFar()) - startFrames;
		devtools.close();
		console.log(
			`S1 with ${n} instances, sampled for ${seconds} s after ${warmup} s: ${frames} frames`,
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
