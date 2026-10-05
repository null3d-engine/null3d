// Publishes a test page's result: on window, where Playwright and the runner page read it, and,
// when the page is opened on its own, to the dev server's report collector. It also keeps a trail
// of the page's steps on window, so a runner that gets no result can report how far the page got:
// each worker the page starts and each reply or failure of one, the errors the page logs, and the
// steps the page notes itself.

declare global {
	interface Window {
		__null3dResult?: unknown;
		/** The page's steps so far, each with its time since the page started. */
		__null3dProgress?: string[];
	}
}

const trail: string[] = [];
window.__null3dProgress = trail;

/** Notes a step of the page's work in its trail. */
export function progress(step: string): void {
	trail.push(`${Math.round(performance.now())} ms ${step}`);
}

addEventListener('error', (event) => progress(`error: ${event.message}`));
addEventListener('unhandledrejection', (event) =>
	progress(`unhandled rejection: ${String(event.reason)}`),
);
for (const level of ['error', 'warn'] as const) {
	const log = console[level];
	console[level] = (...args: unknown[]) => {
		progress(`console.${level}: ${args.map(String).join(' ')}`);
		log.apply(console, args);
	};
}

/** How long a second copy of a worker whose script did not load may take to load it. */
const RELOAD_TIMEOUT_MS = 10_000;

const BrowserWorker = Worker;
/** Workers the page started and has not stopped, and the workers it stopped. */
const workerCounts = { live: 0, stopped: 0 };

/** The workers the page started and has not stopped. */
export function liveWorkers(): number {
	return workerCounts.live;
}

/**
 * Starts a second copy of a worker whose script or one of its imports did not load, and notes
 * whether that copy loads, which tells a passing fault of the network from a lasting one. The copy
 * stops at its first message, which a worker of the engine sends once its script has run.
 */
function reloadWorker(name: string, url: string | URL, options: WorkerOptions | undefined): void {
	const started = performance.now();
	const copy = new BrowserWorker(url, { ...options, name: `${name}-copy` });
	const end = (outcome: string) => {
		clearTimeout(timer);
		copy.terminate();
		progress(`${name}: a second copy of the worker ${outcome}`);
	};
	const timer = setTimeout(
		() => end(`sent nothing within ${RELOAD_TIMEOUT_MS / 1000} s`),
		RELOAD_TIMEOUT_MS,
	);
	copy.onmessage = () => end(`loaded in ${Math.round(performance.now() - started)} ms`);
	copy.onerror = (event) =>
		end(event instanceof ErrorEvent ? `failed: ${event.message}` : 'did not load either');
}

/**
 * Workers the page starts, each noted with its name, its replies' types and its failures. A worker
 * whose script or one of its imports did not load gets an error event without a message: the trail
 * then names the workers that are running, and whether a second copy of the worker loads.
 */
globalThis.Worker = class extends BrowserWorker {
	constructor(url: string | URL, options?: WorkerOptions) {
		super(url, options);
		const name = options?.name ?? String(url).split('/').pop()?.split('?')[0] ?? 'worker';
		workerCounts.live++;
		progress(`${name}: started`);
		this.addEventListener('message', ({ data }: MessageEvent) => {
			const { type, step } = (data ?? {}) as { type?: unknown; step?: unknown };
			if (type !== 'sketch-message')
				progress(`${name}: ${String(type ?? 'a reply')}${step ? ` (${String(step)})` : ''}`);
		});
		this.addEventListener('error', (event) => {
			if (event instanceof ErrorEvent) {
				progress(`${name}: failed: ${event.message} at ${event.filename}:${event.lineno}`);
				return;
			}
			progress(
				`${name}: failed: its script or a file it imports did not load; ${workerCounts.live} workers running, ${workerCounts.stopped} stopped`,
			);
			reloadWorker(name, url, options);
		});
	}

	private stopped = false;

	override terminate(): void {
		if (!this.stopped) {
			this.stopped = true;
			workerCounts.live--;
			workerCounts.stopped++;
		}
		super.terminate();
	}
};

/** Encodes bytes as base64 in chunks, so large pixel buffers do not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk)
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(binary);
}

export async function publish(name: string, result: Record<string, unknown>): Promise<void> {
	const report = { page: name, userAgent: navigator.userAgent, url: location.href, ...result };
	window.__null3dResult = report;
	const status = document.getElementById('status');
	// A demo keeps its scene on screen, so its status stays one line, unless the page failed.
	const demo = new URLSearchParams(location.search).has('demo') && !('error' in result);
	if (status)
		status.textContent = demo
			? `${document.title}: running`
			: JSON.stringify(
					{ ...report, pixels: undefined, images: undefined, frame: undefined },
					null,
					2,
				);
	// Inside the runner page's frame, the runner posts the result with its run.
	if (window.parent !== window) return;
	try {
		await fetch(`/__null3d/report?name=${name}`, { method: 'POST', body: JSON.stringify(report) });
	} catch {
		// The collector is optional; Playwright reads the result from window.
	}
}

export async function run(
	name: string,
	body: () => Promise<Record<string, unknown>>,
): Promise<void> {
	try {
		await publish(name, { ok: true, ...(await body()) });
	} catch (e) {
		await publish(name, { ok: false, error: (e as Error).message, trail: [...trail] });
	}
}
