// Runs of the runner page. A run is a plan of test pages that each browser works through, one page
// after another, with one result file per browser and page. The command-line tools write the plan,
// choose which browsers may run it now, and read the results; the runner page and the dev server
// move everything in between.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_RUN_FILE, RUNS_DIR } from './report-collector.ts';

export interface PlanItem<Check = unknown> {
	/** The item's name, which is also its result's file name. */
	id: string;
	/**
	 * The page to open: a path on the dev server, with its switches. The runner page puts its run and
	 * its own name where the path has `{run}` and `{runner}`.
	 */
	path: string;
	/** How long the page may take to publish its result. */
	timeoutSeconds: number;
	/** What the command-line tool checks in the result. */
	check: Check;
}

export interface Plan<Check = unknown> {
	run: string;
	createdAt: string;
	items: PlanItem<Check>[];
}

/** The run that waiting runner pages start, and the runners that may start it now. */
export interface CurrentRun {
	run: string;
	turns: string[];
}

/** A result the runner page stored: the page's own report, or a timeout it recorded instead. */
export interface ItemResult {
	ok: boolean;
	error?: string;
	[key: string]: unknown;
}

/** Text as a name that is safe in files and URLs: lowercase words joined by dashes. */
export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** How many of a page's last steps a failure's message quotes. */
const LAST_STEPS = 6;

/** The last steps of a page's trail, as a failure's message quotes them, or nothing without one. */
export function lastSteps(trail: unknown): string {
	const steps = Array.isArray(trail) ? trail.map(String) : [];
	return steps.length > 0 ? `; the page's last steps: ${steps.slice(-LAST_STEPS).join('; ')}` : '';
}

/** What a failed page's result says went wrong, with the last steps the page got through. */
export const failureText = (result: ItemResult) =>
	`${result.error ?? 'the page failed without a message'}${lastSteps(result.trail)}`;

/** A run name from its plan's name and the time: sortable, and safe as a folder name. */
export function runName(planName: string, now = new Date()): string {
	const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
	return `${stamp}-${planName}`.toLowerCase();
}

export function writePlan<Check>(run: string, items: PlanItem<Check>[]): Plan<Check> {
	const plan: Plan<Check> = { run, createdAt: new Date().toISOString(), items };
	mkdirSync(join(RUNS_DIR, run), { recursive: true });
	writeFileSync(join(RUNS_DIR, run, 'plan.json'), JSON.stringify(plan, null, '\t'));
	return plan;
}

/** Lets these runners start the run; any other waiting runner page keeps waiting. */
export function setTurns(run: string, turns: string[]): void {
	mkdirSync(RUNS_DIR, { recursive: true });
	const current: CurrentRun = { run, turns };
	writeFileSync(CURRENT_RUN_FILE, JSON.stringify(current));
}

function readJson<T>(path: string): T | undefined {
	return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;
}

export function readResult(run: string, runner: string, id: string): ItemResult | undefined {
	return readJson(join(RUNS_DIR, run, runner, `${id}.json`));
}

/** Writes a file of a runner's results, such as a result with facts added after the run. */
export function writeRunnerFile(run: string, runner: string, name: string, value: unknown): void {
	mkdirSync(join(RUNS_DIR, run, runner), { recursive: true });
	writeFileSync(join(RUNS_DIR, run, runner, `${name}.json`), JSON.stringify(value, null, '\t'));
}

/** Adds facts that the runner page could not record to one of a runner's results, if it has one. */
export function addToResult(
	run: string,
	runner: string,
	id: string,
	facts: Record<string, unknown>,
): void {
	const result = readResult(run, runner, id);
	if (result) writeRunnerFile(run, runner, id, { ...result, ...facts });
}

/** When the dev server received a result, in milliseconds since 1970, or undefined without one. */
export function receivedAt(
	result: ItemResult | Record<string, unknown> | undefined,
): number | undefined {
	const time = Date.parse(String(result?.receivedAt));
	return Number.isFinite(time) ? time : undefined;
}

/** What the runner page learned about its browser and device. */
export function readDevice(run: string, runner: string): Record<string, unknown> | undefined {
	return readJson(join(RUNS_DIR, run, runner, 'device.json'));
}

export function finished(run: string, runner: string): boolean {
	return existsSync(join(RUNS_DIR, run, runner, 'done.json'));
}

/** A runner page in one browser, and the physical device that browser runs on. */
export interface Runner {
	name: string;
	device: string;
}

/**
 * Batches of runners that may run at the same time: at most one per physical device, so two
 * browsers never compete for one device's processor and GPU. Batch k holds the k-th runner of each
 * device, in the order given.
 */
export function turnBatches(runners: readonly Runner[]): string[][] {
	const byDevice = new Map<string, string[]>();
	for (const { name, device } of runners)
		byDevice.set(device, [...(byDevice.get(device) ?? []), name]);
	const batches: string[][] = [];
	for (const list of byDevice.values()) {
		list.forEach((runner, k) => {
			if (!batches[k]) batches[k] = [];
			batches[k]?.push(runner);
		});
	}
	return batches;
}

/** Time a batch may take: every page's timeout, plus time to open the browser and pause between pages. */
export function batchTimeoutMs(plan: Plan): number {
	const PER_ITEM_SLACK_SECONDS = 5;
	const START_SECONDS = 120;
	return (
		(START_SECONDS +
			plan.items.reduce((sum, item) => sum + item.timeoutSeconds + PER_ITEM_SLACK_SECONDS, 0)) *
		1000
	);
}

/**
 * How long a runner page may send nothing once it has started before it counts as stopped, as when
 * its tab closes: its slowest page's timeout, after which the page reports a timeout itself, and
 * time to load the next page.
 */
export function quietLimitMs(plan: Plan): number {
	const LOAD_SECONDS = 30;
	return (Math.max(0, ...plan.items.map((item) => item.timeoutSeconds)) + LOAD_SECONDS) * 1000;
}

/** When a runner last wrote a file of the run, or undefined before its runner page starts. */
function lastWrite(run: string, runner: string): number | undefined {
	const dir = join(RUNS_DIR, run, runner);
	if (!existsSync(dir)) return undefined;
	let last: number | undefined;
	for (const name of readdirSync(dir)) {
		const time = statSync(join(dir, name)).mtimeMs;
		if (last === undefined || time > last) last = time;
	}
	return last;
}

/** What a wait reports, and the quiet time after which a started runner counts as stopped. */
export interface WaitOptions {
	onFinish?: (runner: string) => void;
	onQuiet?: (runner: string, quietSeconds: number) => void;
	quietMs?: number;
}

/**
 * Waits until each runner has finished the run, or has gone quiet after it started, or the plan's
 * time runs out. A runner that never starts waits for the plan's time, as a page on a tablet may
 * need someone to open it. Returns the runners that finished.
 */
export async function waitForRunners(
	plan: Plan,
	runners: readonly string[],
	{ onFinish = () => {}, onQuiet = () => {}, quietMs = quietLimitMs(plan) }: WaitOptions = {},
): Promise<string[]> {
	const deadline = Date.now() + batchTimeoutMs(plan);
	const done: string[] = [];
	const waiting = new Set(runners);
	while (waiting.size > 0 && Date.now() < deadline) {
		for (const runner of waiting) {
			const last = lastWrite(plan.run, runner);
			if (finished(plan.run, runner)) {
				waiting.delete(runner);
				done.push(runner);
				onFinish(runner);
			} else if (last !== undefined && Date.now() - last > quietMs) {
				waiting.delete(runner);
				onQuiet(runner, Math.round((Date.now() - last) / 1000));
			}
		}
		if (waiting.size > 0) await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return done;
}
