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

/** Workers the page starts, each noted with its name, its replies' types and its failures. */
const BrowserWorker = Worker;
globalThis.Worker = class extends BrowserWorker {
	constructor(url: string | URL, options?: WorkerOptions) {
		super(url, options);
		const name = options?.name ?? String(url).split('/').pop()?.split('?')[0];
		progress(`${name}: started`);
		this.addEventListener('message', ({ data }: MessageEvent) => {
			const { type, step } = (data ?? {}) as { type?: unknown; step?: unknown };
			if (type !== 'sketch-message')
				progress(`${name}: ${String(type ?? 'a reply')}${step ? ` (${String(step)})` : ''}`);
		});
		this.addEventListener('error', (event) => progress(`${name}: failed: ${event.message}`));
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
	if (status) status.textContent = JSON.stringify({ ...report, pixels: undefined }, null, 2);
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
		await publish(name, { ok: false, error: (e as Error).message });
	}
}
