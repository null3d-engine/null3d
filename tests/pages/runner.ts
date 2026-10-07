// The runner page: works through a run's pages one after another, each in a frame that fills the
// window, and posts every page's result to the dev server. It needs no WebDriver, so it runs in any
// browser on any device. Open it with ?run=<run>&runner=<name> to run once and then close the tab,
// or with ?listen&runner=<name> to wait: a waiting page starts each run whose turn list names it.
// With &from=<index>, a page opened for one run starts at that item of the plan, as when the runner
// tool replaces a runner page that stopped answering. Each runner page claims its runner's results
// when it starts a run, and a page whose claim a newer page took stops: a replaced page can still be
// running, hidden, where the runner tool cannot close it. A page whose turn the runner tool ended, as
// when its browser keeps refusing memory, stops too. So does a page that gets no animation frames
// for its measure of the refresh rate within a time limit, as when the browser reports the page
// hidden: it posts a record of it, since every test page would wait for frames too. A request to
// the dev server that gets no answer in time goes out again, because Safari can lose one that it
// sends as a removed frame closes its connections.
// A runner page that opens without &from= starts at the first page of the plan that has no result,
// so a browser that reloads it in the middle of a run, as Safari does after a page crashed its tab,
// goes on where it stopped. A page that may end its tab on purpose, such as the tab memory page,
// posts its progress as it goes. When the runner page finds such a page started and without a
// result, the browser closed the tab during it: the runner page records the page's last progress
// as its result, rests so the device can free the tab's memory, and goes on with the next page.
// The page reports the run: a grid with one cell per page, the failures with their errors, and a
// line per result, newest first. The report lies under each page's frame, or over it when the plan
// asks, as plans that check results do, so the screen does not flash between pages. A page that
// times its frames stays on top in every plan. Each
// result changes one cell and adds one line, so the page does no work while a test page runs.
// Pixels travel as the page read them back, never re-encoded through a canvas, which privacy
// protections can alter. For a startup load, the result also tells what the server sent for it.

import {
	detectBrowser,
	type GpuFacts,
	NO_FRAMES,
	type NoFramesRecord,
	noFramesText,
	type UserAgentData,
} from '../lib/device-record';
import {
	type GpuPath,
	type MissingAllowed,
	pathsToSkip,
	skippedPath,
	skippedResult,
} from '../lib/gpu-paths';
import { fillRunner, loadOf, takeDownloads } from '../lib/load-routes';
import { patientFetch } from '../lib/patient-fetch';
import {
	handoverName,
	progressName,
	REST_AFTER_TAB_END_SECONDS,
	tabEndedResult,
} from '../lib/tab-end';

interface PlanItem {
	id: string;
	path: string;
	timeoutSeconds: number;
	/** The page may end its tab on purpose, and posts its progress as it goes. */
	endsTab?: boolean;
	/** The page times its frames, so its frame stays on top of a report that the plan draws over pages. */
	timesFrames?: boolean;
	/** The page runs in a runner page of its own, where the runner tool can open runner pages. */
	ownTab?: boolean;
	/** The GPU path that the page needs. */
	gpu?: GpuPath;
}

type Result = { ok: boolean; error?: string } & Record<string, unknown>;

const params = new URLSearchParams(location.search);
const runner = params.get('runner') ?? 'browser';
/** The runner tool opens a new runner page when this one hands the run over. */
const tabs = params.has('tabs');
const LISTEN_POLL_MS = 2000;
const RESULT_POLL_MS = 200;
const PAUSE_BETWEEN_PAGES_MS = 1000;
const REFRESH_SAMPLES = 61;
/**
 * How long the page changes the screen before it times frames for the refresh rate. A phone lowers
 * its display's rate while the screen barely changes, and the Galaxy S24+ took about 330 ms to
 * raise it again once every frame changed the screen.
 */
const REFRESH_WARM_UP_MS = 500;
/**
 * A shade of the report's background one step lighter, which the report takes on every other frame
 * while the page measures the refresh rate, so each frame changes the whole screen unseen.
 */
const REFRESH_SHADE = '#101419';
/**
 * How long the page waits for the animation frames that measure the refresh rate. A visible page
 * gets them within about a second; a page that the browser hides gets none until it shows it.
 */
const REFRESH_LIMIT_MS = 20_000;

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const statusLine = byId('status');
const stage = byId('stage');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** This page's name in its claims and results. Not a UUID: phones open the page without HTTPS. */
const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** A newer runner page claimed this runner's results, so this page must stop. */
class TakenOver extends Error {
	constructor() {
		super('a newer runner page took over this run');
	}
}

/**
 * The browser gave this page no animation frames in time, as when it reports the page hidden. Every
 * test page would wait for frames too, so the page stops, and the runner tool ends its turn.
 */
class NoFrames extends Error {
	constructor(visibility: string) {
		super(noFramesText(visibility));
	}
}

/**
 * The runner tool ended this runner's turn, as when its browser keeps refusing memory, so this page
 * must stop. Its output says why, and what to do.
 */
class TurnEnded extends Error {
	constructor() {
		super("the runner tool ended this runner's turn; its output says why");
	}
}

/** Throws when the dev server says that this page must stop. */
function stopIfRefused(status: number): void {
	if (status === 409) throw new TakenOver();
	if (status === 410) throw new TurnEnded();
}

function show(text: string): void {
	statusLine.textContent = `${runner}: ${text}`;
}

function line(text: string): HTMLLIElement {
	const item = document.createElement('li');
	item.textContent = text;
	return item;
}

type Outcome = 'waiting' | 'running' | 'passed' | 'failed' | 'skipped' | 'earlier';

/**
 * The run's report: a cell per page of the plan, coloured by its outcome, with running counts. A
 * tap or a hover on a cell shows its page and that page's error. Pages before a run's first item
 * ran on an earlier runner page, so they count as neither done nor left.
 */
class RunReport {
	private readonly heading = byId('run');
	private readonly grid = byId('grid');
	private readonly detail = byId('detail');
	private readonly failures = byId('failures');
	private readonly log = byId('log');
	private cells: HTMLElement[] = [];
	private ids: string[] = [];
	private outcomes: Outcome[] = [];
	private errors: (string | undefined)[] = [];
	private passed = 0;
	private failed = 0;
	private skipped = 0;
	private left = 0;

	constructor() {
		const pick = (event: Event) => {
			const index = this.cells.indexOf(event.target as HTMLElement);
			if (index < 0) return;
			const error = this.errors[index];
			this.detail.textContent = `${this.ids[index]}: ${this.outcomes[index]}${error ? `: ${error}` : ''}`;
		};
		this.grid.addEventListener('pointerover', pick);
		this.grid.addEventListener('click', pick);
	}

	/** Lays out a cell for each item of the plan. */
	start(run: string, items: PlanItem[], from: number): void {
		this.ids = items.map((item) => item.id);
		this.outcomes = this.ids.map((_, index) => (index < from ? 'earlier' : 'waiting'));
		this.errors = [];
		this.passed = 0;
		this.failed = 0;
		this.skipped = 0;
		this.left = Math.max(0, items.length - from);
		this.cells = this.outcomes.map((outcome) => {
			const cell = document.createElement('i');
			cell.className = outcome;
			return cell;
		});
		this.heading.textContent = `run ${run}, ${items.length} pages${from > 0 ? `, from page ${from + 1}` : ''}`;
		this.grid.replaceChildren(...this.cells);
		this.detail.textContent = '';
		this.failures.replaceChildren();
		this.log.replaceChildren();
	}

	running(index: number): void {
		this.mark(index, 'running');
	}

	finish(index: number, result: Result): void {
		const page = `${this.ids[index]}${result.error ? `: ${result.error}` : ''}`;
		this.left--;
		if (skippedPath(result)) {
			this.skipped++;
			this.errors[index] = result.error;
			this.mark(index, 'skipped');
			this.log.prepend(line(`skipped  ${page}`));
			return;
		}
		if (result.ok) this.passed++;
		else {
			this.failed++;
			this.errors[index] = result.error;
			this.failures.append(line(page));
		}
		this.mark(index, result.ok ? 'passed' : 'failed');
		this.log.prepend(line(`${result.ok ? 'done' : 'failed'}  ${page}`));
	}

	counts(): string {
		const skipped = this.skipped > 0 ? `, ${this.skipped} skipped` : '';
		return `${this.passed} passed, ${this.failed} failed${skipped}, ${this.left} left`;
	}

	private mark(index: number, outcome: Outcome): void {
		this.outcomes[index] = outcome;
		(this.cells[index] as HTMLElement).className = outcome;
	}
}

const report = new RunReport();

async function post(run: string, name: string, body: unknown): Promise<void> {
	const response = await patientFetch(`/__null3d/runs/${run}/${runner}/${name}?page=${pageId}`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	stopIfRefused(response.status);
	if (!response.ok) throw new Error(`the dev server refused ${name}: ${response.status}`);
}

/** Claims this runner's results in a run for this page, so that an older page's are refused. */
async function claim(run: string): Promise<void> {
	const response = await patientFetch(`/__null3d/runs/${run}/${runner}?page=${pageId}`, {
		method: 'POST',
	});
	stopIfRefused(response.status);
	if (!response.ok) throw new Error(`the dev server refused the claim: ${response.status}`);
}

/**
 * The display's refresh rate, from the median interval between animation frames, or null when the
 * browser gives the page too few frames within the time limit. Frame callbacks follow the display's
 * rate, and a phone lowers that rate while the screen barely changes, as when only the report's
 * lines change between pages: the Galaxy S24+ then runs at 24 Hz. So each frame of the measurement
 * changes the report's background by one shade, and the timing starts once the display has had
 * time to rise to its full rate.
 */
async function refreshRate(): Promise<number | null> {
	const panel = byId('report');
	const times: number[] = [];
	let frames = 0;
	let warmUpEnd = Number.POSITIVE_INFINITY;
	let late = false;
	const measured = await new Promise<boolean>((resolve) => {
		const limit = setTimeout(() => {
			late = true;
			resolve(false);
		}, REFRESH_LIMIT_MS);
		const tick = (time: number) => {
			if (late) return;
			panel.style.backgroundColor = frames++ % 2 === 0 ? REFRESH_SHADE : '';
			if (frames === 1) warmUpEnd = time + REFRESH_WARM_UP_MS;
			if (time >= warmUpEnd) times.push(time);
			if (times.length < REFRESH_SAMPLES) requestAnimationFrame(tick);
			else {
				clearTimeout(limit);
				resolve(true);
			}
		};
		requestAnimationFrame(tick);
	});
	panel.style.backgroundColor = '';
	if (!measured) return null;
	const intervals = times
		.slice(1)
		.map((time, i) => time - (times[i] as number))
		.sort((a, b) => a - b);
	return Math.round(1000 / (intervals[Math.floor(intervals.length / 2)] as number));
}

/**
 * The GPU as the browser names it: WebGPU's adapter details, whether WebGPU's compatibility mode
 * gives an adapter, and the WebGL2 renderer. The page asks for no device and loses its WebGL2
 * context at once, so no GPU memory stays held during the run.
 */
async function gpuInfo(): Promise<GpuFacts> {
	const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
	const compatibility = await navigator.gpu
		?.requestAdapter({ featureLevel: 'compatibility' })
		.catch(() => null);
	const gl = document.createElement('canvas').getContext('webgl2');
	const debug = gl?.getExtension('WEBGL_debug_renderer_info');
	const renderer = gl?.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
	gl?.getExtension('WEBGL_lose_context')?.loseContext();
	const { vendor, architecture, device, description } = adapter?.info ?? {};
	return {
		webgpu: adapter
			? {
					vendor: vendor ?? '',
					architecture: architecture ?? '',
					device: device ?? '',
					description: description ?? '',
				}
			: null,
		compatibility: Boolean(compatibility),
		webgl2: gl ? { renderer: String(renderer ?? '') } : null,
	};
}

/**
 * What the browser tells about itself and its device: the browser it detects itself to be, and
 * the GPU. Browsers may hide the GPU and the model.
 */
async function deviceInfo(): Promise<Record<string, unknown>> {
	const nav = navigator as Navigator & {
		userAgentData?: { getHighEntropyValues(hints: string[]): Promise<UserAgentData> };
		deviceMemory?: number;
		brave?: { isBrave(): Promise<boolean> };
	};
	const userAgentData = await nav.userAgentData
		?.getHighEntropyValues([
			'architecture',
			'bitness',
			'model',
			'platform',
			'platformVersion',
			'fullVersionList',
		])
		.catch(() => undefined);
	const brave = (await nav.brave?.isBrave().catch(() => false)) ?? false;
	return {
		userAgent: navigator.userAgent,
		userAgentData,
		brave,
		browser: detectBrowser({ userAgent: navigator.userAgent, userAgentData, brave }),
		gpu: await gpuInfo(),
		hardwareConcurrency: navigator.hardwareConcurrency,
		deviceMemory: nav.deviceMemory ?? null,
		maxTouchPoints: navigator.maxTouchPoints,
		screen: { width: screen.width, height: screen.height },
		devicePixelRatio,
		refreshRateHz: await refreshRate(),
		visibility: document.visibilityState,
		crossOriginIsolated,
		origin: location.origin,
		startedAt: new Date().toISOString(),
	};
}

/**
 * How far a frame's page loaded, as a step for its trail: the state of its document, and the files
 * it finished loading, with the last of them. A page whose script or one of its imports never
 * arrived stays in the `interactive` state, and its trail is empty.
 */
function frameLoadStep(frame: HTMLIFrameElement): string {
	const loaded = frame.contentWindow?.performance.getEntriesByType('resource') ?? [];
	const last = loaded.at(-1);
	const lastText = last
		? `, the last ${new URL(last.name).pathname} at ${Math.round(last.startTime + last.duration)} ms`
		: '';
	return `runner: the page's document is ${frame.contentDocument?.readyState ?? 'out of reach'}, and it loaded ${loaded.length} files${lastText}`;
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
			trail: [...(trail ?? []), frameLoadStep(frame)],
		};
	} finally {
		frame.remove();
	}
}

/**
 * Runs one item of a run: its page, at the address where this runner's run and name, and the
 * item's own name, fill the item's placeholders. A startup load's result gets what the server sent for the load.
 */
async function runItem(item: PlanItem, run: string): Promise<Result> {
	const path = fillRunner(item.path, run, runner, item.id);
	const page = await patientFetch(path, { cache: 'no-store' });
	if (!page.ok) return { ok: false, error: `page not found (HTTP ${page.status})` };
	const load = loadOf(path);
	// The check above was a download of the load, which starts afresh after it.
	if (load) await takeDownloads(load);
	const result = await openInFrame(path, item.timeoutSeconds);
	return load ? { ...result, downloads: await takeDownloads(load) } : result;
}

/** The names of the results and records that this runner stored in a run so far. */
async function stored(run: string): Promise<Set<string>> {
	const answer = await patientFetch(`/__null3d/runs/${run}/${runner}`, { cache: 'no-store' });
	if (!answer.ok) throw new Error(`the dev server did not list the results: ${answer.status}`);
	return new Set(JSON.parse(answer.text) as string[]);
}

/** A result or record that this runner stored in a run, or undefined when there is none. */
async function storedResult(run: string, name: string): Promise<Result | undefined> {
	const answer = await patientFetch(`/__null3d/runs/${run}/${runner}/${name}`, {
		cache: 'no-store',
	});
	return answer.ok ? (JSON.parse(answer.text) as Result) : undefined;
}

/**
 * Where a run goes on when the page opens without &from=: at the first item without a result. An
 * item that may end its tab, and that started without a result, ended the tab: its last progress
 * becomes its result, and the run goes on after it.
 */
async function resumeAt(run: string, items: readonly PlanItem[]): Promise<number> {
	const names = await stored(run);
	const index = items.findIndex((item) => !names.has(item.id));
	const item = items[index];
	if (!item?.endsTab || !names.has(progressName(item.id))) return index < 0 ? items.length : index;
	const facts = await storedResult(run, progressName(item.id));
	await post(run, item.id, tabEndedResult(facts, 'runner page'));
	show(`${item.id} ended the tab; resting before the next page`);
	await sleep(REST_AFTER_TAB_END_SECONDS * 1000);
	return index + 1;
}

/**
 * Posts that the browser gave the page no animation frames before `step`, the device reading or a
 * plan item, and stops the run: every page would wait for frames too.
 */
async function stopWithoutFrames(run: string, step: string): Promise<never> {
	const record: NoFramesRecord = { visibility: document.visibilityState, step };
	await post(run, NO_FRAMES, record);
	throw new NoFrames(record.visibility);
}

/**
 * Runs a run's items from the item at `from`, or where the run stopped without it. Only a run from
 * its first item reads the device. Before an item that may end its tab, the page notes that the
 * item started, under the item's progress. In a plan that asks for it, the page measures the
 * display's refresh rate before each item, with no test page loaded, and adds it to the item's
 * result. In a plan that draws its report over the pages, a page that times its frames keeps its
 * frame on top: a canvas hidden under the report barely changes the screen, and a phone may then
 * lower its refresh rate. In a plan that lets the device lack GPU paths, once the capabilities page has reported
 * the device's paths, the page skips each item that needs a path the device lacks: it posts a skip
 * as the item's result, and does not open the item's page. Where the runner tool opens runner pages,
 * a page that runs in a runner page of its own gets one: before that page and after it, this page
 * posts a handover and stops, and the tool opens a new runner page there. Pages that it only skips
 * load nothing, so they run where they are.
 */
async function runPlan(run: string, from?: number): Promise<void> {
	const plan = JSON.parse((await patientFetch(`/__null3d/runs/${run}/plan`)).text) as {
		items: PlanItem[];
		reportOnTop?: boolean;
		measureRefresh?: boolean;
		skipMissing?: { report: string; allowed: MissingAllowed };
	};
	await claim(run);
	const start = from ?? (await resumeAt(run, plan.items));
	report.start(run, plan.items, start);
	if (start === 0) {
		show(`run ${run}: reading the device`);
		const device = await deviceInfo();
		await post(run, 'device', device);
		if (device.refreshRateHz === null) await stopWithoutFrames(run, 'device');
	}
	const { skipMissing } = plan;
	const reportAt = plan.items.findIndex((item) => item.id === skipMissing?.report);
	// A run that goes on after the capabilities page reads the paths from the page's stored result.
	let skip: readonly GpuPath[] =
		skipMissing && reportAt >= 0 && reportAt < start
			? pathsToSkip(await storedResult(run, skipMissing.report), skipMissing.allowed)
			: [];
	/**
	 * Whether this runner page ran a page yet, and whether the last page it ran wanted a runner page
	 * of its own.
	 */
	let ranHere = false;
	let lastOwnTab = false;
	for (const [index, item] of plan.items.entries()) {
		if (index < start) continue;
		report.running(index);
		show(`${report.counts()}; now ${item.id}`);
		if (item.gpu && skip.includes(item.gpu)) {
			const result = skippedResult(item.gpu);
			await post(run, item.id, result);
			report.finish(index, result);
			continue;
		}
		if (tabs && ranHere && (item.ownTab || lastOwnTab)) {
			await post(run, handoverName(index), { from: index, at: new Date().toISOString() });
			show(`${report.counts()}; ${item.id} runs in a new runner page`);
			return;
		}
		if (item.endsTab)
			await post(run, progressName(item.id), { startedAt: new Date().toISOString() });
		stage.classList.toggle('report-on-top', plan.reportOnTop === true && !item.timesFrames);
		const runnerRefreshHz = plan.measureRefresh ? await refreshRate() : undefined;
		if (runnerRefreshHz === null) await stopWithoutFrames(run, item.id);
		const result = await runItem(item, run);
		ranHere = true;
		lastOwnTab = item.ownTab === true;
		await post(run, item.id, runnerRefreshHz ? { ...result, runnerRefreshHz } : result);
		report.finish(index, result);
		if (skipMissing && index === reportAt) skip = pathsToSkip(result, skipMissing.allowed);
		show(report.counts());
		await sleep(PAUSE_BETWEEN_PAGES_MS);
	}
	await post(run, 'done', { items: plan.items.length, finishedAt: new Date().toISOString() });
	show(`run ${run} finished: ${report.counts()}`);
}

/**
 * Waits for runs whose turn list names this runner, and runs each one it has not finished. After
 * its first run, the page reloads before each new run, so that no run inherits memory that an
 * earlier run's pages kept: some browsers free it only when the page unloads.
 */
async function listen(): Promise<void> {
	let ranOne = false;
	let ended = '';
	for (;;) {
		try {
			const current = JSON.parse(
				(await patientFetch('/__null3d/runs/current', { cache: 'no-store' })).text,
			) as { run?: string; turns?: string[] };
			const due = current.run !== undefined && current.turns?.includes(runner) === true;
			if (due && !(await patientFetch(`/__null3d/runs/${current.run}/${runner}/done`)).ok) {
				if (ranOne) {
					location.reload();
					return;
				}
				ranOne = true;
				await runPlan(current.run as string);
			} else show(`waiting for a run${ended}`);
		} catch (e) {
			if (e instanceof TakenOver || e instanceof NoFrames) return show(`stopped: ${e.message}`);
			// A page whose turn the tool ended waits for the next run, which reloads it first.
			if (e instanceof TurnEnded) {
				ended = ` (${e.message})`;
				show(`waiting for a run${ended}`);
			} else show(`waiting for the dev server (${(e as Error).message})`);
		}
		await sleep(LISTEN_POLL_MS);
	}
}

const run = params.get('run');
const from = Number(params.get('from') ?? 0);
if (params.has('listen')) void listen();
else if (run)
	runPlan(run, Number.isSafeInteger(from) && from > 0 ? from : undefined)
		// A page opened for one run closes its tab, so finished runs leave no tabs behind. Browsers
		// allow it because each test page loads in a new frame, which adds nothing to the tab's history.
		.then(() => window.close())
		.catch((e) => {
			show(`stopped: ${(e as Error).message}`);
			// A replaced page leaves, so it holds no GPU memory beside the page that took over. A page
			// whose turn the tool ended leaves too, and gives its memory back to the browser.
			if (e instanceof TakenOver || e instanceof TurnEnded) window.close();
		});
else show('open this page with ?run=<run>&runner=<name>, or with ?listen&runner=<name>');
