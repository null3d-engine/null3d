// A client for Chrome's debugging protocol, for the tools that sample a page's workers and time its
// start. It connects to a browser that listens on a local debugging port, attaches to a page and to
// its workers, evaluates expressions in them, and samples their heaps. The browser is one that
// Playwright started with `--remote-debugging-port`, or Chrome on a phone whose debugging socket adb
// forwards to a local port.
import { createServer } from 'node:net';

/** @import { CallFrame, HeapProfile } from './heap-profile.js' */

/**
 * A page or worker that the browser reports.
 *
 * @typedef {object} TargetInfo
 * @property {string} targetId
 * @property {string} type
 * @property {string} url
 */

/**
 * Resolves after `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves with `promise`, or throws naming `step` once `ms` milliseconds have passed.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} step
 * @returns {Promise<T>}
 */
export async function within(promise, ms, step) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	const late = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${step} took longer than ${ms / 1000} s`)), ms);
	});
	try {
		return await Promise.race([promise, late]);
	} finally {
		clearTimeout(timer);
	}
}

/** How long a browser that is starting may take to open its debugging port. */
const CONNECT_TIMEOUT_MS = 20_000;

/**
 * The longest that one call to the browser may take, such as starting or stopping a sample, or
 * reading the frame count. Each takes under a few seconds; a call that never returns would
 * otherwise hold a machine until its job's own time runs out.
 */
const STEP_MS = 60_000;

/**
 * A port that no process listens on, for a browser's debugging socket. The caller gives it to the
 * browser at its start, so the tool can connect to the browser that it started.
 *
 * @returns {Promise<number>}
 */
export function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, () => {
			const address = server.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

/**
 * The client of one browser's debugging socket. Each call waits for the browser's answer, and each
 * event of a method that the client watches goes to its listener.
 */
export class DevTools {
	/** @type {number} */
	#next = 1;
	/** @type {Map<number, { method: string, resolve: (result: unknown) => void, reject: (error: Error) => void }>} */
	#pending = new Map();
	/** @type {Map<string, ((params: unknown, sessionId?: string) => void)[]>} */
	#listeners = new Map();

	/** @param {WebSocket} socket */
	constructor(socket) {
		this.socket = socket;
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id === undefined) {
				for (const listener of this.#listeners.get(message.method ?? '') ?? [])
					listener(message.params, message.sessionId);
				return;
			}
			const call = this.#pending.get(message.id);
			this.#pending.delete(message.id);
			if (message.error) call?.reject(new Error(`${call?.method}: ${message.error.message}`));
			else call?.resolve(message.result);
		};
	}

	/**
	 * Connects to the browser that listens on a local debugging port, waiting while a browser that
	 * is still starting opens it. A phone's Chrome reports an address without the forwarded port, so
	 * only the path of the address it reports is used.
	 *
	 * @param {number} port
	 * @param {number} [timeoutMs]
	 * @returns {Promise<DevTools>}
	 */
	static async connect(port, timeoutMs = CONNECT_TIMEOUT_MS) {
		const deadline = Date.now() + timeoutMs;
		/** @type {{ webSocketDebuggerUrl: string } | undefined} */
		let version;
		while (!version) {
			try {
				version = /** @type {{ webSocketDebuggerUrl: string }} */ (
					await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
				);
			} catch (error) {
				if (Date.now() > deadline)
					throw new Error(
						`no browser answered on debugging port ${port}: ${error instanceof Error ? error.message : error}`,
					);
				await sleep(250);
			}
		}
		const path = new URL(version.webSocketDebuggerUrl).pathname;
		const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
		await new Promise((resolve, reject) => {
			socket.onopen = resolve;
			socket.onerror = reject;
		});
		return new DevTools(socket);
	}

	/**
	 * @template T
	 * @param {string} method
	 * @param {object} [params]
	 * @param {string} [sessionId]
	 * @returns {Promise<T>}
	 */
	send(method, params = {}, sessionId) {
		const id = this.#next++;
		this.socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
		return new Promise((resolve, reject) =>
			this.#pending.set(id, {
				method,
				resolve: /** @type {(result: unknown) => void} */ (resolve),
				reject,
			}),
		);
	}

	/**
	 * Calls `listener` on each event of `method`, until the function it returns is called.
	 *
	 * @param {string} method
	 * @param {(params: unknown, sessionId?: string) => void} listener
	 * @returns {() => void}
	 */
	on(method, listener) {
		this.#listeners.set(method, [...(this.#listeners.get(method) ?? []), listener]);
		return () =>
			this.#listeners.set(
				method,
				(this.#listeners.get(method) ?? []).filter((other) => other !== listener),
			);
	}

	close() {
		this.socket.close();
	}
}

/** The debugging sessions of a page and of its named workers. */
/**
 * @typedef {object} Attached
 * @property {string} page The debugging session of the page.
 * @property {Map<string, string>} workers The debugging session of each named worker.
 */

/** A worker that a debugging session attached to. */
/**
 * @typedef {object} AttachedWorker
 * @property {string} sessionId
 * @property {string} url The address of the worker's script.
 */

/** How long a page's workers may take to appear after the tool attaches to the page. */
const WORKERS_TIMEOUT_MS = 30_000;

/**
 * The pages whose address holds the path of `url`.
 *
 * @param {DevTools} devtools
 * @param {string} url
 * @returns {Promise<TargetInfo[]>}
 */
export async function pagesAt(devtools, url) {
	const path = new URL(url).pathname;
	const { targetInfos } = /** @type {{ targetInfos: TargetInfo[] }} */ (
		await devtools.send('Target.getTargets')
	);
	return targetInfos.filter((target) => target.type === 'page' && target.url.includes(path));
}

/**
 * Closes the pages whose address holds the path of `url`, such as pages an earlier run left open.
 *
 * @param {DevTools} devtools
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function closePagesAt(devtools, url) {
	for (const { targetId } of await pagesAt(devtools, url))
		await devtools.send('Target.closeTarget', { targetId });
}

/**
 * Attaches to a page and then to its workers, which Chrome reports only to a session that asks to
 * attach to a page's related targets. It waits until `enough` accepts the workers so far, or for
 * a while at most.
 *
 * @param {DevTools} devtools
 * @param {string} targetId
 * @param {(workers: readonly AttachedWorker[]) => boolean} enough
 * @param {number} [timeoutMs]
 * @returns {Promise<{ page: string, workers: AttachedWorker[] }>}
 */
async function attachPage(devtools, targetId, enough, timeoutMs = WORKERS_TIMEOUT_MS) {
	const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true });
	/** @type {AttachedWorker[]} */
	const workers = [];
	// A page may start its workers itself, or one of them may start the rest, so every worker
	// counts as a parent of the workers that it starts.
	devtools.on('Target.attachedToTarget', (params, parent) => {
		const { sessionId: worker, targetInfo } =
			/** @type {{ sessionId: string, targetInfo: TargetInfo }} */ (params);
		if (targetInfo.type !== 'worker') return;
		if (parent !== sessionId && !workers.some((known) => known.sessionId === parent)) return;
		if (workers.some((known) => known.sessionId === worker)) return;
		workers.push({ sessionId: worker, url: targetInfo.url });
		devtools
			.send(
				'Target.setAutoAttach',
				{ autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
				worker,
			)
			.catch(() => {});
	});
	await devtools.send(
		'Target.setAutoAttach',
		{ autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
		sessionId,
	);
	const deadline = Date.now() + timeoutMs;
	while (!enough(workers) && Date.now() < deadline) await sleep(100);
	return { page: sessionId, workers };
}

/**
 * Attaches to a page and to its named workers. A worker is named by a part of its script's address.
 *
 * @param {DevTools} devtools
 * @param {string} targetId
 * @param {readonly string[]} names
 * @returns {Promise<Attached>}
 */
export async function attachWorkers(devtools, targetId, names) {
	const named = (/** @type {readonly AttachedWorker[]} */ workers) =>
		new Map(
			names.flatMap((name) => {
				const worker = workers.findLast((candidate) => candidate.url.includes(name));
				return worker ? [[name, worker.sessionId]] : [];
			}),
		);
	const { page, workers } = await attachPage(
		devtools,
		targetId,
		(attached) => named(attached).size === names.length,
	);
	const found = named(workers);
	const missing = names.filter((name) => !found.has(name));
	if (missing.length > 0) throw new Error(`no worker target appeared for ${missing.join(', ')}`);
	return { page, workers: found };
}

/**
 * Makes a page's network limits cover its workers' own requests. Chrome refuses network limits on a
 * worker, but applies the page's limits to it once the worker's network domain is on. So each worker
 * waits at its start until the tool turns the domain on. Returns a function that stops watching.
 *
 * @param {DevTools} devtools
 * @param {string} page
 * @returns {Promise<() => void>}
 */
export async function limitWorkerNetworks(devtools, page) {
	const stop = devtools.on('Target.attachedToTarget', (params, parent) => {
		const { sessionId, targetInfo, waitingForDebugger } =
			/** @type {{ sessionId: string, targetInfo: TargetInfo, waitingForDebugger: boolean }} */ (
				params
			);
		if (parent !== page || targetInfo.type !== 'worker') return;
		const resume = () =>
			waitingForDebugger
				? devtools.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
				: undefined;
		// A worker that stops before the tool reaches it needs neither step.
		devtools.send('Network.enable', {}, sessionId).then(resume, resume);
	});
	await devtools.send(
		'Target.setAutoAttach',
		{ autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
		page,
	);
	return stop;
}

/**
 * Attaches to a page and to every one of its workers, of which `count` must appear. `timeoutMs`
 * lengthens the wait for a page whose workers start slowly: the engine grows its job workers over
 * frames, and a software GPU draws so few that the growth can take minutes.
 *
 * @param {DevTools} devtools
 * @param {string} targetId
 * @param {number} count
 * @param {number} [timeoutMs]
 * @param {boolean} [allowFewer]
 * @returns {Promise<{ page: string, workers: AttachedWorker[] }>}
 */
export async function attachEveryWorker(devtools, targetId, count, timeoutMs, allowFewer = false) {
	const attached = await attachPage(
		devtools,
		targetId,
		(workers) => workers.length >= count,
		timeoutMs,
	);
	if (attached.workers.length < 2)
		throw new Error(`${attached.workers.length} of the page's ${count} workers appeared`);
	if (attached.workers.length < count && !allowFewer)
		throw new Error(`${attached.workers.length} of the page's ${count} workers appeared`);
	return attached;
}

/**
 * The bytes of every WebAssembly memory that a page or worker holds. It finds the memories through
 * the debugger, as the engine keeps its memory out of the page's global scope.
 *
 * @param {DevTools} devtools
 * @param {string} sessionId
 * @returns {Promise<number>}
 */
export async function wasmMemoryBytes(devtools, sessionId) {
	const objectGroup = 'null3d-wasm-memory';
	try {
		const { result: prototype } = /** @type {{ result: { objectId: string } }} */ (
			await devtools.send(
				'Runtime.evaluate',
				{ expression: 'WebAssembly.Memory.prototype', objectGroup },
				sessionId,
			)
		);
		const { objects } = /** @type {{ objects: { objectId: string } }} */ (
			await devtools.send(
				'Runtime.queryObjects',
				{ prototypeObjectId: prototype.objectId, objectGroup },
				sessionId,
			)
		);
		const { result } = /** @type {{ result: { value: number } }} */ (
			await devtools.send(
				'Runtime.callFunctionOn',
				{
					objectId: objects.objectId,
					functionDeclaration:
						'function () { return this.reduce((sum, memory) => sum + memory.buffer.byteLength, 0); }',
					returnByValue: true,
				},
				sessionId,
			)
		);
		return result.value;
	} finally {
		await devtools.send('Runtime.releaseObjectGroup', { objectGroup }, sessionId);
	}
}

/**
 * Evaluates an expression in a page or worker and returns its value, copied out as JSON.
 *
 * @template T
 * @param {DevTools} devtools
 * @param {string} sessionId
 * @param {string} expression
 * @returns {Promise<T>}
 */
export async function evaluate(devtools, sessionId, expression) {
	const { result, exceptionDetails } =
		/** @type {{ result: { value: T }, exceptionDetails?: { text: string } }} */ (
			await devtools.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
		);
	if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.text}`);
	return result.value;
}

/**
 * Waits until the page in a debugging session publishes its result, checking every `pollMs`, and
 * returns the result, which may report a failure. It throws when the time runs out.
 *
 * @template T
 * @param {DevTools} devtools
 * @param {string} sessionId
 * @param {number} timeoutMs
 * @param {number} [pollMs]
 * @returns {Promise<T>}
 */
export async function pageResultOf(devtools, sessionId, timeoutMs, pollMs = 1000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await evaluate(devtools, sessionId, 'globalThis.__null3dResult ?? null');
		if (result) return /** @type {T} */ (result);
		await sleep(pollMs);
	}
	throw new Error('the page published no result in time');
}

/**
 * Samples the call stacks of each worker for `ms` milliseconds, and gives the call frames that ran,
 * by worker. The heap profiler lists the places that allocated; this lists the functions that ran,
 * so a check can tell whether it saw the code that it means to measure. `interval` is the
 * microseconds between samples.
 *
 * @param {DevTools} devtools
 * @param {ReadonlyMap<string, string>} sessions A debugging session for each worker, by name.
 * @param {number} ms
 * @param {number} [interval]
 * @returns {Promise<Map<string, CallFrame[]>>}
 */
export async function sampledFrames(devtools, sessions, ms, interval = 500) {
	for (const [name, sessionId] of sessions) {
		await within(
			devtools.send('Profiler.enable', {}, sessionId),
			STEP_MS,
			`enabling the CPU profiler in the ${name}`,
		);
		await within(
			devtools.send('Profiler.setSamplingInterval', { interval }, sessionId),
			STEP_MS,
			`setting the CPU profiler's interval in the ${name}`,
		);
		await within(
			devtools.send('Profiler.start', {}, sessionId),
			STEP_MS,
			`starting a CPU profile in the ${name}`,
		);
	}
	await sleep(ms);
	/** @type {Map<string, CallFrame[]>} */
	const frames = new Map();
	for (const [name, sessionId] of sessions) {
		const { profile } = /** @type {{ profile: { nodes: { callFrame: CallFrame }[] } }} */ (
			await within(
				devtools.send('Profiler.stop', {}, sessionId),
				STEP_MS,
				`stopping the CPU profile in the ${name}`,
			)
		);
		frames.set(
			name,
			profile.nodes.map((node) => node.callFrame),
		);
	}
	return frames;
}

/**
 * The heap profiler of a page or of its workers: it starts a sample in every session, and stops it
 * in each and gives what it found. The profiler keeps the samples of objects that garbage
 * collection frees, which per-frame garbage is; by default it reports only objects still alive when
 * sampling stops.
 */
export class HeapSampler {
	/** @type {DevTools} */
	#devtools;
	/** @type {ReadonlyMap<string, string>} */
	#sessions;

	/**
	 * @param {DevTools} devtools
	 * @param {ReadonlyMap<string, string>} sessions A debugging session for each worker, by name.
	 */
	constructor(devtools, sessions) {
		this.#devtools = devtools;
		this.#sessions = sessions;
	}

	/** Turns the heap profiler on in every worker. */
	async enable() {
		for (const [name, sessionId] of this.#sessions)
			await within(
				this.#devtools.send('HeapProfiler.enable', {}, sessionId),
				STEP_MS,
				`enabling the heap profiler in the ${name}`,
			);
	}

	/**
	 * Starts a sample in every worker. `interval` is the bytes between samples, small so that a few
	 * bytes per frame still show.
	 *
	 * @param {number} [interval]
	 */
	async start(interval = 128) {
		for (const [name, sessionId] of this.#sessions)
			await within(
				this.#devtools.send(
					'HeapProfiler.startSampling',
					{
						samplingInterval: interval,
						includeObjectsCollectedByMajorGC: true,
						includeObjectsCollectedByMinorGC: true,
					},
					sessionId,
				),
				STEP_MS,
				`starting a heap sample in the ${name}`,
			);
	}

	/**
	 * Stops the sample in every worker and gives each worker's profile, by name.
	 *
	 * @returns {Promise<Map<string, HeapProfile>>}
	 */
	async stop() {
		/** @type {Map<string, HeapProfile>} */
		const profiles = new Map();
		for (const [name, sessionId] of this.#sessions) {
			const { profile } = await within(
				this.#devtools.send('HeapProfiler.stopSampling', {}, sessionId),
				STEP_MS,
				`stopping the heap sample in the ${name}`,
			);
			profiles.set(name, profile);
		}
		return profiles;
	}
}
