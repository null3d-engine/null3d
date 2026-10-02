// The runner page: works through a run's pages one after another, each in a frame that fills the
// window, and posts every page's result to the dev server. It needs no WebDriver, so it runs in any
// browser on any device. Open it with ?run=<run>&runner=<name> to run once and then close the tab,
// or with ?listen&runner=<name> to wait: a waiting page starts each run whose turn list names it.
// With &from=<index>, a page opened for one run starts at that item of the plan, as when the runner
// tool replaces a runner page that stopped answering. Each runner page claims its runner's results
// when it starts a run, and a page whose claim a newer page took stops: a replaced page can still be
// running, hidden, where the runner tool cannot close it.
// Pixels travel as the page read them back, never re-encoded through a canvas, which privacy
// protections can alter. For a startup load, the result also tells what the server sent for it.

import { fillRunner, loadOf, takeDownloads } from '../lib/load-routes';

interface PlanItem {
	id: string;
	path: string;
	timeoutSeconds: number;
}

type Result = { ok: boolean; error?: string } & Record<string, unknown>;

const params = new URLSearchParams(location.search);
const runner = params.get('runner') ?? 'browser';
const LISTEN_POLL_MS = 2000;
const RESULT_POLL_MS = 200;
const PAUSE_BETWEEN_PAGES_MS = 1000;
const REFRESH_SAMPLES = 61;

const statusLine = document.getElementById('status') as HTMLElement;
const list = document.getElementById('items') as HTMLElement;
const stage = document.getElementById('stage') as HTMLElement;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** This page's name in its claims and results. Not a UUID: phones open the page without HTTPS. */
const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** A newer runner page claimed this runner's results, so this page must stop. */
class TakenOver extends Error {
	constructor() {
		super('a newer runner page took over this run');
	}
}

function show(text: string): void {
	statusLine.textContent = `${runner}: ${text}`;
}

function log(text: string): void {
	const item = document.createElement('li');
	item.textContent = text;
	list.append(item);
}

async function post(run: string, name: string, body: unknown): Promise<void> {
	const response = await fetch(`/__null3d/runs/${run}/${runner}/${name}?page=${pageId}`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	if (response.status === 409) throw new TakenOver();
	if (!response.ok) throw new Error(`the dev server refused ${name}: ${response.status}`);
}

/** Claims this runner's results in a run for this page, so that an older page's are refused. */
async function claim(run: string): Promise<void> {
	const response = await fetch(`/__null3d/runs/${run}/${runner}?page=${pageId}`, {
		method: 'POST',
	});
	if (!response.ok) throw new Error(`the dev server refused the claim: ${response.status}`);
}

/** The display's refresh rate, from the median interval between animation frames. */
async function refreshRate(): Promise<number> {
	const times: number[] = [];
	await new Promise<void>((resolve) => {
		const tick = (time: number) => {
			times.push(time);
			if (times.length < REFRESH_SAMPLES) requestAnimationFrame(tick);
			else resolve();
		};
		requestAnimationFrame(tick);
	});
	const intervals = times
		.slice(1)
		.map((time, i) => time - (times[i] as number))
		.sort((a, b) => a - b);
	return Math.round(1000 / (intervals[Math.floor(intervals.length / 2)] as number));
}

/** What the browser tells about itself and its device. Browsers may hide the GPU and the model. */
async function deviceInfo(): Promise<Record<string, unknown>> {
	const nav = navigator as Navigator & {
		userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> };
		deviceMemory?: number;
		brave?: { isBrave(): Promise<boolean> };
	};
	return {
		userAgent: navigator.userAgent,
		userAgentData: await nav.userAgentData
			?.getHighEntropyValues([
				'architecture',
				'bitness',
				'model',
				'platform',
				'platformVersion',
				'fullVersionList',
			])
			.catch(() => undefined),
		brave: (await nav.brave?.isBrave().catch(() => false)) ?? false,
		hardwareConcurrency: navigator.hardwareConcurrency,
		deviceMemory: nav.deviceMemory ?? null,
		screen: { width: screen.width, height: screen.height },
		devicePixelRatio,
		refreshRateHz: await refreshRate(),
		crossOriginIsolated,
		startedAt: new Date().toISOString(),
	};
}

/** Opens a page in a frame and waits for the result it publishes, or records a timeout. */
async function openInFrame(path: string, timeoutSeconds: number): Promise<Result> {
	const frame = document.createElement('iframe');
	frame.className = 'page';
	frame.src = path;
	stage.append(frame);
	const deadline = performance.now() + timeoutSeconds * 1000;
	try {
		while (performance.now() < deadline) {
			const published = (frame.contentWindow as { __null3dResult?: Result } | null)?.__null3dResult;
			if (published) return published;
			await sleep(RESULT_POLL_MS);
		}
		const trail = (frame.contentWindow as { __null3dProgress?: string[] } | null)?.__null3dProgress;
		return {
			ok: false,
			error: `no result within ${timeoutSeconds} s`,
			trail: trail ? [...trail] : [],
		};
	} finally {
		frame.remove();
	}
}

/**
 * Runs one item of a run: its page, at the address where this runner's run and name fill the
 * item's placeholders. A startup load's result gets what the server sent for the load.
 */
async function runItem(item: PlanItem, run: string): Promise<Result> {
	const path = fillRunner(item.path, run, runner);
	const page = await fetch(path, { cache: 'no-store' });
	if (!page.ok) return { ok: false, error: `page not found (HTTP ${page.status})` };
	const load = loadOf(path);
	// The check above was a download of the load, which starts afresh after it.
	if (load) await takeDownloads(load);
	const result = await openInFrame(path, item.timeoutSeconds);
	return load ? { ...result, downloads: await takeDownloads(load) } : result;
}

/** Runs a run's items from the item at `from`. Only a run from its first item reads the device. */
async function runPlan(run: string, from = 0): Promise<void> {
	const plan = (await (await fetch(`/__null3d/runs/${run}/plan`)).json()) as { items: PlanItem[] };
	await claim(run);
	list.replaceChildren();
	if (from === 0) {
		show(`run ${run}: reading the device`);
		await post(run, 'device', await deviceInfo());
	}
	for (const [index, item] of plan.items.entries()) {
		if (index < from) continue;
		show(`run ${run}: ${index + 1} of ${plan.items.length}, ${item.id}`);
		const result = await runItem(item, run);
		await post(run, item.id, result);
		log(`${result.ok ? 'done' : 'failed'}  ${item.id}${result.error ? `: ${result.error}` : ''}`);
		await sleep(PAUSE_BETWEEN_PAGES_MS);
	}
	await post(run, 'done', { items: plan.items.length, finishedAt: new Date().toISOString() });
	show(`run ${run}: finished`);
}

/**
 * Waits for runs whose turn list names this runner, and runs each one it has not finished. After
 * its first run, the page reloads before each new run, so that no run inherits memory that an
 * earlier run's pages kept: some browsers free it only when the page unloads.
 */
async function listen(): Promise<void> {
	let ranOne = false;
	for (;;) {
		try {
			const current = (await (
				await fetch('/__null3d/runs/current', { cache: 'no-store' })
			).json()) as { run?: string; turns?: string[] };
			const due = current.run !== undefined && current.turns?.includes(runner) === true;
			if (due && !(await fetch(`/__null3d/runs/${current.run}/${runner}/done`)).ok) {
				if (ranOne) {
					location.reload();
					return;
				}
				ranOne = true;
				await runPlan(current.run as string);
			} else show('waiting for a run');
		} catch (e) {
			if (e instanceof TakenOver) return show(`stopped: ${e.message}`);
			show(`waiting for the dev server (${(e as Error).message})`);
		}
		await sleep(LISTEN_POLL_MS);
	}
}

const run = params.get('run');
const from = Number(params.get('from') ?? 0);
if (params.has('listen')) void listen();
else if (run)
	runPlan(run, Number.isSafeInteger(from) && from > 0 ? from : 0)
		// A page opened for one run closes its tab, so finished runs leave no tabs behind. Browsers
		// allow it because each test page loads in a new frame, which adds nothing to the tab's history.
		.then(() => window.close())
		.catch((e) => {
			show(`stopped: ${(e as Error).message}`);
			// A replaced page leaves, so it holds no GPU memory beside the page that took over.
			if (e instanceof TakenOver) window.close();
		});
else show('open this page with ?run=<run>&runner=<name>, or with ?listen&runner=<name>');
